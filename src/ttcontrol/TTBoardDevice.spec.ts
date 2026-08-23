// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026, fpgas.online contributors

import { afterEach, describe, expect, test, vi } from 'vitest';
import { setBoardInfo } from '~/model/board';
import { deviceState, updateDeviceState } from '~/model/DeviceState';
import { designToProject, FpgaDesign } from '~/model/fpgaDesigns';
import { updateShuttle } from '~/model/shuttle';
import type { SerialTransport, TransportState } from '~/transport/SerialTransport';
import { TTBoardDevice } from './TTBoardDevice';

/**
 * A carrier whose `readable` becomes null after its stream errors — what the
 * Web Serial spec does to a `SerialPort` after a fatal error (buffer overrun,
 * device unplugged). `TTBoardDevice.run()` must not try to re-pipe that null.
 */
class NullAfterErrorTransport extends EventTarget implements SerialTransport {
  state: TransportState = 'open';
  readableReads = 0;
  writable = new WritableStream<Uint8Array>();
  private controller!: ReadableStreamDefaultController<Uint8Array>;
  private stream: ReadableStream<Uint8Array> | null = new ReadableStream<Uint8Array>({
    start: (c) => {
      this.controller = c;
    },
  });

  get readable(): ReadableStream<Uint8Array> {
    this.readableReads += 1;
    // Typed non-null by the interface; null is the real-world Web Serial state
    // this guard exists for.
    return this.stream as ReadableStream<Uint8Array>;
  }

  /** Fatal carrier error: the stream errors and the port loses its readable. */
  fail(error: Error) {
    this.controller.error(error);
    this.stream = null;
  }

  async close() {
    this.state = 'closed';
  }
}

/** run() is private; the loop under test is only reachable through it. */
function run(device: TTBoardDevice): Promise<void> {
  return (device as unknown as { run(): Promise<void> }).run();
}

/** processInput() is private; feeding it a ROM line is how the parsing is exercised. */
function processInput(device: TTBoardDevice, line: string) {
  (device as unknown as { processInput(line: string): void }).processInput(line);
}

/**
 * A carrier that never delivers a byte and records everything written to it,
 * decoded back into text.
 */
class CapturingTransport extends EventTarget implements SerialTransport {
  state: TransportState = 'open';
  readonly readable = new ReadableStream<Uint8Array>();
  readonly writable: WritableStream<Uint8Array>;

  constructor(readonly written: string[]) {
    super();
    const decoder = new TextDecoder();
    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        written.push(decoder.decode(chunk, { stream: true }));
      },
    });
  }

  async close() {
    this.state = 'closed';
  }
}

/** A device on a silent carrier, without the boot handshake start() performs. */
function makeDevice() {
  return new TTBoardDevice(new CapturingTransport([]));
}

/**
 * A device whose writes land in `written`. Wires up the same encoder->transport
 * write path start() builds, but skips the boot handshake so the only text in
 * `written` is what the test provokes.
 */
function makeDeviceCapturingWrites() {
  const written: string[] = [];
  const device = new TTBoardDevice(new CapturingTransport(written));
  const encoder = new TextEncoderStream();
  void encoder.readable.pipeTo(device.transport.writable).catch(() => {});
  (device as unknown as { writer: WritableStreamDefaultWriter<string> }).writer =
    encoder.writable.getWriter();
  return { device, written };
}

/** Let the write pipe hand queued chunks to the transport's sink. */
function flushWrites() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const demoA: FpgaDesign = {
  name: 'tt_um_demo_a',
  title: 'Demo A',
  author: '',
  description: '',
  docs_url: '',
  repo_url: '',
  clock_hz: 1000,
  pinout: {},
  source: 'demo',
};

describe('TTBoardDevice.run', () => {
  test('stops looping when the transport lost its readable after an error', async () => {
    // Both are the expected report of the carrier dying, not a signal.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    const transport = new NullAfterErrorTransport();
    const device = new TTBoardDevice(transport);
    const closed = vi.fn();
    device.addEventListener('close', closed);

    const loop = run(device);
    // Let the pipe get going before the carrier dies under it.
    await new Promise((resolve) => setTimeout(resolve, 0));
    transport.fail(new Error('device lost'));

    await expect(loop).resolves.toBeUndefined();
    expect(closed).toHaveBeenCalledTimes(1);
    // Iteration 1: loop condition + pipe. Iteration 2: the condition that,
    // seeing null, ends the loop instead of re-piping.
    expect(transport.readableReads).toBe(3);
  });
});

describe('fpga kind', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setBoardInfo({ slug: '', kind: 'asic', apiBase: undefined });
  });

  test('loads designs from the daemon when the ROM says shuttle=FPGA', async () => {
    setBoardInfo({ slug: 'fpga-1', kind: 'fpga', apiBase: '/api/board/fpga-1' });
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ enabled: null, designs: [] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const device = makeDevice();

    processInput(device, 'shuttle=FPGA');
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledWith('/api/board/fpga-1/designs', expect.anything());
    expect(device.data.shuttle).toBe('FPGA');
  });

  test('selectDesign enables through the daemon instead of select_design()', async () => {
    setBoardInfo({ slug: 'fpga-1', kind: 'fpga', apiBase: '/api/board/fpga-1' });
    updateShuttle({ id: 'FPGA', loading: false, projects: [designToProject(demoA, 0)] });
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ enabled: 'tt_um_demo_a', clock_hz: 1000 }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { device, written } = makeDeviceCapturingWrites();

    await device.selectDesign({ address: 0, subtile: null }, 1000);
    await flushWrites();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/board/fpga-1/designs/tt_um_demo_a/enable',
      expect.anything(),
    );
    expect(written.join('')).not.toContain('select_design');
    expect(deviceState.selectedDesign).toBe(0);
    expect(device.data.designError).toBeNull();
  });

  test('records a daemon error on the device instead of throwing', async () => {
    setBoardInfo({ slug: 'fpga-1', kind: 'fpga', apiBase: '/api/board/fpga-1' });
    updateShuttle({ id: 'FPGA', loading: false, projects: [designToProject(demoA, 0)] });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'another task is running', detail: '' }), {
            status: 409,
          }),
      ),
    );
    const { device } = makeDeviceCapturingWrites();

    await device.selectDesign({ address: 0, subtile: null });

    expect(device.data.designError).toContain('another task is running');
  });

  test('records a network failure on the device instead of throwing', async () => {
    setBoardInfo({ slug: 'fpga-1', kind: 'fpga', apiBase: '/api/board/fpga-1' });
    updateShuttle({ id: 'FPGA', loading: false, projects: [designToProject(demoA, 0)] });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    const { device } = makeDeviceCapturingWrites();

    await device.selectDesign({ address: 0, subtile: null });

    expect(device.data.designError).toContain('Failed to fetch');
  });

  test('reports a missing design without calling the daemon', async () => {
    setBoardInfo({ slug: 'fpga-1', kind: 'fpga', apiBase: '/api/board/fpga-1' });
    updateShuttle({ id: 'FPGA', loading: false, projects: [] });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { device } = makeDeviceCapturingWrites();

    await device.selectDesign({ address: 7, subtile: null });

    expect(device.data.designError).toBe('No design at index 7');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("ignores the REPL's tt.design/tt.subtile, which report the ASIC mux", () => {
    // On an FPGA board the mux address is meaningless — the daemon's `enabled`
    // design name drives the selection — and another viewer's select_design()
    // must not drag this widget's dropdown to a bogus index.
    setBoardInfo({ slug: 'fpga-1', kind: 'fpga', apiBase: '/api/board/fpga-1' });
    updateDeviceState({ selectedDesign: 2, selectedSubtile: null });
    const device = makeDevice();

    processInput(device, 'tt.design=5');
    processInput(device, 'tt.subtile=1');

    expect(deviceState.selectedDesign).toBe(2);
    expect(deviceState.selectedSubtile).toBeNull();
  });

  test('clearDesignError() drops the recorded error', async () => {
    setBoardInfo({ slug: 'fpga-1', kind: 'fpga', apiBase: '/api/board/fpga-1' });
    updateShuttle({ id: 'FPGA', loading: false, projects: [] });
    const { device } = makeDeviceCapturingWrites();
    await device.selectDesign({ address: 7, subtile: null });
    expect(device.data.designError).not.toBeNull();

    device.clearDesignError();

    expect(device.data.designError).toBeNull();
  });
});

describe('asic kind (unchanged behaviour)', () => {
  test('selectDesign still writes select_design() to the board', async () => {
    const { device, written } = makeDeviceCapturingWrites();

    await device.selectDesign({ address: 3, subtile: null }, 50000);
    await flushWrites();

    expect(written.join('')).toContain('select_design(3, 50000)');
  });

  test('a subtile design is still selected by its "address-subtile" string form', async () => {
    const { device, written } = makeDeviceCapturingWrites();

    await device.selectDesign({ address: 3, subtile: 1 });
    await flushWrites();

    expect(written.join('')).toContain('select_design("3-1")');
  });

  test('tt.design/tt.subtile still move the selection on an asic board', () => {
    updateDeviceState({ selectedDesign: 0, selectedSubtile: null });
    const device = makeDevice();

    processInput(device, 'tt.design=5');
    processInput(device, 'tt.subtile=1');

    expect(deviceState.selectedDesign).toBe(5);
    expect(deviceState.selectedSubtile).toBe(1);
    updateDeviceState({ selectedDesign: 0, selectedSubtile: null });
  });

  test('shuttle= still loads the shuttle index for an asic board', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ projects: [] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const device = makeDevice();

    processInput(device, 'shuttle=tt06');
    await Promise.resolve();

    expect(device.data.shuttle).toBe('tt06');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('index.tinytapeout.com/tt06.json'),
    );
    vi.unstubAllGlobals();
  });
});

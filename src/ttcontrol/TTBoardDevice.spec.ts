// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026, fpgas.online contributors

import { afterEach, describe, expect, test, vi } from 'vitest';
import { setBoardInfo } from '~/model/board';
import { deviceState, updateDeviceState } from '~/model/DeviceState';
import { designToProject, FpgaDesign, fpgaDesigns, mergeProjects } from '~/model/fpgaDesigns';
import {
  fpgaLibrary,
  resetFpgaLibrary,
  setFpgaLibraryIndex,
  type LibraryEntry,
} from '~/model/fpgaLibrary';
import { updateShuttle } from '~/model/shuttle';
import fixture from '~/model/testing/fpga-library.json';
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

const libraryEntries = fixture.designs as LibraryEntry[];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A fetch double that answers by URL; an unrouted URL fails the test loudly. */
function routeFetch(routes: Record<string, () => Response>) {
  const fn = vi.fn(async (url: string) => {
    const route = routes[url];
    if (!route) {
      throw new Error(`unexpected fetch ${url}`);
    }
    return route();
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('fpga kind, VGA library', () => {
  const api = '/api/board/fpga-1';
  const entry = libraryEntries[0];

  afterEach(() => {
    vi.unstubAllGlobals();
    setBoardInfo({ slug: '', kind: 'asic', apiBase: undefined });
    resetFpgaLibrary();
    updateDeviceState({ selectedDesign: 0, selectedSubtile: null });
  });

  /** demo A at 0, then the five index entries at 1..5. */
  function setUpMergedList() {
    setBoardInfo({ slug: 'fpga-1', kind: 'fpga', apiBase: api });
    setFpgaLibraryIndex(libraryEntries);
    updateShuttle({
      id: 'FPGA',
      loading: false,
      projects: mergeProjects([demoA], libraryEntries),
    });
  }

  test('selectFpgaDesign routes library projects to the load route and calls syncState', async () => {
    setUpMergedList();
    const fetchMock = routeFetch({
      [`${api}/library/${entry.id}/load`]: () =>
        jsonResponse({
          enabled: entry.id,
          clock_hz: 25175000,
          ui_in: 1,
          ui_in_mask: 1,
          ui_in_driven: [0],
          ui_in_held: [],
          ui_in_inputs: [1, 2, 3, 4, 5, 6, 7],
          released: [],
          pushed: true,
          hides_upload: true,
        }),
    });
    const { device, written } = makeDeviceCapturingWrites();

    await device.selectDesign({ address: 1, subtile: null }, 25175000);
    await flushWrites();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(written.join('')).toContain('dump_state()');
    expect(written.join('')).not.toContain('select_design');
    expect(device.data.designError).toBeNull();
    expect(device.data.designNotice).toContain('inputs set: 0x01');
    expect(device.data.designNotice).toContain('an uploaded design with the same name is hidden');
    expect(fpgaDesigns.enabled).toBe(entry.id);
    expect(fpgaDesigns.byName[entry.id]?.source).toBe('library');
    expect(deviceState.selectedDesign).toBe(1);
  });

  test('selectFpgaDesign keeps enableFpgaDesign for demos', async () => {
    setUpMergedList();
    const fetchMock = routeFetch({
      [`${api}/designs/tt_um_demo_a/enable`]: () =>
        jsonResponse({ enabled: 'tt_um_demo_a', clock_hz: 1000 }),
    });
    const { device, written } = makeDeviceCapturingWrites();

    await device.selectDesign({ address: 0, subtile: null }, 1000);
    await flushWrites();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(device.data.designError).toBeNull();
    expect(device.data.designNotice).toBeNull();
    expect(written.join('')).not.toContain('dump_state()');
    expect(deviceState.selectedDesign).toBe(0);
  });

  test('load error goes to designError', async () => {
    setUpMergedList();
    routeFetch({
      [`${api}/library/${entry.id}/load`]: () =>
        jsonResponse({ error: 'a library load is already running on this board', detail: '' }, 409),
    });
    const { device, written } = makeDeviceCapturingWrites();

    await device.selectDesign({ address: 1, subtile: null });
    await flushWrites();

    expect(device.data.designError).toContain('a library load is already running on this board');
    expect(device.data.designNotice).toBeNull();
    expect(written.join('')).not.toContain('dump_state()');
  });

  test('a vanished id says so and reloads the index', async () => {
    setUpMergedList();
    const fetchMock = routeFetch({
      [`${api}/library/${entry.id}/load`]: () =>
        jsonResponse({ error: 'no such library design', detail: '' }, 404),
      [`${api}/designs`]: () =>
        jsonResponse({ enabled: null, library: { max_bytes: 1, used_bytes: 0 }, designs: [demoA] }),
      [`${api}/library`]: () =>
        jsonResponse({ schema: 1, generated: '', base_url: '', designs: libraryEntries.slice(1) }),
    });
    const { device } = makeDeviceCapturingWrites();

    await device.selectDesign({ address: 1, subtile: null });

    expect(device.data.designError).toContain('no longer in the VGA library');
    expect(fetchMock).toHaveBeenCalledWith(`${api}/library`, expect.anything());
    expect(fpgaLibrary.byId[entry.id]).toBeUndefined();
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

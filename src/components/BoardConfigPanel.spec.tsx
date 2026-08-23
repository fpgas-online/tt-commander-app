// @vitest-environment jsdom
// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026, fpgas.online contributors

import { render } from 'solid-js/web';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { setBoardInfo } from '~/model/board';
import { updateDeviceState } from '~/model/DeviceState';
import { loadFpgaDesigns, type FpgaDesign } from '~/model/fpgaDesigns';
import { updateShuttle } from '~/model/shuttle';
import type { SerialTransport, TransportState } from '~/transport/SerialTransport';
import { TTBoardDevice } from '~/ttcontrol/TTBoardDevice';
import { BoardConfigPanel } from './BoardConfigPanel';

/** A carrier that never delivers or accepts a byte: the panel never talks to it. */
class InertTransport extends EventTarget implements SerialTransport {
  state: TransportState = 'open';
  readonly readable = new ReadableStream<Uint8Array>();
  readonly writable = new WritableStream<Uint8Array>();
  async close() {
    this.state = 'closed';
  }
}

/** `setData` is private; the panel only ever reads what the device recorded. */
function setDeviceData(device: TTBoardDevice, key: string, value: unknown) {
  (device as unknown as { setData(key: string, value: unknown): void }).setData(key, value);
}

function renderPanel(device = new TTBoardDevice(new InertTransport())) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const dispose = render(() => <BoardConfigPanel device={device} />, host);
  return { host, device, dispose };
}

const cleanups: (() => void)[] = [];

afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
  document.body.innerHTML = '';
  setBoardInfo({ slug: '', kind: 'asic', apiBase: undefined });
  updateShuttle({ id: 'unknown', projects: [], loading: true });
  updateDeviceState({ selectedDesign: 0, selectedSubtile: null });
  vi.unstubAllGlobals();
});

const demoDesign: FpgaDesign = {
  name: 'tt_um_demo_a',
  title: 'Demo A',
  author: 'fpgas.online',
  description: 'First demo',
  docs_url: 'https://example.org/demo-a',
  repo_url: 'https://github.com/fpgas-online/demos',
  clock_hz: 1000,
  pinout: {},
  source: 'demo',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Puts the given designs into the stores the way the daemon load does. */
async function loadDesigns(...list: FpgaDesign[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => jsonResponse({ enabled: list[0]?.name ?? null, designs: list })),
  );
  await loadFpgaDesigns('/api/board/fpga-1');
}

function linkHrefs(host: HTMLElement) {
  return [...host.querySelectorAll('a')].map((a) => a.getAttribute('href'));
}

function panel(device?: TTBoardDevice) {
  const rendered = renderPanel(device);
  cleanups.push(() => {
    rendered.dispose();
    rendered.host.remove();
  });
  return rendered;
}

function labels(host: HTMLElement) {
  return [...host.querySelectorAll('label')].map((l) => l.textContent);
}

function buttonTexts(host: HTMLElement) {
  return [...host.querySelectorAll('button')].map((b) => b.textContent);
}

describe('BoardConfigPanel (asic)', () => {
  test('offers the mux Index field and a Select button', () => {
    const { host } = panel();
    expect(labels(host)).toContain('Index');
    expect(buttonTexts(host)).toContain('Select');
  });
});

describe('BoardConfigPanel (fpga)', () => {
  test('hides the mux Index field and loads designs by name', () => {
    setBoardInfo({ slug: 'fpga-1', kind: 'fpga', apiBase: '/api/board/fpga-1' });
    const { host } = panel();
    expect(labels(host)).not.toContain('Index');
    expect(buttonTexts(host)).toContain('Load design');
    expect(buttonTexts(host)).not.toContain('Select');
  });

  test('renders when the board reports no parseable firmware version', () => {
    // Issue #7: an FPGA board answers `unknown`, which used to throw out of the
    // version comparison during render and blank the whole tab.
    setBoardInfo({ slug: 'fpga-1', kind: 'fpga', apiBase: '/api/board/fpga-1' });
    const device = new TTBoardDevice(new InertTransport());
    setDeviceData(device, 'version', 'unknown');
    const { host } = panel(device);
    expect(buttonTexts(host)).toContain('Load design');
  });

  test('shows a daemon error and lets the user dismiss it', () => {
    setBoardInfo({ slug: 'fpga-1', kind: 'fpga', apiBase: '/api/board/fpga-1' });
    const device = new TTBoardDevice(new InertTransport());
    const { host } = panel(device);
    expect(host.textContent).not.toContain('another task is running');

    setDeviceData(device, 'designError', 'another task is running');
    expect(host.textContent).toContain('another task is running');

    host.querySelector<HTMLButtonElement>('[aria-label="Close"]')?.click();
    expect(device.data.designError).toBeNull();
    expect(host.textContent).not.toContain('another task is running');
  });
});

describe('BoardConfigPanel (fpga) design-list errors', () => {
  test('shows the daemon failure and refetches when Retry is clicked', async () => {
    setBoardInfo({ slug: 'fpga-1', kind: 'fpga', apiBase: '/api/board/fpga-1' });
    const failing = vi.fn(async () =>
      jsonResponse({ error: 'board not present', detail: '' }, 503),
    );
    vi.stubGlobal('fetch', failing);
    await loadFpgaDesigns('/api/board/fpga-1');

    const { host } = panel();
    expect(host.textContent).toContain('board not present');

    const retry = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Retry');
    expect(retry).toBeDefined();
    const refetch = vi.fn(async () => jsonResponse({ enabled: null, designs: [] }));
    vi.stubGlobal('fetch', refetch);

    retry?.click();
    await Promise.resolve();

    expect(refetch).toHaveBeenCalledWith('/api/board/fpga-1/designs', expect.anything());
  });

  test('shows no design-list error on an asic board', async () => {
    // fpgaDesigns.error is module-global; an asic board must not inherit it.
    setBoardInfo({ slug: 'fpga-1', kind: 'fpga', apiBase: '/api/board/fpga-1' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'board not present', detail: '' }, 503)),
    );
    await loadFpgaDesigns('/api/board/fpga-1');
    setBoardInfo({ slug: 'tt06', kind: 'asic', apiBase: undefined });

    const { host } = panel();

    expect(host.textContent).not.toContain('board not present');
  });
});

describe('BoardConfigPanel (fpga) project links', () => {
  test("links to the design's own docs and repo, never to tinytapeout.com", async () => {
    setBoardInfo({ slug: 'fpga-1', kind: 'fpga', apiBase: '/api/board/fpga-1' });
    await loadDesigns(demoDesign);

    const { host } = panel();

    expect(linkHrefs(host)).toEqual([
      'https://example.org/demo-a',
      'https://github.com/fpgas-online/demos',
    ]);
    expect(host.textContent).not.toContain('Report results');
  });

  test('renders no link buttons for a design with no URLs', async () => {
    setBoardInfo({ slug: 'fpga-1', kind: 'fpga', apiBase: '/api/board/fpga-1' });
    await loadDesigns({ ...demoDesign, name: 'my_upload', docs_url: '', repo_url: '' });

    const { host } = panel();

    expect(linkHrefs(host)).toEqual([]);
    expect(host.textContent).not.toContain('Project docs');
    expect(host.textContent).not.toContain('Repo');
  });

  test('an asic board still gets all three tinytapeout links', () => {
    updateShuttle({
      id: 'tt06',
      loading: false,
      projects: [
        {
          macro: 'tt_um_thing',
          address: 0,
          title: 'Thing',
          author: 'someone',
          repo: 'https://github.com/someone/thing',
          commit: 'abc123',
          clock_hz: 1000,
          type: 'project',
        },
      ],
    });

    const { host } = panel();

    expect(linkHrefs(host)).toEqual([
      'https://app.tinytapeout.com/shuttles/tt06/tt_um_thing/feedback',
      'https://tinytapeout.com/chips/tt06/tt_um_thing',
      'https://github.com/someone/thing/tree/abc123',
    ]);
  });
});

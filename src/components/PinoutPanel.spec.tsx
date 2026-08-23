// @vitest-environment jsdom
// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026, fpgas.online contributors

import { render } from 'solid-js/web';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { setBoardInfo } from '~/model/board';
import { updateDeviceState } from '~/model/DeviceState';
import { updateFpgaDesigns, type FpgaDesign } from '~/model/fpgaDesigns';
import { updateShuttle, type Project } from '~/model/shuttle';
import type { SerialTransport, TransportState } from '~/transport/SerialTransport';
import { TTBoardDevice } from '~/ttcontrol/TTBoardDevice';
import { PinoutPanel } from './PinoutPanel';

/** A carrier that never delivers or accepts a byte: the panel never talks to it. */
class InertTransport extends EventTarget implements SerialTransport {
  state: TransportState = 'open';
  readonly readable = new ReadableStream<Uint8Array>();
  readonly writable = new WritableStream<Uint8Array>();
  async close() {
    this.state = 'closed';
  }
}

const demoA: FpgaDesign = {
  name: 'tt_um_demo_a',
  title: 'Demo A',
  author: 'fpgas.online',
  description: 'First demo',
  docs_url: '',
  repo_url: '',
  clock_hz: 1000,
  pinout: {
    ui_in: ['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'],
    uo_out: ['o0', 'o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7'],
    uio: ['', '', '', '', '', '', '', ''],
  },
  source: 'demo',
};

const demoAProject: Project = {
  macro: 'tt_um_demo_a',
  address: 0,
  title: 'Demo A',
  author: 'fpgas.online',
  repo: '',
  commit: '',
  clock_hz: 1000,
  danger_level: 'safe',
  type: 'project',
};

/** Let queued resource promise jobs run. */
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  document.body.innerHTML = '';
  setBoardInfo({ slug: '', kind: 'asic', apiBase: undefined });
  updateFpgaDesigns({ byName: {}, enabled: null });
  updateShuttle({ projects: [] });
  updateDeviceState({ selectedDesign: 0, selectedSubtile: null });
  vi.unstubAllGlobals();
});

describe('PinoutPanel (fpga)', () => {
  test('renders the pinout from design metadata, with no network call', async () => {
    setBoardInfo({ slug: 'fpga-1', kind: 'fpga', apiBase: '/api/board/fpga-1' });
    updateFpgaDesigns({ byName: { tt_um_demo_a: demoA } });
    updateShuttle({ projects: [demoAProject] });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const device = new TTBoardDevice(new InertTransport());
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = render(() => <PinoutPanel device={device} />, host);
    await flush();

    expect(host.textContent).toContain('a0');
    expect(host.textContent).toContain('o0');
    expect(host.textContent).toContain('fpgas.online');
    expect(host.textContent).toContain('First demo');
    expect(fetchMock).not.toHaveBeenCalled();

    dispose();
    host.remove();
  });
});

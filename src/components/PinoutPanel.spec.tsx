// @vitest-environment jsdom
// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026, fpgas.online contributors

import { render } from 'solid-js/web';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { setBoardInfo } from '~/model/board';
import { updateDeviceState } from '~/model/DeviceState';
import { mergeProjects, updateFpgaDesigns, type FpgaDesign } from '~/model/fpgaDesigns';
import { resetFpgaLibrary, setFpgaLibraryIndex, type LibraryEntry } from '~/model/fpgaLibrary';
import { updateShuttle, type Project } from '~/model/shuttle';
import fixture from '~/model/testing/fpga-library.json';
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

const demoB: FpgaDesign = {
  name: 'tt_um_demo_b',
  title: 'Demo B',
  author: 'fpgas.online',
  description: 'Second demo',
  docs_url: '',
  repo_url: '',
  clock_hz: 1000,
  pinout: {
    ui_in: ['b0', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7'],
    uo_out: ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'],
    uio: ['', '', '', '', '', '', '', ''],
  },
  source: 'demo',
};

const demoBProject: Project = {
  macro: 'tt_um_demo_b',
  address: 1,
  title: 'Demo B',
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
  resetFpgaLibrary();
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

  test('re-derives the pinout when the selected design changes while mounted', async () => {
    setBoardInfo({ slug: 'fpga-1', kind: 'fpga', apiBase: '/api/board/fpga-1' });
    updateFpgaDesigns({ byName: { tt_um_demo_a: demoA, tt_um_demo_b: demoB } });
    updateShuttle({ projects: [demoAProject, demoBProject] });

    const device = new TTBoardDevice(new InertTransport());
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = render(() => <PinoutPanel device={device} />, host);
    await flush();

    expect(host.textContent).toContain('a0');
    expect(host.textContent).not.toContain('b0');

    updateDeviceState({ selectedDesign: 1 });
    await flush();

    expect(host.textContent).toContain('b0');
    expect(host.textContent).toContain('c0');
    expect(host.textContent).not.toContain('a0');

    dispose();
    host.remove();
  });

  test('re-derives the pinout when fpgaDesigns.byName is refreshed while mounted', async () => {
    setBoardInfo({ slug: 'fpga-1', kind: 'fpga', apiBase: '/api/board/fpga-1' });
    updateFpgaDesigns({ byName: { tt_um_demo_a: demoA } });
    updateShuttle({ projects: [demoAProject] });

    const device = new TTBoardDevice(new InertTransport());
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = render(() => <PinoutPanel device={device} />, host);
    await flush();

    expect(host.textContent).toContain('a0');

    // Simulate refreshDesigns() picking up an updated pinout for the same design.
    const updatedDemoA: FpgaDesign = {
      ...demoA,
      pinout: {
        ui_in: ['z0', 'z1', 'z2', 'z3', 'z4', 'z5', 'z6', 'z7'],
        uo_out: ['y0', 'y1', 'y2', 'y3', 'y4', 'y5', 'y6', 'y7'],
        uio: ['', '', '', '', '', '', '', ''],
      },
    };
    updateFpgaDesigns({ byName: { tt_um_demo_a: updatedDemoA } });
    await flush();

    expect(host.textContent).toContain('z0');
    expect(host.textContent).toContain('y0');
    expect(host.textContent).not.toContain('a0');

    dispose();
    host.remove();
  });
});

const libraryEntries = fixture.designs as LibraryEntry[];

/** A library entry as `/designs` lists it: the upload shape plus `source` and `size` (N2). */
function onBoard(name: string): FpgaDesign {
  return {
    name,
    title: '',
    author: '',
    description: '',
    docs_url: '',
    repo_url: '',
    clock_hz: null,
    pinout: {},
    source: 'library',
    size: 4096,
  };
}

/** The text of each cell of the pinout table's body, row by row. */
function pinoutRows(host: HTMLElement) {
  return [...host.querySelectorAll('tbody tr')].map((tr) =>
    [...tr.querySelectorAll('td')].map((td) => td.textContent),
  );
}

function renderPinout() {
  const device = new TTBoardDevice(new InertTransport());
  const host = document.createElement('div');
  document.body.appendChild(host);
  const dispose = render(() => <PinoutPanel device={device} />, host);
  return { host, dispose };
}

describe('PinoutPanel (fpga, VGA library)', () => {
  test('Pinout tab of an enabled library design shows the index pinout', async () => {
    setBoardInfo({ slug: 'fpga-1', kind: 'fpga', apiBase: '/api/board/fpga-1' });
    const entry = { ...libraryEntries[1], description: 'From the index' };
    updateFpgaDesigns({ byName: { [entry.id]: onBoard(entry.id) }, enabled: entry.id });
    setFpgaLibraryIndex([entry]);
    updateShuttle({ projects: mergeProjects([onBoard(entry.id)], [entry]) });
    updateDeviceState({ selectedDesign: 0, selectedSubtile: null });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { host, dispose } = renderPinout();
    await flush();

    // Row 0: #, Input, Output, Bidirectional.
    expect(pinoutRows(host)[0]).toEqual(['0', '', 'R1', '']);
    expect(pinoutRows(host)[7]).toEqual(['7', '', 'HSync', '']);
    expect(host.textContent).toContain('VGA Example');
    expect(host.textContent).toContain('Uri Shaked');
    expect(host.textContent).toContain('From the index');
    expect(fetchMock).not.toHaveBeenCalled();

    dispose();
    host.remove();
  });

  test('library entry missing from the index renders an empty pinout without throwing', async () => {
    setBoardInfo({ slug: 'fpga-1', kind: 'fpga', apiBase: '/api/board/fpga-1' });
    // Only name, source and size are promised for a library design from /designs.
    const bare = { name: 'tt05_vanished', source: 'library', size: 4096 } as FpgaDesign;
    updateFpgaDesigns({ byName: { tt05_vanished: bare }, enabled: 'tt05_vanished' });
    setFpgaLibraryIndex(libraryEntries);
    updateShuttle({ projects: mergeProjects([bare], libraryEntries) });
    updateDeviceState({ selectedDesign: libraryEntries.length, selectedSubtile: null });

    const { host, dispose } = renderPinout();
    await flush();

    expect(host.textContent).toContain('tt05_vanished');
    expect(host.textContent).not.toContain('Error loading documentation');
    expect(pinoutRows(host)).toHaveLength(8);
    expect(pinoutRows(host)[0]).toEqual(['0', '', '', '']);

    dispose();
    host.remove();
  });
});

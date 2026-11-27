// @vitest-environment jsdom
// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026, fpgas.online contributors

import { render } from 'solid-js/web';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { setBoardInfo } from '~/model/board';
import { updateDeviceState } from '~/model/DeviceState';
import {
  designToProject,
  loadFpgaDesigns,
  mergeProjects,
  updateFpgaDesigns,
  type FpgaDesign,
} from '~/model/fpgaDesigns';
import {
  fpgaLibrary,
  libraryToProject,
  PROJECT_LIMIT,
  resetFpgaLibrary,
  setFpgaLibraryIndex,
  updateFpgaLibrary,
  type LibraryEntry,
} from '~/model/fpgaLibrary';
import { updateShuttle, type Project } from '~/model/shuttle';
import fixture from '~/model/testing/fpga-library.json';
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

const libraryEntries = fixture.designs as LibraryEntry[];

/** Puts library projects (and optionally more) into the stores without a fetch. */
function showLibrary(projects: Project[] = mergeProjects([], libraryEntries)) {
  setBoardInfo({ slug: 'fpga-1', kind: 'fpga', apiBase: '/api/board/fpga-1' });
  setFpgaLibraryIndex(libraryEntries);
  updateShuttle({ id: 'FPGA', loading: false, projects });
}

function loadButton(host: HTMLElement) {
  return [...host.querySelectorAll('button')].find((b) => b.textContent === 'Load design');
}

/** Opens the project picker and returns the popper's root (it is portalled to body). */
function openPicker(host: HTMLElement, text?: string) {
  const input = host.querySelector<HTMLInputElement>('input[autocomplete="off"]');
  expect(input).not.toBeNull();
  input!.focus();
  input!.click();
  if (text !== undefined) {
    input!.value = text;
    input!.dispatchEvent(new Event('input', { bubbles: true }));
  }
  return document.body;
}

function optionTexts(root: HTMLElement) {
  return [...root.querySelectorAll('.MuiListItemButton-root')].map((el) => el.textContent ?? '');
}

describe('BoardConfigPanel (fpga) VGA library', () => {
  afterEach(() => {
    resetFpgaLibrary();
    updateFpgaDesigns({ hasLibrary: false });
  });

  test('timing-fail shows warning icon and Load stays enabled', () => {
    const timingFail = libraryEntries[4];
    showLibrary();
    updateDeviceState({ selectedDesign: 4, selectedSubtile: null });

    const { host } = panel();

    const reason = 'timing: 17.08 MHz < 25.175 MHz; not hardware-validated';
    expect(host.querySelector(`span[title="${reason}"] svg`)).not.toBeNull();
    expect(loadButton(host)?.disabled).toBe(false);
    // Every badge is listed under the selector.
    expect(host.textContent).toContain('timing: 17.08 MHz < 25.175 MHz');
    expect(host.textContent).toContain('not hardware-validated');
    expect(timingFail.build_status).toBe('timing-fail');
  });

  test('a PDK latch design shows the warning icon and Load stays enabled', () => {
    // Ruling BJ: row 1 with pdk_latches set, otherwise warning-free.
    const latch = { ...libraryEntries[1], validation: 'full-speed', pdk_latches: true };
    const entries = libraryEntries.map((e, i) => (i === 1 ? latch : e));
    showLibrary(mergeProjects([], entries));
    setFpgaLibraryIndex(entries);
    updateDeviceState({ selectedDesign: 1, selectedSubtile: null });

    const { host } = panel();

    const reason = 'PDK latch cells: may not behave as on silicon';
    expect(host.querySelector(`span[title="${reason}"] svg`)).not.toBeNull();
    expect(loadButton(host)?.disabled).toBe(false);
    expect(host.textContent).toContain(reason);
  });

  test('a design that only lacks hardware validation gets no warning icon', () => {
    showLibrary();
    updateDeviceState({ selectedDesign: 1, selectedSubtile: null });

    const { host } = panel();

    expect(host.textContent).toContain('not hardware-validated');
    expect(host.querySelector('span[title] svg')).toBeNull();
    expect(loadButton(host)?.disabled).toBe(false);
  });

  test('designNotice shows inputs set', async () => {
    // Row 1 has no inputs-set badge of its own; the notice comes from a real load.
    showLibrary();
    updateDeviceState({ selectedDesign: 1, selectedSubtile: null });
    const id = libraryEntries[1].id;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          enabled: id,
          ui_in: 1,
          ui_in_driven: [0],
          ui_in_held: [],
          released: [],
          pushed: true,
          hides_upload: false,
        }),
      ),
    );
    const device = new TTBoardDevice(new InertTransport());
    const { host } = panel(device);
    expect(host.textContent).not.toContain('inputs set: 0x01');

    await device.selectDesign({ address: 1, subtile: null });

    expect(host.textContent).toContain('VGA Example: inputs set: 0x01');

    // Another project selected: the notice is about a design not shown.
    updateDeviceState({ selectedDesign: 2, selectedSubtile: null });
    expect(host.textContent).not.toContain('inputs set: 0x01');
  });

  test('not published yet is said, and the board designs still load', () => {
    setBoardInfo({ slug: 'fpga-1', kind: 'fpga', apiBase: '/api/board/fpga-1' });
    updateFpgaDesigns({ hasLibrary: true });
    updateFpgaLibrary({ state: 'notPublished' });

    const { host } = panel();

    expect(host.textContent).toContain('The VGA library is not published yet.');
  });

  test('links of a library design come from the index', () => {
    showLibrary();
    updateDeviceState({ selectedDesign: 1, selectedSubtile: null });

    const { host } = panel();

    expect(linkHrefs(host)).toEqual([libraryEntries[1].docs_url, libraryEntries[1].repo_url]);
  });

  test('search matches shuttle and macro', async () => {
    showLibrary(
      [demoDesign]
        .map(designToProject)
        .concat(libraryEntries.map((e, i) => libraryToProject(e, i + 1))),
    );
    const { host } = panel();

    const root = openPicker(host, 'ttihp25a');
    await Promise.resolve();
    expect(optionTexts(root)[0]).toContain('Sea Battle VGA Game');

    openPicker(host, 'tt_um_flappy_vga_cutout1');
    await Promise.resolve();
    expect(optionTexts(root)[0]).toContain('Flappy VGA');
  });

  test('options capped at 100 with a narrow-down line', async () => {
    const many: Project[] = Array.from({ length: 150 }, (_, i) =>
      libraryToProject({ ...libraryEntries[1], id: `tt05_design_${i}`, title: `Design ${i}` }, i),
    );
    showLibrary(many);
    const { host } = panel();

    const root = openPicker(host);
    await Promise.resolve();

    expect(optionTexts(root)).toHaveLength(PROJECT_LIMIT);
    expect(root.textContent).toContain('showing 100 of 150 VGA library designs; type to narrow');
  });

  test('a demo that matches stays listed beside more than 100 library matches', async () => {
    const demo = designToProject({ ...demoDesign, title: 'Design demo' }, 0);
    const many: Project[] = Array.from({ length: 150 }, (_, i) =>
      libraryToProject(
        { ...libraryEntries[1], id: `tt05_design_${i}`, title: `Design ${i}` },
        i + 1,
      ),
    );
    showLibrary([demo, ...many]);
    const { host } = panel();

    const root = openPicker(host, 'design');
    await Promise.resolve();

    const texts = optionTexts(root);
    expect(texts.some((t) => t.includes('Design demo'))).toBe(true);
    expect(texts).toHaveLength(PROJECT_LIMIT + 1);
    expect(root.textContent).toContain('showing 100 of 150 VGA library designs; type to narrow');
  });

  test('an upload hidden by a library design of the same name cannot be picked', async () => {
    const id = libraryEntries[1].id;
    const hidden: FpgaDesign = { ...demoDesign, name: id, title: '', source: 'upload' };
    const cached: FpgaDesign = { ...hidden, source: 'library', size: 4096 };
    showLibrary(mergeProjects([hidden, cached], libraryEntries));
    updateFpgaDesigns({ byName: { [id]: cached } });
    const { host } = panel();

    const root = openPicker(host);
    await Promise.resolve();

    const buttons = [...root.querySelectorAll('.MuiListItemButton-root')];
    const upload = buttons.find((b) => b.textContent?.includes('hidden by a VGA library design'));
    expect(upload).toBeDefined();
    expect(upload?.classList.contains('Mui-disabled')).toBe(true);
    updateFpgaDesigns({ byName: {} });
  });
});

describe('BoardConfigPanel (fpga) index arriving', () => {
  afterEach(() => {
    resetFpgaLibrary();
    updateFpgaDesigns({ hasLibrary: false, byName: {}, enabled: null });
  });

  test('typing while the index arrives keeps the typed text', async () => {
    setBoardInfo({ slug: 'fpga-1', kind: 'fpga', apiBase: '/api/board/fpga-1' });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/library')) {
          await gate;
          return jsonResponse({ schema: 1, generated: '', base_url: '', designs: libraryEntries });
        }
        return jsonResponse({
          enabled: demoDesign.name,
          library: { max_bytes: 1, used_bytes: 0 },
          designs: [demoDesign],
        });
      }),
    );
    const loading = loadFpgaDesigns('/api/board/fpga-1');
    await vi.waitFor(() => expect(fpgaLibrary.state).toBe('loading'));
    const { host } = panel();

    const root = openPicker(host, 'flappy');
    await Promise.resolve();
    release();
    await loading;
    await Promise.resolve();

    const input = host.querySelector<HTMLInputElement>('input[autocomplete="off"]');
    expect(input?.value).toBe('flappy');
    expect(optionTexts(root)[0]).toContain('Flappy VGA');
  });
});

describe('BoardConfigPanel (asic) project picker', () => {
  test('an ASIC shuttle with 150 projects shows all 150', async () => {
    updateShuttle({
      id: 'tt06',
      loading: false,
      projects: Array.from({ length: 150 }, (_, i) => ({
        macro: `tt_um_p${i}`,
        address: i,
        title: `Project ${i}`,
        author: 'someone',
        repo: '',
        commit: '',
        clock_hz: 0,
        type: 'project' as const,
      })),
    });
    const { host } = panel();

    const root = openPicker(host);
    await Promise.resolve();

    expect(optionTexts(root)).toHaveLength(150);
    expect(root.textContent).not.toContain('type to narrow');
  });
});

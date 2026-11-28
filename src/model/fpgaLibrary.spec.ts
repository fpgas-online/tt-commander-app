// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026, fpgas.online contributors

import { afterEach, describe, expect, test, vi } from 'vitest';
import { deviceState, updateDeviceState } from './DeviceState';
import {
  fpgaDesigns,
  loadFpgaDesigns,
  mergeProjects,
  setCsrfToken,
  type FpgaDesign,
} from './fpgaDesigns';
import {
  fpgaLibrary,
  libraryToProject,
  libraryWarnings,
  loadFpgaLibrary,
  loadLibraryDesign,
  resetFpgaLibrary,
  type LibraryEntry,
} from './fpgaLibrary';
import { shuttle, updateShuttle } from './shuttle';
import fixture from './testing/fpga-library.json';

const API = '/api/board/fpga-1';

/** The site's normalised index: the archive document plus `base_url`. */
const siteIndex = {
  schema: 1,
  generated: fixture.generated,
  base_url: 'https://data.wafer.space/big-storage/tinytapeout-vga-videos/',
  designs: fixture.designs as LibraryEntry[],
};
const entries = siteIndex.designs;

const upload: FpgaDesign = {
  name: 'my_upload',
  title: '',
  author: '',
  description: '',
  docs_url: '',
  repo_url: '',
  clock_hz: null,
  pinout: {},
  source: 'upload',
};

const demo: FpgaDesign = {
  name: 'tt_um_demo_a',
  title: 'Demo A',
  author: 'fpgas.online',
  description: 'First demo',
  docs_url: '',
  repo_url: '',
  clock_hz: 1000,
  pinout: {},
  source: 'demo',
};

/** A library entry as `/designs` lists it: the upload shape plus `source` and `size` (N2). */
function onBoard(name: string): FpgaDesign {
  return { ...upload, name, source: 'library', size: 4096 };
}

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

function designsBody(enabled: string | null, designs: FpgaDesign[], library = true) {
  return {
    enabled,
    ...(library ? { library: { max_bytes: 16777216, used_bytes: 4096 } } : {}),
    designs,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken(undefined);
  resetFpgaLibrary();
  updateShuttle({ id: 'unknown', projects: [], loading: true });
  updateDeviceState({ selectedDesign: 0, selectedSubtile: null });
});

describe('loading', () => {
  test('library not loaded when designs lack the library key', async () => {
    const fetchMock = routeFetch({
      [`${API}/designs`]: () => jsonResponse(designsBody(null, [demo, upload], false)),
    });

    await loadFpgaDesigns(API);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fpgaLibrary.state).toBe('idle');
    expect(shuttle.projects.map((p) => p.macro)).toEqual(['tt_um_demo_a', 'my_upload']);
  });

  test('the index is fetched once the board reports library support', async () => {
    routeFetch({
      [`${API}/designs`]: () => jsonResponse(designsBody(null, [demo])),
      [`${API}/library`]: () => jsonResponse(siteIndex),
    });

    await loadFpgaDesigns(API);

    expect(fpgaLibrary.state).toBe('ready');
    expect(Object.keys(fpgaLibrary.byId)).toHaveLength(entries.length);
    expect(shuttle.projects).toHaveLength(1 + entries.length);
  });

  test('notPublished state on 404', async () => {
    routeFetch({
      [`${API}/designs`]: () => jsonResponse(designsBody(null, [demo, onBoard('tt05_orphan')])),
      [`${API}/library`]: () =>
        jsonResponse({ error: 'VGA library not published', detail: '' }, 404),
    });

    await loadFpgaDesigns(API);

    expect(fpgaLibrary.state).toBe('notPublished');
    expect(fpgaLibrary.error).toBeNull();
    // The board's own designs are still offered, including a cached library entry by name.
    expect(shuttle.projects.map((p) => p.macro)).toEqual(['tt_um_demo_a', 'tt05_orphan']);
    expect(fpgaDesigns.error).toBeNull();
  });

  test('any other index failure is an error state, not notPublished', async () => {
    routeFetch({
      [`${API}/designs`]: () => jsonResponse(designsBody(null, [demo])),
      [`${API}/library`]: () => jsonResponse({ error: 'VGA library unavailable', detail: '' }, 502),
    });

    await loadFpgaDesigns(API);

    expect(fpgaLibrary.state).toBe('error');
    expect(fpgaLibrary.error).toContain('VGA library unavailable');
    expect(shuttle.projects.map((p) => p.macro)).toEqual(['tt_um_demo_a']);
  });

  test('a ready index is not refetched on every design-list refresh', async () => {
    const fetchMock = routeFetch({
      [`${API}/designs`]: () => jsonResponse(designsBody(null, [demo])),
      [`${API}/library`]: () => jsonResponse(siteIndex),
    });

    await loadFpgaDesigns(API);
    await loadFpgaDesigns(API);

    const libraryCalls = fetchMock.mock.calls.filter(([url]) => url === `${API}/library`);
    expect(libraryCalls).toHaveLength(1);
  });
});

describe('loading order and concurrency', () => {
  test('board designs are published before a slow index arrives', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    routeFetch({
      [`${API}/designs`]: () => jsonResponse(designsBody(null, [demo, upload])),
      [`${API}/library`]: () => jsonResponse(siteIndex),
    });
    const fetchMock = vi.mocked(fetch);
    const routed = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url) => {
      if (url === `${API}/library`) {
        await gate;
      }
      return routed(url as string);
    });

    const loading = loadFpgaDesigns(API);
    await vi.waitFor(() => expect(fpgaLibrary.state).toBe('loading'));

    expect(shuttle.loading).toBe(false);
    expect(shuttle.projects.map((p) => p.macro)).toEqual(['tt_um_demo_a', 'my_upload']);

    release();
    await loading;
    expect(shuttle.projects).toHaveLength(2 + entries.length);
  });

  test('concurrent loads share one index request', async () => {
    const fetchMock = routeFetch({
      [`${API}/designs`]: () => jsonResponse(designsBody(null, [demo])),
      [`${API}/library`]: () => jsonResponse(siteIndex),
    });

    await Promise.all([loadFpgaDesigns(API), loadFpgaDesigns(API)]);

    const libraryCalls = fetchMock.mock.calls.filter(([url]) => url === `${API}/library`);
    expect(libraryCalls).toHaveLength(1);
    expect(shuttle.projects).toHaveLength(1 + entries.length);
  });

  test('the pick survives the index being merged in', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    routeFetch({
      [`${API}/designs`]: () => jsonResponse(designsBody(null, [demo, upload])),
      [`${API}/library`]: () => jsonResponse(siteIndex),
    });
    const fetchMock = vi.mocked(fetch);
    const routed = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url) => {
      if (url === `${API}/library`) {
        await gate;
      }
      return routed(url as string);
    });

    const loading = loadFpgaDesigns(API);
    await vi.waitFor(() => expect(fpgaLibrary.state).toBe('loading'));
    updateDeviceState({ selectedDesign: 1, selectedSubtile: null });
    release();
    await loading;

    expect(shuttle.projects[deviceState.selectedDesign]?.macro).toBe('my_upload');
  });
});

describe('index fetch and reset', () => {
  test('a fetch that a reset overtook drops its result, even when it resolves last', async () => {
    let releaseOld!: () => void;
    const oldGate = new Promise<void>((resolve) => (releaseOld = resolve));
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        if (calls === 1) {
          await oldGate;
          return jsonResponse(siteIndex);
        }
        return jsonResponse({ ...siteIndex, designs: entries.slice(1) });
      }),
    );

    const old = loadFpgaLibrary(API);
    resetFpgaLibrary();
    await loadFpgaLibrary(API);
    expect(Object.keys(fpgaLibrary.byId)).toHaveLength(entries.length - 1);

    releaseOld();
    await old;

    expect(fpgaLibrary.state).toBe('ready');
    expect(Object.keys(fpgaLibrary.byId)).toHaveLength(entries.length - 1);
    expect(fpgaLibrary.byId[entries[0].id]).toBeUndefined();
    expect(calls).toBe(2);
  });
});

describe('mergeProjects', () => {
  test('merge keeps board designs first then index order, address is position', () => {
    const projects = mergeProjects([onBoard(entries[1].id), upload, demo], entries);

    expect(projects.map((p) => p.macro)).toEqual([
      'my_upload',
      'tt_um_demo_a',
      ...entries.map((e) => e.id),
    ]);
    expect(projects.map((p) => p.address)).toEqual(projects.map((_, i) => i));
    expect(projects.map((p) => p.source)).toEqual([
      'upload',
      'demo',
      ...entries.map(() => 'library'),
    ]);
    const vgaExample = projects.find((p) => p.macro === 'ttsky25a_vga_example');
    expect(vgaExample).toMatchObject({
      title: 'VGA Example',
      author: 'Uri Shaked',
      shuttle: 'ttsky25a',
      clock_hz: 25175000,
      source: 'library',
      commit: entries[1].commit,
      repo: entries[1].repo_url,
    });
  });

  test('a library entry and an upload of the same name are two projects', () => {
    const name = entries[1].id;
    const projects = mergeProjects([{ ...upload, name }, onBoard(name)], entries);

    const same = projects.filter((p) => p.macro === name);
    expect(same.map((p) => p.source)).toEqual(['upload', 'library']);
    expect(new Set(same.map((p) => p.address)).size).toBe(2);
  });

  test('a cached library entry missing from the index is shown under its name', () => {
    const projects = mergeProjects([demo, onBoard('tt05_vanished')], entries);

    expect(projects.at(-1)).toMatchObject({
      macro: 'tt05_vanished',
      title: 'tt05_vanished',
      source: 'library',
      address: projects.length - 1,
    });
  });
});

describe('selection', () => {
  test('selection prefers the source /designs reports for the enabled name', async () => {
    const name = entries[1].id;

    // An upload made before the index existed shares the id, and /designs lists only the upload.
    routeFetch({
      [`${API}/designs`]: () => jsonResponse(designsBody(name, [{ ...upload, name }])),
      [`${API}/library`]: () => jsonResponse(siteIndex),
    });
    await loadFpgaDesigns(API);
    expect(shuttle.projects[deviceState.selectedDesign]).toMatchObject({
      macro: name,
      source: 'upload',
    });

    // The library entry is pushed on top of it: the name now resolves to the library.
    routeFetch({
      [`${API}/designs`]: () =>
        jsonResponse(designsBody(name, [{ ...upload, name }, onBoard(name)])),
      [`${API}/library`]: () => jsonResponse(siteIndex),
    });
    await loadFpgaDesigns(API);
    expect(shuttle.projects[deviceState.selectedDesign]).toMatchObject({
      macro: name,
      source: 'library',
    });
  });

  test('an enabled name /designs does not list selects the library project', async () => {
    const name = entries[2].id;
    routeFetch({
      [`${API}/designs`]: () => jsonResponse(designsBody(name, [demo])),
      [`${API}/library`]: () => jsonResponse(siteIndex),
    });

    await loadFpgaDesigns(API);

    expect(shuttle.projects[deviceState.selectedDesign]).toMatchObject({
      macro: name,
      source: 'library',
    });
  });

  test('enabled id missing from list does not throw', async () => {
    updateDeviceState({ selectedDesign: 0, selectedSubtile: null });
    routeFetch({
      [`${API}/designs`]: () => jsonResponse(designsBody('ttxx_gone', [demo])),
      [`${API}/library`]: () => jsonResponse(siteIndex),
    });

    await expect(loadFpgaDesigns(API)).resolves.toBeUndefined();

    expect(fpgaDesigns.error).toBeNull();
    expect(fpgaDesigns.enabled).toBe('ttxx_gone');
    expect(deviceState.selectedDesign).toBe(0);
  });
});

describe('libraryWarnings', () => {
  test('warnings match the site table', () => {
    // Row 4: timing-fail with fmax below the clock.
    expect(libraryWarnings(entries[4])).toEqual([
      { text: 'timing: 17.08 MHz < 25.175 MHz', cls: 'warn' },
      { text: 'not hardware-validated', cls: 'info' },
    ]);
    // Row 0: a non-ok video verdict and inputs set.
    expect(libraryWarnings(entries[0])).toEqual([
      { text: 'not hardware-validated', cls: 'info' },
      { text: 'video: barely-moving', cls: 'info' },
      { text: 'inputs set: 0x01', cls: 'info' },
    ]);
    // Ruling AN: the main clock passes, a secondary clock or path fails.
    const secondary = libraryWarnings({
      ...entries[1],
      build_status: 'timing-fail',
      fmax_hz: 25175000,
    });
    expect(secondary).toContainEqual({
      text: 'timing not met on a secondary clock or path',
      cls: 'warn',
    });
    expect(secondary.some((b) => b.text.includes('MHz <'))).toBe(false);
    // Ruling AH: ui_in 0 is not "inputs set".
    const zero = libraryWarnings({ ...entries[0], ui_in: 0, ui_in_mask: 1 });
    expect(zero.some((b) => b.text.startsWith('inputs set'))).toBe(false);
    // The remaining rows of the table.
    expect(
      libraryWarnings({ ...entries[1], validation: 'mcu', qspi: 'emulated', ui_in: 0xa5 }),
    ).toEqual([
      { text: 'validated at MCU speed only', cls: 'info' },
      { text: 'QSPI emulated', cls: 'info' },
      { text: 'inputs set: 0xa5', cls: 'info' },
    ]);
    expect(libraryWarnings({ ...entries[1], validation: 'full-speed' })).toEqual([]);
  });

  test('only a warn badge makes the project medium danger, never high', () => {
    expect(libraryToProject(entries[4], 3)).toMatchObject({
      address: 3,
      danger_level: 'medium',
      danger_reason: 'timing: 17.08 MHz < 25.175 MHz; not hardware-validated',
    });
    const ok = libraryToProject(entries[1], 0);
    expect(ok.danger_level).toBe('safe');
    expect(ok.danger_reason).toBeUndefined();
  });

  // Ruling BJ: PDK latch or clock-gate cells are a warning; a missing key means false.
  const LATCH = { text: 'PDK latch cells: may not behave as on silicon', cls: 'warn' };

  test('pdk_latches gives a warn badge after the timing one', () => {
    const fullSpeed = { ...entries[1], validation: 'full-speed' };
    expect(entries[1].pdk_latches).toBe(false);
    expect(libraryWarnings(fullSpeed)).toEqual([]);
    expect(libraryWarnings({ ...fullSpeed, pdk_latches: false })).toEqual([]);
    expect(libraryWarnings({ ...fullSpeed, pdk_latches: true })).toEqual([LATCH]);
    // Only a real true counts; the site drops a non-bool, but a stray string must not warn either.
    const stringTrue = { ...fullSpeed, pdk_latches: 'true' } as unknown as LibraryEntry;
    expect(libraryWarnings(stringTrue)).toEqual([]);
    expect(libraryWarnings({ ...entries[4], pdk_latches: true })).toEqual([
      { text: 'timing: 17.08 MHz < 25.175 MHz', cls: 'warn' },
      LATCH,
      { text: 'not hardware-validated', cls: 'info' },
    ]);
  });

  // Ruling CH: synthesis_differs is a nullable bool; only a real true warns.
  const SYNTH = { text: 'Board picture may differ from the preview', cls: 'warn' };

  test('synthesis_differs true gives a warn badge; every other value gives none', () => {
    const fullSpeed = { ...entries[1], validation: 'full-speed' };
    expect(entries[1].synthesis_differs).toBeUndefined();
    expect(libraryWarnings(fullSpeed)).toEqual([]);
    expect(libraryWarnings({ ...fullSpeed, synthesis_differs: true })).toEqual([SYNTH]);
    expect(libraryWarnings({ ...fullSpeed, synthesis_differs: false })).toEqual([]);
    expect(libraryWarnings({ ...fullSpeed, synthesis_differs: null })).toEqual([]);
    const stringTrue = { ...fullSpeed, synthesis_differs: 'true' } as unknown as LibraryEntry;
    expect(libraryWarnings(stringTrue)).toEqual([]);
  });

  test('synthesis_differs badge comes after pdk_latches and before validation', () => {
    expect(libraryWarnings({ ...entries[4], pdk_latches: true, synthesis_differs: true })).toEqual([
      { text: 'timing: 17.08 MHz < 25.175 MHz', cls: 'warn' },
      LATCH,
      SYNTH,
      { text: 'not hardware-validated', cls: 'info' },
    ]);
  });

  test('a synthesis_differs design is medium danger, never high', () => {
    expect(
      libraryToProject({ ...entries[1], validation: 'full-speed', synthesis_differs: true }, 2),
    ).toMatchObject({
      address: 2,
      danger_level: 'medium',
      danger_reason: SYNTH.text,
    });
  });

  test('a latch design is medium danger, never high', () => {
    expect(
      libraryToProject({ ...entries[1], validation: 'full-speed', pdk_latches: true }, 2),
    ).toMatchObject({
      address: 2,
      danger_level: 'medium',
      danger_reason: LATCH.text,
    });
  });
});

describe('loadLibraryDesign', () => {
  test('POSTs {} to the site load route with the CSRF token', async () => {
    setCsrfToken(() => 'tok');
    const result = {
      enabled: entries[0].id,
      clock_hz: 25175000,
      ui_in: 1,
      ui_in_mask: 1,
      ui_in_driven: [0],
      ui_in_held: [],
      ui_in_inputs: [1, 2, 3, 4, 5, 6, 7],
      released: [],
      pushed: true,
      hides_upload: false,
    };
    const fetchMock = routeFetch({
      [`${API}/library/${entries[0].id}/load`]: () => jsonResponse(result),
    });

    await expect(loadLibraryDesign(`${API}/`, entries[0].id)).resolves.toEqual(result);

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{}');
    expect((init.headers as Record<string, string>)['X-CSRFToken']).toBe('tok');
  });
});

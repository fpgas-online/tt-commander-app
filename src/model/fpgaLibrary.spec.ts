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

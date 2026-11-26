// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026, fpgas.online contributors

import { createStore } from 'solid-js/store';
import { DaemonError, daemonJson, normaliseApiBase } from './daemonApi';
import type { Project } from './shuttle';

/**
 * The VGA library: prebuilt iCE40UP5K bitstreams of Tiny Tapeout VGA designs,
 * a third design source beside the board's demos and uploads. Its catalogue is
 * the host site's checked copy of `fpga-library.json` (`GET ${apiBase}/library`);
 * the daemon's `/designs` lists only the entries cached on the Pi, in the upload
 * shape, so every piece of library metadata comes from here.
 */

/** One entry of the site's index: `fpga-library.json` schema 1, section 1 of the spec. */
export interface LibraryEntry {
  /** The design's name on the Pi, and the name `/designs` reports as enabled. */
  id: string;
  shuttle: string;
  /** The Tiny Tapeout macro, original case (`tt_um_...`). */
  macro: string;
  title: string;
  author: string;
  description: string;
  docs_url: string;
  repo_url: string;
  commit: string;
  clock_hz: number;
  pinout: { ui_in: string[]; uo_out: string[]; uio: string[] };
  ui_in: number | null;
  ui_in_mask: number;
  bin: string;
  bin_bytes: number;
  bin_sha256: string;
  /** `ok` or `timing-fail`. */
  build_status: string;
  fmax_hz: number;
  /** `none`, `mcu` or `full-speed`. */
  validation: string;
  verdict: string;
  /** `none` or `emulated`. */
  qspi: string;
  poster: string | null;
  preview_gif: string | null;
  video_10s_webm: string | null;
}

/** The site's wire format for the index. */
export interface LibraryIndex {
  schema: number;
  generated: string;
  base_url: string;
  designs: LibraryEntry[];
}

export type LibraryState = 'idle' | 'loading' | 'ready' | 'notPublished' | 'error';

/** The project picker shows at most this many options. */
export const PROJECT_LIMIT = 100;

/** The site's 404 text when the archive has no `fpga-library.json` yet. */
const NOT_PUBLISHED = 'VGA library not published';

export const [fpgaLibrary, updateFpgaLibrary] = createStore({
  state: 'idle' as LibraryState,
  /** Index entries in index order (the display order). */
  designs: [] as LibraryEntry[],
  byId: {} as Record<string, LibraryEntry>,
  error: null as string | null,
});

/** Store a fetched index (state `ready`). */
export function setFpgaLibraryIndex(designs: LibraryEntry[]) {
  const byId: Record<string, LibraryEntry> = {};
  designs.forEach((e) => (byId[e.id] = e));
  // The top-level form replaces byId; the path form would merge in ids a
  // republished index dropped.
  updateFpgaLibrary({ state: 'ready', designs, byId, error: null });
}

/** Forget the index, so the next design-list load fetches it again. */
export function resetFpgaLibrary() {
  // An index fetch still running belongs to the forgotten index: drop its result.
  libraryGeneration += 1;
  inflight = null;
  updateFpgaLibrary({ state: 'idle', designs: [], byId: {}, error: null });
}

let inflight: Promise<void> | null = null;
/** Bumped by resetFpgaLibrary; a fetch started before the bump never writes the store. */
let libraryGeneration = 0;

/**
 * Fetch the site's index. Never throws: the outcome is `fpgaLibrary.state`.
 * While a fetch is running (state `loading`), a second call shares it instead
 * of sending another request.
 */
export function loadFpgaLibrary(apiBase: string): Promise<void> {
  if (inflight && fpgaLibrary.state === 'loading') {
    return inflight;
  }
  const p: Promise<void> = fetchFpgaLibrary(apiBase, libraryGeneration).finally(() => {
    // A reset and a newer fetch may have replaced it meanwhile.
    if (inflight === p) {
      inflight = null;
    }
  });
  inflight = p;
  return p;
}

async function fetchFpgaLibrary(apiBase: string, generation: number): Promise<void> {
  updateFpgaLibrary({ state: 'loading', error: null });
  try {
    const index = await daemonJson<LibraryIndex>(`${normaliseApiBase(apiBase)}/library`);
    if (generation !== libraryGeneration) {
      return;
    }
    setFpgaLibraryIndex(index.designs);
  } catch (e) {
    if (generation !== libraryGeneration) {
      return;
    }
    if (e instanceof DaemonError && e.status === 404 && e.error === NOT_PUBLISHED) {
      updateFpgaLibrary({ state: 'notPublished', designs: [], byId: {}, error: null });
      return;
    }
    updateFpgaLibrary({
      state: 'error',
      designs: [],
      byId: {},
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/** The site's load route answer: the daemon's enable body plus `pushed` and `hides_upload`. */
export interface LibraryLoadResult {
  enabled: string;
  clock_hz?: number | null;
  ui_in: number | null;
  ui_in_mask?: number;
  ui_in_driven: number[];
  ui_in_held: number[];
  ui_in_inputs?: number[];
  released: number[];
  pushed: boolean;
  hides_upload: boolean;
}

/**
 * Load one library design onto the board through the site, which fetches the
 * bitstream from the archive, pushes it to the Pi and enables it with the
 * index's clock and inputs. The body is empty: every value comes from the index.
 */
export async function loadLibraryDesign(apiBase: string, id: string): Promise<LibraryLoadResult> {
  return daemonJson<LibraryLoadResult>(
    `${normaliseApiBase(apiBase)}/library/${encodeURIComponent(id)}/load`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
  );
}

export interface LibraryBadge {
  text: string;
  cls: 'warn' | 'info';
}

function hex2(n: number) {
  return `0x${n.toString(16).padStart(2, '0')}`;
}

/**
 * The badges of an entry, exactly the spec's table (section 1, Warnings) and the
 * site panel's texts. Only missed timing is a warning; nothing here ever
 * disables Load.
 */
export function libraryWarnings(e: LibraryEntry): LibraryBadge[] {
  const badges: LibraryBadge[] = [];
  if (e.build_status === 'timing-fail') {
    badges.push(
      e.fmax_hz < e.clock_hz
        ? {
            text: `timing: ${(e.fmax_hz / 1e6).toFixed(2)} MHz < ${(e.clock_hz / 1e6).toFixed(3)} MHz`,
            cls: 'warn',
          }
        : // Ruling AN: the main clock passes; another clock or a cross-domain path fails.
          { text: 'timing not met on a secondary clock or path', cls: 'warn' },
    );
  }
  if (e.validation === 'none') {
    badges.push({ text: 'not hardware-validated', cls: 'info' });
  } else if (e.validation === 'mcu') {
    badges.push({ text: 'validated at MCU speed only', cls: 'info' });
  }
  if (e.qspi === 'emulated') {
    badges.push({ text: 'QSPI emulated', cls: 'info' });
  }
  if (e.verdict !== 'ok') {
    badges.push({ text: `video: ${e.verdict}`, cls: 'info' });
  }
  // Ruling AH: an all-zero ui_in is not "inputs set".
  if (e.ui_in !== null && e.ui_in !== 0) {
    badges.push({ text: `inputs set: ${hex2(e.ui_in)}`, cls: 'info' });
  }
  return badges;
}

/** The text the Commander shows after a library load, or null when there is nothing to say. */
export function libraryLoadNotice(result: LibraryLoadResult): string | null {
  const parts: string[] = [];
  if (result.ui_in !== null && result.ui_in !== 0) {
    parts.push(`inputs set: ${hex2(result.ui_in)}`);
  }
  if (result.ui_in_held.length) {
    parts.push(`ui_in ${result.ui_in_held.join(', ')} held high on the board, left as inputs`);
  }
  if (result.hides_upload) {
    parts.push('an uploaded design with the same name is hidden while this one is on the board');
  }
  return parts.length ? parts.join('; ') : null;
}

/** A library index entry as a picker project, at `address` in the merged list. */
export function libraryToProject(e: LibraryEntry, address: number): Project {
  const badges = libraryWarnings(e);
  const warn = badges.some((b) => b.cls === 'warn');
  return {
    macro: e.id,
    address,
    title: e.title || e.id,
    author: e.author,
    repo: e.repo_url,
    commit: e.commit,
    clock_hz: e.clock_hz,
    // 'high' would disable Load; a missed timing is only ever a warning.
    danger_level: warn ? 'medium' : 'safe',
    ...(warn ? { danger_reason: badges.map((b) => b.text).join('; ') } : {}),
    type: 'project',
    shuttle: e.shuttle,
    source: 'library',
  };
}

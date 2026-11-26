// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026, fpgas.online contributors

import { batch } from 'solid-js';
import { createStore } from 'solid-js/store';
import { daemonJson, normaliseApiBase } from './daemonApi';
import { deviceState, updateDeviceState } from './DeviceState';
import { fpgaLibrary, LibraryEntry, libraryToProject, loadFpgaLibrary } from './fpgaLibrary';
import { findProject, Project, shuttle, updateShuttle } from './shuttle';

export { DaemonError, setCsrfToken } from './daemonApi';

/**
 * One design on an FPGA emulation board, as reported by the Pi daemon's GET /designs.
 *
 * A `library` design is listed in the upload shape (empty strings, `pinout: {}`,
 * `clock_hz: null`) plus `size`; only `name`, `source` and `size` mean anything
 * for it. Its real metadata comes from the site's library index (fpgaLibrary.ts).
 */
export interface FpgaDesign {
  name: string;
  title: string;
  author: string;
  description: string;
  docs_url: string;
  repo_url: string;
  clock_hz: number | null;
  pinout: Record<string, string[]>;
  source: 'demo' | 'upload' | 'library';
  /** Library designs only: the cached bitstream's size in bytes. */
  size?: number;
}

/** The daemon's `/designs` answer. `library` is present only when the daemon supports it. */
interface DesignsBody {
  enabled: string | null;
  library?: { max_bytes: number; used_bytes: number };
  designs: FpgaDesign[];
}

export const [fpgaDesigns, updateFpgaDesigns] = createStore({
  enabled: null as string | null,
  /**
   * The board's designs by name. When a name is listed under two sources, this
   * holds the one the daemon resolves it to: demo, then library, then upload.
   */
  byName: {} as Record<string, FpgaDesign>,
  /** Whether the daemon's `/designs` carried the top-level `library` key. */
  hasLibrary: false,
  loading: false,
  error: null as string | null,
});

/**
 * Maps a design's daemon pinout (keyed `ui_in`/`uo_out`/`uio`) onto the
 * `ui[i]`/`uo[i]`/`uio[i]` keys the Pinout tab expects (matching the shape of
 * TinyTapeout's shuttle index). A missing pin list, or a missing pinout,
 * contributes no keys.
 */
export function pinoutFromLists(lists: Partial<Record<string, string[]>> | undefined) {
  const pinout: Record<string, string> = {};
  (['ui_in', 'uo_out', 'uio'] as const).forEach((k) => {
    const key = k === 'ui_in' ? 'ui' : k === 'uo_out' ? 'uo' : 'uio';
    (lists?.[k] ?? []).forEach((label, i) => (pinout[`${key}[${i}]`] = label));
  });
  return pinout;
}

export function pinoutFromDesign(d: FpgaDesign): Record<string, string> {
  return pinoutFromLists(d.pinout);
}

export function designToProject(d: FpgaDesign, index: number): Project {
  return {
    macro: d.name,
    address: index,
    title: d.title || d.name,
    author: d.author ?? '',
    repo: d.repo_url ?? '',
    commit: '',
    clock_hz: d.clock_hz ?? 0,
    danger_level: 'safe',
    type: 'project',
    source: d.source,
  };
}

/**
 * The picker's list on a board whose daemon supports the library: the board's
 * demos and uploads in the daemon's order, then every index entry in index
 * order, then any library entry the Pi holds that the index no longer lists
 * (shown under its name). Projects are keyed by (name, source), so a library
 * entry and an upload of the same name are two projects. A project's address
 * is its position in this list.
 */
export function mergeProjects(designs: FpgaDesign[], library: LibraryEntry[]): Project[] {
  const seen = new Set<string>();
  const once = (name: string, source: string) => {
    const key = `${source}\u0000${name}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  };
  const projects: Project[] = [];
  designs
    .filter((d) => d.source !== 'library' && once(d.name, d.source))
    .forEach((d) => projects.push(designToProject(d, projects.length)));
  library
    .filter((e) => once(e.id, 'library'))
    .forEach((e) => projects.push(libraryToProject(e, projects.length)));
  designs
    .filter((d) => d.source === 'library' && once(d.name, 'library'))
    .forEach((d) => projects.push(designToProject(d, projects.length)));
  return projects;
}

const PRECEDENCE: Record<FpgaDesign['source'], number> = { demo: 0, library: 1, upload: 2 };

/** By name, keeping the source the daemon resolves a shared name to. */
function designsByName(designs: FpgaDesign[]) {
  const byName: Record<string, FpgaDesign> = {};
  designs.forEach((d) => {
    const held = byName[d.name];
    if (!held || PRECEDENCE[d.source] < PRECEDENCE[held.source]) {
      byName[d.name] = d;
    }
  });
  return byName;
}

/**
 * Point the UI's selection at the design the daemon says is enabled.
 *
 * An FPGA design's "address" is only its position in the merged list, which
 * shifts whenever a design is uploaded or the index changes. The enabled
 * *name* is the stable identity, so the selection is re-derived from it after
 * every load and every enable, and the REPL's `tt.design=` lines (which report
 * the ASIC mux, meaningless here) are ignored. A name can be both an upload and
 * a library entry; the project picked has the source `/designs` reports for
 * that name, or `library` when `/designs` does not list it (an entry just
 * loaded, or a stale list). A name in neither leaves the selection alone.
 */
function syncSelectionToEnabled(enabled: string | null): boolean {
  if (!enabled) {
    return false;
  }
  const source = fpgaDesigns.byName[enabled]?.source ?? 'library';
  const project =
    shuttle.projects.find((p) => p.macro === enabled && p.source === source) ??
    shuttle.projects.find((p) => p.macro === enabled);
  if (project) {
    updateDeviceState({ selectedDesign: project.address, selectedSubtile: null });
  }
  return project != null;
}

/**
 * Rebuild the project list from `designs` and the index as it stands, keeping
 * the user's current pick by (name, source): addresses are list positions, and
 * merging the index in moves the cached-but-unindexed library entries.
 */
function publishProjects(designs: FpgaDesign[], hasLibrary: boolean) {
  const picked = findProject(shuttle.projects, {
    address: deviceState.selectedDesign,
    subtile: null,
  });
  const projects = hasLibrary
    ? mergeProjects(designs, fpgaLibrary.designs)
    : designs.map(designToProject);
  const again =
    picked && projects.find((p) => p.macro === picked.macro && p.source === picked.source);
  // One batch: the picker must never see the new list with the old address,
  // which would read as a changed selection and clear its search text.
  batch(() => {
    updateShuttle({ projects });
    if (again) {
      updateDeviceState({ selectedDesign: again.address, selectedSubtile: null });
    }
  });
}

/** Bumped by every loadFpgaDesigns call; an older call's late results are dropped. */
let designsGeneration = 0;

/**
 * Replace the shuttle project list with the daemon's designs (FPGA boards only),
 * merged with the site's VGA library index when the daemon supports the library.
 * The board's own designs are published as soon as `/designs` answers; the
 * index is merged in when it arrives, so a slow or failing index never hides
 * the demos and uploads. The index is fetched once and kept while it is good.
 */
export async function loadFpgaDesigns(apiBase: string): Promise<void> {
  const generation = ++designsGeneration;
  const current = () => generation === designsGeneration;
  updateFpgaDesigns({ loading: true, error: null });
  updateShuttle({ id: 'FPGA', projects: [], loading: true });
  let body: DesignsBody;
  try {
    body = await daemonJson<DesignsBody>(`${normaliseApiBase(apiBase)}/designs`);
  } catch (e) {
    if (current()) {
      updateFpgaDesigns({ error: e instanceof Error ? e.message : String(e), loading: false });
      updateShuttle({ loading: false });
    }
    return;
  }
  if (!current()) {
    return;
  }
  const hasLibrary = body.library != null;
  // The top-level form replaces byName; the path form would merge in the old names.
  updateFpgaDesigns({
    byName: designsByName(body.designs),
    enabled: body.enabled,
    hasLibrary,
    error: null,
    loading: false,
  });
  publishProjects(body.designs, hasLibrary);
  updateShuttle({ loading: false });
  const found = syncSelectionToEnabled(body.enabled);
  if (hasLibrary && fpgaLibrary.state !== 'ready') {
    // loadFpgaLibrary shares one request between concurrent callers.
    await loadFpgaLibrary(apiBase);
    if (!current()) {
      return;
    }
    publishProjects(body.designs, hasLibrary);
    // If the first sync found no project for the enabled name (a library design
    // /designs does not list), it can be found only now that the index is merged:
    // follow it, even over a pick the user made meanwhile. Following the enabled
    // library design is intended. If the first sync found it, the pick is kept.
    if (!found) {
      syncSelectionToEnabled(body.enabled);
    }
  }
}

/**
 * Record a library load the site just did: the daemon now holds `name` as a
 * library design, and it is enabled. Keeps `byName` in step with the board
 * (the name now resolves to the library, even over an upload of that name)
 * without refetching `/designs`.
 */
export function noteLibraryEnabled(name: string) {
  const held = fpgaDesigns.byName[name];
  if (!held || held.source === 'upload') {
    const size = fpgaLibrary.byId[name]?.bin_bytes;
    updateFpgaDesigns('byName', name, {
      name,
      title: '',
      author: '',
      description: '',
      docs_url: '',
      repo_url: '',
      clock_hz: null,
      pinout: {},
      source: 'library',
      ...(size != null ? { size } : {}),
    });
  }
  updateFpgaDesigns({ enabled: name });
  syncSelectionToEnabled(name);
}

export async function enableFpgaDesign(apiBase: string, name: string, clockHz?: number) {
  // The daemon reads a missing clock_hz as "no clock override"; a 0 would ask
  // it for a 0 Hz clock, so only send a usable frequency.
  const body = clockHz ? { clock_hz: clockHz } : {};
  const result = await daemonJson<{ enabled: string; clock_hz: number | null }>(
    `${normaliseApiBase(apiBase)}/designs/${encodeURIComponent(name)}/enable`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
  updateFpgaDesigns({ enabled: result.enabled });
  syncSelectionToEnabled(result.enabled);
  return result;
}

// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026, fpgas.online contributors

import { createStore } from 'solid-js/store';
import { Project, updateShuttle } from './shuttle';

/** One design on an FPGA emulation board, as reported by the Pi daemon's GET /designs. */
export interface FpgaDesign {
  name: string;
  title: string;
  author: string;
  description: string;
  docs_url: string;
  repo_url: string;
  clock_hz: number | null;
  pinout: Record<string, string[]>;
  source: 'demo' | 'upload';
}

export class DaemonError extends Error {
  constructor(
    public error: string,
    public detail: string,
    public status: number,
  ) {
    super(detail ? `${error}: ${detail}` : error);
  }
}

export const [fpgaDesigns, updateFpgaDesigns] = createStore({
  enabled: null as string | null,
  byName: {} as Record<string, FpgaDesign>,
  loading: false,
  error: null as string | null,
});

/**
 * Maps a design's daemon pinout (keyed `ui_in`/`uo_out`/`uio`) onto the
 * `ui[i]`/`uo[i]`/`uio[i]` keys the Pinout tab expects (matching the shape of
 * TinyTapeout's shuttle index). A missing pin list contributes no keys.
 */
export function pinoutFromDesign(d: FpgaDesign): Record<string, string> {
  const pinout: Record<string, string> = {};
  (['ui_in', 'uo_out', 'uio'] as const).forEach((k) => {
    const key = k === 'ui_in' ? 'ui' : k === 'uo_out' ? 'uo' : 'uio';
    (d.pinout[k] ?? []).forEach((label, i) => (pinout[`${key}[${i}]`] = label));
  });
  return pinout;
}

export function designToProject(d: FpgaDesign, index: number): Project {
  return {
    macro: d.name,
    address: index,
    title: d.title || d.name,
    author: d.author,
    repo: d.repo_url,
    commit: '',
    clock_hz: d.clock_hz ?? 0,
    danger_level: 'safe',
    type: 'project',
  };
}

async function daemonJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, ...init });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const b = (body ?? {}) as { error?: string; detail?: string };
    throw new DaemonError(b.error ?? `HTTP ${response.status}`, b.detail ?? '', response.status);
  }
  return body as T;
}

/** Replace the shuttle project list with the daemon's designs (FPGA boards only). */
export async function loadFpgaDesigns(apiBase: string): Promise<void> {
  updateFpgaDesigns({ loading: true, error: null });
  updateShuttle({ id: 'FPGA', projects: [], loading: true });
  try {
    const body = await daemonJson<{ enabled: string | null; designs: FpgaDesign[] }>(
      `${apiBase}/designs`,
    );
    const byName: Record<string, FpgaDesign> = {};
    body.designs.forEach((d) => (byName[d.name] = d));
    updateFpgaDesigns({ enabled: body.enabled, byName, error: null });
    updateShuttle({ projects: body.designs.map(designToProject) });
  } catch (e) {
    updateFpgaDesigns({ error: e instanceof Error ? e.message : String(e) });
  } finally {
    updateFpgaDesigns({ loading: false });
    updateShuttle({ loading: false });
  }
}

export async function enableFpgaDesign(apiBase: string, name: string, clockHz?: number) {
  const body = clockHz != null ? { clock_hz: clockHz } : {};
  const result = await daemonJson<{ enabled: string; clock_hz: number | null }>(
    `${apiBase}/designs/${encodeURIComponent(name)}/enable`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
  updateFpgaDesigns({ enabled: result.enabled });
  return result;
}

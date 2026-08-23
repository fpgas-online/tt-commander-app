# Commander fork phase 2 — `fpga` kind Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the embedded Commander drives an FPGA emulation board (`board.kind === 'fpga'`), its project list comes from the Pi daemon (`GET ${apiBase}/designs`) instead of the Tiny Tapeout shuttle index, "Select" loads a bitstream through the daemon (`POST ${apiBase}/designs/<name>/enable`), the Pinout tab renders the demo's pinout from that metadata, and the host page can ask the widget to refresh the list after an upload. Also harden the embed against boards whose REPL has no TT SDK (fork issue #7: reconnect storm + leaked sockets).

**Architecture:** A new `src/model/fpgaDesigns.ts` store loads/holds the daemon's design list and fills the existing `shuttle` store with `Project` objects (`macro` = design name, `address` = position in the daemon's list) so every existing component (ProjectSelect, Config, Pinout) keeps working unchanged; `TTBoardDevice.selectDesign` branches on `boardInfo.kind` and calls the daemon for `fpga`; `PinoutPanel` reads the design's `pinout` for `fpga`; `mountCommander` returns `refreshDesigns()`. Upstream (WebSerial, asic) behaviour is untouched.

**Tech Stack:** SolidJS + SUID, TypeScript, Vite (embed lib build), vitest, eslint/prettier. Release `embed-v0.2.0`.

**Spec:** `fpgas.online-infra/docs/superpowers/specs/2026-08-22-tinytapeout-fpgas-online-design.md` §4 (A.3 kind-aware behaviour), §5.3 (daemon API), §9. Daemon contract (fpgas.online-tt plan 2026-08-23-fpgas-tt-fpga-api): `GET /designs → {"enabled": "<name>|null", "designs": [{"name","title","author","description","docs_url","repo_url","clock_hz","pinout","source"}]}` sorted by name, `pinout` = `{"ui_in": [8 strings], "uo_out": [8], "uio": [8]}` or `{}`; `POST /designs/<name>/enable` body `{"clock_hz"?: int}` → `{"enabled","clock_hz"}` or `{"error","detail"}` with 4xx/5xx.

## Global Constraints

- Repo `fpgas-online/tt-commander-app`, default branch `fpgas-online`; feature branch in `.worktrees/`; PR to `fpgas-online`; CI (`ci.yml`: lint, typecheck, vitest, both builds) green before merge. Commit trailer on every commit:
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01UdRpsg6jY8PbcQxxX6txKE
  ```
- Keep the fork rebaseable: no edits to upstream files beyond the minimal branches described; new code in new files under `src/model/fpgaDesigns.ts`; `asic` behaviour byte-for-byte unchanged (`loadShuttle`, `select_design(<address>)`).
- `npm run lint && npm run typecheck && npx vitest run && npm run build && npm run build:embed` all pass.
- Exact option/handle names: `mountCommander(el, opts) → { unmount(): void; refreshDesigns(): Promise<void> }` (`refreshDesigns` is a no-op resolving immediately for non-fpga kinds).
- For `fpga`, `Project.address` = index of the design in the daemon's (sorted) list; `Project.macro` = design name; `title` = `title || name`; `author` = `author`; `repo` = `repo_url`; `commit` = `''`; `clock_hz` = `clock_hz ?? 0`; `danger_level` = `'safe'`; `type` = `'project'`.
- Errors from the daemon are shown in an `Alert` inside the Config tab (`{error}` + `detail` when non-empty), never thrown into the console as unhandled.

---

## File structure

```
src/model/fpgaDesigns.ts            store + loadFpgaDesigns(apiBase) + enableFpgaDesign(apiBase, name, clockHz)
src/model/fpgaDesigns.spec.ts       vitest with a fetch double
src/ttcontrol/TTBoardDevice.ts      (modify) 'shuttle' case → loadFpgaDesigns for fpga; selectDesign branch
src/components/BoardConfigPanel.tsx (modify) fpga: hide Index/subtile, "Load design" label, error Alert
src/components/PinoutPanel.tsx      (modify) fpga: pinout from design metadata
src/components/EmbedApp.tsx         (modify) refreshDesigns wiring; onClosed closes carrier (issue #7)
src/embed.tsx                       (modify) handle returns refreshDesigns
src/model/firmware.ts               (modify) safeCompareVersions helper used by BoardConfigPanel
README.fpgas-online.md              (modify) fpga kind + refreshDesigns + release notes
package.json                        version 0.2.0
```

---

### Task 1: `fpgaDesigns` store — load + enable via the daemon

**Files:**
- Create: `src/model/fpgaDesigns.ts`, `src/model/fpgaDesigns.spec.ts`

**Interfaces:**
- Produces: `export interface FpgaDesign { name: string; title: string; author: string; description: string; docs_url: string; repo_url: string; clock_hz: number | null; pinout: Record<string, string[]>; source: 'demo' | 'upload' }`; `export const [fpgaDesigns, updateFpgaDesigns]` store `{ enabled: string | null; byName: Record<string, FpgaDesign>; loading: boolean; error: string | null }`; `export async function loadFpgaDesigns(apiBase: string): Promise<void>` (fills `shuttle` via `updateShuttle({ id: 'FPGA', projects, loading: false })` and `fpgaDesigns`); `export async function enableFpgaDesign(apiBase: string, name: string, clockHz?: number): Promise<{ enabled: string; clock_hz: number | null }>` (throws `DaemonError` with `.error`, `.detail`, `.status`); `export class DaemonError extends Error`; `export function designToProject(d: FpgaDesign, index: number): Project`.

- [ ] **Step 1: Failing tests** — `src/model/fpgaDesigns.spec.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shuttle } from './shuttle';
import {
  DaemonError,
  designToProject,
  enableFpgaDesign,
  fpgaDesigns,
  loadFpgaDesigns,
} from './fpgaDesigns';

const designs = [
  { name: 'my_upload', title: '', author: '', description: '', docs_url: '', repo_url: '', clock_hz: null, pinout: {}, source: 'upload' },
  { name: 'tt_um_demo_a', title: 'Demo A', author: 'fpgas.online', description: 'First demo', docs_url: 'https://example.org/a', repo_url: 'https://github.com/fpgas-online/tinytapeout-fpga-demos', clock_hz: 1000, pinout: { ui_in: ['a0','a1','a2','a3','a4','a5','a6','a7'], uo_out: ['o0','o1','o2','o3','o4','o5','o6','o7'], uio: ['','','','','','','',''] }, source: 'demo' },
];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('designToProject', () => {
  it('maps daemon designs onto shuttle projects (address = list index)', () => {
    const p = designToProject(designs[1] as never, 1);
    expect(p).toMatchObject({ macro: 'tt_um_demo_a', address: 1, title: 'Demo A', author: 'fpgas.online', clock_hz: 1000, danger_level: 'safe', type: 'project', commit: '', repo: 'https://github.com/fpgas-online/tinytapeout-fpga-demos' });
    expect(designToProject(designs[0] as never, 0)).toMatchObject({ title: 'my_upload', clock_hz: 0 });
  });
});

describe('loadFpgaDesigns', () => {
  it('fills the shuttle store and the designs store from GET /designs', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ enabled: 'tt_um_demo_a', designs }));
    vi.stubGlobal('fetch', fetchMock);
    await loadFpgaDesigns('/api/board/fpga-1');
    expect(fetchMock).toHaveBeenCalledWith('/api/board/fpga-1/designs', expect.anything());
    expect(shuttle.id).toBe('FPGA');
    expect(shuttle.loading).toBe(false);
    expect(shuttle.projects.map((p) => [p.macro, p.address])).toEqual([['my_upload', 0], ['tt_um_demo_a', 1]]);
    expect(fpgaDesigns.enabled).toBe('tt_um_demo_a');
    expect(fpgaDesigns.byName.tt_um_demo_a.pinout.uo_out[0]).toBe('o0');
    expect(fpgaDesigns.error).toBeNull();
  });

  it('records an error and leaves projects empty when the daemon answers an error JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'board not present', detail: '' }, 503)));
    await loadFpgaDesigns('/api/board/fpga-1');
    expect(shuttle.projects).toEqual([]);
    expect(shuttle.loading).toBe(false);
    expect(fpgaDesigns.error).toBe('board not present');
  });
});

describe('enableFpgaDesign', () => {
  it('POSTs the clock and returns the daemon body', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ enabled: 'tt_um_demo_a', clock_hz: 1000 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(enableFpgaDesign('/api/board/fpga-1', 'tt_um_demo_a', 1000)).resolves.toEqual({ enabled: 'tt_um_demo_a', clock_hz: 1000 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/board/fpga-1/designs/tt_um_demo_a/enable');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ clock_hz: 1000 });
  });

  it('throws DaemonError with the daemon message and detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'REPL task failed', detail: 'someone typed' }, 502)));
    await expect(enableFpgaDesign('/api/board/fpga-1', 'x')).rejects.toMatchObject({ error: 'REPL task failed', detail: 'someone typed', status: 502 } satisfies Partial<DaemonError>);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/model/fpgaDesigns.spec.ts` → cannot resolve `./fpgaDesigns`.

- [ ] **Step 3: Implement** — `src/model/fpgaDesigns.ts`:
```ts
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
    const body = await daemonJson<{ enabled: string | null; designs: FpgaDesign[] }>(`${apiBase}/designs`);
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
```
(If `Project.danger_level`/`type` fields are typed as optional unions in `shuttle.ts`, the literals above satisfy them; the existing `loadShuttle` stays untouched.)

- [ ] **Step 4: Run** — `npx vitest run src/model/fpgaDesigns.spec.ts`, `npm run typecheck`, `npm run lint`.
- [ ] **Step 5: Commit** — `feat(fpga): designs store loaded from the Pi daemon; enable via POST` + trailer.

---

### Task 2: Device + Config tab branches for `fpga`

**Files:**
- Modify: `src/ttcontrol/TTBoardDevice.ts`, `src/components/BoardConfigPanel.tsx`, `src/model/firmware.ts`
- Test: `src/ttcontrol/TTBoardDevice.spec.ts` (append), `src/model/firmware.spec.ts` (append)

**Interfaces:**
- Consumes: `boardInfo` (`~/model/board`), `loadFpgaDesigns`, `enableFpgaDesign`, `fpgaDesigns`.
- Produces: `TTBoardDevice.selectDesign(design, clockHz)` → for `fpga`: `enableFpgaDesign(boardInfo.apiBase!, project.macro, clockHz)` then `updateDeviceState({ selectedDesign: design.address, selectedSubtile: null })`; `TTBoardDevice.lastDesignError: string | null` signal-ish via `setData('designError', …)` (add `designError: string | null` to the device `data` store, default `null`); `safeCompareVersions(a, b): number` in `firmware.ts` (returns `compareVersions` or treats an unparseable side as `0.0.0`).

- [ ] **Step 1: Failing tests** — append to `src/ttcontrol/TTBoardDevice.spec.ts` (follow that file's existing fake-transport helpers; if it has none for writes, use the pattern from the `WebSocketTransport.spec.ts` FakeWebSocket):
```ts
describe('fpga kind', () => {
  it('loads designs from the daemon when the ROM says shuttle=FPGA', async () => {
    setBoardInfo({ slug: 'fpga-1', kind: 'fpga', apiBase: '/api/board/fpga-1' });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ enabled: null, designs: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const device = makeDevice(); // the spec file's existing helper that builds a TTBoardDevice on a fake transport
    device.processInput('shuttle=FPGA');
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledWith('/api/board/fpga-1/designs', expect.anything());
    vi.unstubAllGlobals();
    setBoardInfo({ slug: '', kind: 'asic' });
  });

  it('selectDesign enables through the daemon instead of select_design()', async () => {
    setBoardInfo({ slug: 'fpga-1', kind: 'fpga', apiBase: '/api/board/fpga-1' });
    updateShuttle({ id: 'FPGA', loading: false, projects: [designToProject({ name: 'tt_um_demo_a', title: 'Demo A', author: '', description: '', docs_url: '', repo_url: '', clock_hz: 1000, pinout: {}, source: 'demo' }, 0)] });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ enabled: 'tt_um_demo_a', clock_hz: 1000 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { device, written } = makeDeviceCapturingWrites();
    await device.selectDesign({ address: 0, subtile: null }, 1000);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/board/fpga-1/designs/tt_um_demo_a/enable');
    expect(written.join('')).not.toContain('select_design');
    expect(deviceState.selectedDesign).toBe(0);
    vi.unstubAllGlobals();
    setBoardInfo({ slug: '', kind: 'asic' });
  });

  it('records a daemon error on the device instead of throwing', async () => {
    setBoardInfo({ slug: 'fpga-1', kind: 'fpga', apiBase: '/api/board/fpga-1' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'another task is running', detail: '' }), { status: 409 })));
    const { device } = makeDeviceCapturingWrites();
    await device.selectDesign({ address: 0, subtile: null });
    expect(device.data.designError).toContain('another task is running');
    vi.unstubAllGlobals();
    setBoardInfo({ slug: '', kind: 'asic' });
  });
});
```
and to `src/model/firmware.spec.ts`:
```ts
describe('safeCompareVersions', () => {
  it('treats an unparseable version as 0.0.0 instead of throwing', () => {
    expect(safeCompareVersions('unknown', '2.0.4')).toBeLessThan(0);
    expect(safeCompareVersions('2.0.4', 'unknown')).toBeGreaterThan(0);
    expect(safeCompareVersions('2.0.4', '2.0.4')).toBe(0);
  });
});
```
If `TTBoardDevice.spec.ts` lacks a write-capturing helper, add `makeDeviceCapturingWrites()` there: a `SerialTransport` double whose `writable` is a `WritableStream` pushing decoded chunks into `written: string[]` and whose `readable` never yields.

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/ttcontrol src/model/firmware.spec.ts`.

- [ ] **Step 3: Implement**
  - `firmware.ts`: 
    ```ts
    /** compareVersions that never throws: an unparseable side counts as 0.0.0. */
    export function safeCompareVersions(a: string, b: string): number {
      const norm = (v: string) => { try { parseFirmwareVersion(v); return v; } catch { return '0.0.0'; } };
      return compareVersions(norm(a), norm(b));
    }
    ```
  - `TTBoardDevice.ts`: import `boardInfo` from `~/model/board`, `loadFpgaDesigns, enableFpgaDesign, DaemonError` from `~/model/fpgaDesigns`, `findProject, shuttle` (already imports from shuttle). In `processInput` case `'shuttle'`: `this.setData('shuttle', value); if (boardInfo.kind === 'fpga' && boardInfo.apiBase) { void loadFpgaDesigns(boardInfo.apiBase); } else { loadShuttle(value); }`. Add `designError: null as string | null` to the `data` store initial value. In `selectDesign`:
    ```ts
    async selectDesign(design: DesignAddress, clockHz?: number) {
      if (boardInfo.kind === 'fpga' && boardInfo.apiBase) {
        const project = findProject(shuttle.projects, design);
        this.setData('designError', null);
        if (!project) {
          this.setData('designError', `No design at index ${design.address}`);
          return;
        }
        this.addLogEntry({ text: `<<< load design ${project.macro} via daemon >>>`, sent: true });
        try {
          await enableFpgaDesign(boardInfo.apiBase, project.macro, clockHz);
          updateDeviceState({ selectedDesign: design.address, selectedSubtile: null });
        } catch (e) {
          this.setData('designError', e instanceof DaemonError ? e.message : String(e));
        }
        return;
      }
      … existing body unchanged …
    }
    ```
  - `BoardConfigPanel.tsx`: `const isFpga = () => boardInfo.kind === 'fpga';` — hide the `Index` TextField and the subtile TextField when `isFpga()`; Select button text `isFpga() ? 'Load design' : 'Select'`; replace the two `compareVersions(props.device.data.version ?? '0.0.0', …)` calls with `safeCompareVersions` (this removes the render-time crash of issue #7); below the Select row add `<Show when={props.device.data.designError}>{(msg) => <Alert severity="error" onClose={() => props.device.setData('designError', null)}>{msg()}</Alert>}</Show>` (import `Alert` from `@suid/material`; `setData` must be public — it is used within the class; if it is private, add a small public `clearDesignError()` method instead and call that).

- [ ] **Step 4: Run** — `npx vitest run`, `npm run typecheck`, `npm run lint`.
- [ ] **Step 5: Commit** — `feat(fpga): select loads a design through the daemon; daemon errors shown in the Config tab; safe firmware compare` + trailer.

---

### Task 3: Pinout tab from design metadata

**Files:**
- Modify: `src/components/PinoutPanel.tsx`

- [ ] **Step 1: Implement** — at the top of the resource: 
```ts
if (boardInfo.kind === 'fpga') {
  const d = project ? fpgaDesigns.byName[project.macro] : undefined;
  if (!d) return null;
  const pinout: Record<string, string> = {};
  (['ui_in', 'uo_out', 'uio'] as const).forEach((k) => {
    const key = k === 'ui_in' ? 'ui' : k === 'uo_out' ? 'uo' : 'uio';
    (d.pinout[k] ?? []).forEach((label, i) => (pinout[`${key}[${i}]`] = label));
  });
  return { macro: d.name, author: d.author, description: d.description, pinout, analog_pins: [] };
}
```
(imports `boardInfo`, `fpgaDesigns`). No network call for `fpga`. Add a vitest `src/components/PinoutPanel.spec.tsx`? — the repo has `EmbedApp.spec.tsx` using `@solidjs/testing-library`; if that dependency exists, add one render test asserting the labels `a0`/`o0` appear for an fpga design; otherwise skip the component test and cover the mapping by extracting it to `export function pinoutFromDesign(d: FpgaDesign): Record<string, string>` in `fpgaDesigns.ts` with a unit test there (preferred: do this regardless, and have PinoutPanel call it).
- [ ] **Step 2: Run** — `npx vitest run`, `npm run typecheck`, `npm run lint`.
- [ ] **Step 3: Commit** — `feat(fpga): pinout tab from the design metadata` + trailer.

---

### Task 4: `refreshDesigns()` handle + issue #7 hardening

**Files:**
- Modify: `src/components/EmbedApp.tsx`, `src/embed.tsx`, `src/components/EmbedApp.spec.tsx`

- [ ] **Step 1: Failing test** — append to `EmbedApp.spec.tsx` (using its existing FakeWebSocket harness): `mountCommander(...).refreshDesigns` is a function; for `kind: 'asic'` it resolves without fetching; for `kind: 'fpga'` with `apiBase` it calls `fetch('/api/board/fpga-1/designs', …)`. Plus: when the FakeWebSocket's reader errors mid-session (simulate the reader throwing), the carrier is closed (`FakeWebSocket.close` called) before the reconnect is scheduled.
- [ ] **Step 2: Implement** — `EmbedApp` accepts an optional `onHandle?: (h: { refreshDesigns(): Promise<void> }) => void` prop (or `mountCommander` keeps a module-level setter) and `embed.tsx` returns `{ unmount, refreshDesigns: () => (opts.board.kind === 'fpga' && opts.apiBase ? loadFpgaDesigns(opts.apiBase) : Promise.resolve()) }`. In `onClosed` add `void (carrier as SerialTransport).close().catch(() => {});` before `scheduleReconnect(...)` (issue #7 part 1). Part 2 (unparseable firmware) is covered by `safeCompareVersions` in Task 2; additionally in `EmbedApp`'s `createEffect` firmware check keep the try/catch (already there).
- [ ] **Step 3: Run** — full `npx vitest run`, lint, typecheck, `npm run build`, `npm run build:embed`.
- [ ] **Step 4: Commit** — `feat(embed): refreshDesigns() handle; close the carrier on every reconnect path (#7)` + trailer.

---

### Task 5: Docs, version, PR, release

- [ ] **Step 1: README.fpgas-online.md** — document the `fpga` kind (designs from `apiBase/designs`, Load design → `POST …/enable`, pinout from metadata), `refreshDesigns()`, and the #7 behaviour change. `package.json` version → `0.2.0` (and `package-lock.json` via `npm version 0.2.0 --no-git-tag-version`).
- [ ] **Step 2: PR** — branch `fpga-kind`, PR to `fpgas-online`, CI green, merge (the controller merges per the project's process), then tag `embed-v0.2.0` on the merge commit and push the tag; `release-embed.yml` publishes `tt-commander-embed-0.2.0.tar.gz` + `.sha256`. Record the sha256 in the SDD ledger for the infra plan.

---

## Self-review

- Spec §A.3 `fpga`: project list from `/designs` ✓ (Task 1/2), Load design → `POST …/enable` ✓ (Task 2), PinoutPanel renders demo pinout ✓ (Task 3); host-page refresh after upload ✓ (Task 4); issue #7 ✓ (Tasks 2/4). `kianv` is phase 3 (untouched).
- Placeholders: none. Types: `FpgaDesign`, `designToProject`, `loadFpgaDesigns`, `enableFpgaDesign`, `DaemonError`, `pinoutFromDesign`, `safeCompareVersions`, `refreshDesigns` used consistently.

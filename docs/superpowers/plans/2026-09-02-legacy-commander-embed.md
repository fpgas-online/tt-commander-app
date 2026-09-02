# Legacy Commander Embed (tt03p5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port upstream's SDK-agnostic `legacy` Commander branch to the fpgas.online WebSocket transport with a `mountCommander` embed bundle, so the tt03p5 board on tinytapeout.fpgas.online becomes interactive.

**Architecture:** Mirror the `main` → `fpgas-online` port on the `legacy` branch: introduce the `SerialTransport` seam under the legacy `TTBoardDevice` (which bit-bangs the demo-board mux from `ttcontrol.py` — no TT SDK, no firmware minimum), copy the proven `WebSocketTransport`/backoff/embed machinery from `origin/fpgas-online`, and build a second embed bundle released from `legacy-embed-v*` tags. No firmware-version gate and no bootloader/firmware-update affordances in embedded mode — a 2.x "update" would brick a tt03p5 board.

**Tech Stack:** SolidJS + SUID (legacy versions), Vite 5, Vitest 1, TypeScript; GitHub Actions for CI/release.

**Spec:** fpgas-online/tt-commander-app#9 (issue + Tim's 2026-08-24 comment = the approved direction). Background: `fpgas.online-infra/docs/superpowers/specs/2026-08-22-tinytapeout-fpgas-online-design.md` §4 and this repo's `docs/superpowers/plans/2026-08-22-commander-web-transport-phase1.md` (on `origin/fpgas-online`).

## Global Constraints

- **NEVER push, open PRs, file issues, or comment on `TinyTapeout/tt-commander-app` (upstream).** The `upstream` remote's push URL is set to `DISABLED-no-push-to-upstream`; leave it that way. All pushes go to `origin` = `fpgas-online/tt-commander-app`.
- Branch model: `origin/legacy` is a pristine mirror of `upstream/legacy` (like `main` mirrors upstream `main`) — never commit to it. `legacy-fpgas-online` is the long-lived ported branch (like `fpgas-online`). This work happens on `legacy-ws-embed` and lands via PR into **`legacy-fpgas-online`** (create PRs with `-R fpgas-online/tt-commander-app --base legacy-fpgas-online`, never let `gh` default to the upstream repo).
- Every new file carries `// SPDX-License-Identifier: Apache-2.0` + `// Copyright (C) 2026, fpgas.online contributors`; files copied from `origin/fpgas-online` keep their existing headers.
- Small discrete commits; run `npx prettier --write` on files you touch; CI green before merge; never force-push (use `git safe-force-push <branch>` if a forced push is ever unavoidable).
- Embedded mode must not expose "Reset to Bootloader", "Disconnect", or any firmware-update path unless `admin: true`.
- Copy source files from the ported branch with `git show origin/fpgas-online:<path> > <path>` — do not retype them.
- Node >= 18 locally; CI uses Node 24 like the `fpgas-online` branch's `ci.yml`.

---

### Task 1: Baseline — legacy branch builds

**Files:** none modified.

- [ ] **Step 1:** `npm ci`
- [ ] **Step 2:** `npm run build` — Expected: vite build completes, `dist/` produced. If the pristine legacy branch does not build, STOP and report; do not fix upstream code in this task.

### Task 2: Test + build tooling (Vite 5, Vitest 1, scripts)

**Files:**
- Modify: `package.json`
- Create: `vitest.config.js`, `src/tooling.spec.ts`

**Interfaces:** Produces `npm test -- --run`, `npm run typecheck`, `npm run build:embed` (used by every later task; `build:embed` config arrives in Task 6 — the script may point at a not-yet-existing config until then, that is fine because only Task 6+ runs it).

- [ ] **Step 1:** Edit `package.json`:
  - scripts: add `"test": "vitest"`, `"typecheck": "tsc --noEmit"`, `"build:embed": "vite build --config vite.embed.config.js"`.
  - devDependencies: change `"vite": "^4.5.2"` → `"^5.4.19"`, `"vite-plugin-solid": "^2.9.1"` → `"^2.11.0"`, `"@suid/vite-plugin": "^0.1.5"` → `"^0.4.0"`; add `"vitest": "^1.6.1"`, `"jsdom": "^25.0.1"`.
  - If `npm install` reports peer-dependency conflicts, keep Vite on 5.x and pick the nearest versions of the plugins that satisfy peers; record any deviation in the commit message.
- [ ] **Step 2:** `npm install` (updates `package-lock.json`).
- [ ] **Step 3:** Create `vitest.config.js` — copy verbatim from the ported branch: `git show origin/fpgas-online:vitest.config.js > vitest.config.js` (it merges `vite.config.js` and forces browser+development resolve conditions for Solid under jsdom).
- [ ] **Step 4:** Write the smoke test `src/tooling.spec.ts`:

```ts
// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026, fpgas.online contributors
import { describe, expect, it } from 'vitest';

describe('tooling', () => {
  it('runs tests under jsdom', () => {
    expect(typeof document).toBe('object');
  });
});
```

- [ ] **Step 5:** `npm test -- --run` — Expected: 1 test passes.
- [ ] **Step 6:** `npm run build` — Expected: still builds under Vite 5. `npm run typecheck` — expected clean; if upstream legacy code has pre-existing typecheck errors, note them in the commit message and leave them (do not fix upstream code here).
- [ ] **Step 7:** Commit: `git add package.json package-lock.json vitest.config.js src/tooling.spec.ts && git commit -m "chore(legacy): vite 5 + vitest tooling for the fpgas.online port"`

### Task 3: Copy the transport layer

**Files:**
- Create: `src/transport/SerialTransport.ts`, `src/transport/WebSerialTransport.ts`, `src/transport/WebSocketTransport.ts`, `src/transport/testing/FakeWebSocket.ts`
- Test: `src/transport/WebSerialTransport.spec.ts`, `src/transport/WebSocketTransport.spec.ts`

**Interfaces:** Produces `SerialTransport` (`readable: ReadableStream<Uint8Array>`, `writable: WritableStream<Uint8Array>`, `state: 'connecting'|'open'|'closed'`, `close(): Promise<void>`, events `open`/`close`/`error`/`message`), `WebSerialTransport` (wraps an open `SerialPort`), `WebSocketTransport(url, {WebSocketImpl?, openTimeoutMs?})` with `.ready: Promise<void>` and `.closeInfo`. Task 4 consumes `SerialTransport`; Task 5 consumes `WebSocketTransport`.

- [ ] **Step 1:** Copy all six files verbatim:

```bash
mkdir -p src/transport/testing
for f in src/transport/SerialTransport.ts src/transport/WebSerialTransport.ts \
         src/transport/WebSocketTransport.ts src/transport/testing/FakeWebSocket.ts \
         src/transport/WebSerialTransport.spec.ts src/transport/WebSocketTransport.spec.ts; do
  git show origin/fpgas-online:$f > $f
done
```

- [ ] **Step 2:** `npm test -- --run` — Expected: transport specs pass unmodified (they only depend on each other and on DOM/stream globals). If an import fails (e.g. a `~` alias gap in the legacy `tsconfig.json`), add to `tsconfig.json` `compilerOptions`: `"paths": { "~/*": ["./src/*"] }` with `"baseUrl": "."` — the legacy `vite.config.js` already defines the runtime alias.
- [ ] **Step 3:** `npm run typecheck` — Expected: no NEW errors beyond any noted in Task 2.
- [ ] **Step 4:** Commit: `git add src/transport tsconfig.json && git commit -m "feat(legacy): SerialTransport seam + WebSerial/WebSocket carriers (from fpgas-online)"`

### Task 4: Port legacy TTBoardDevice onto the transport seam

**Files:**
- Modify: `src/ttcontrol/TTBoardDevice.ts` (222 lines), `src/components/App.tsx:24-31`
- Test: `src/ttcontrol/TTBoardDevice.spec.ts` (new)

**Interfaces:** `TTBoardDevice` constructor changes `(port: SerialPort)` → `(transport: SerialTransport)`; everything else (`start()`, `close()`, `sendCommand()`, `selectDesign(index: number)`, `attachTerminal`/`detachTerminal`, `data` store with `deviceName/version/shuttle/logs`) keeps its legacy signature. Task 5's EmbedApp consumes exactly this.

- [ ] **Step 1: Write the failing test** `src/ttcontrol/TTBoardDevice.spec.ts`. Model it on `git show origin/fpgas-online:src/ttcontrol/TTBoardDevice.spec.ts` (read it first for the FakeTransport pattern), but assert the **legacy** protocol. Core cases:

```ts
// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026, fpgas.online contributors
import { describe, expect, it } from 'vitest';
import { TTBoardDevice } from './TTBoardDevice';
import ttControl from './ttcontrol.py?raw';

// Minimal in-memory SerialTransport double (reuse the shape from the
// fpgas-online spec: readable fed by a controller, writable collecting
// decoded strings, state + close()).
function makeFakeTransport() { /* copy from origin/fpgas-online spec */ }

describe('TTBoardDevice (legacy protocol)', () => {
  it('start() enters RAW REPL, sends ttcontrol.py and read_rom()', async () => {
    const { transport, written } = makeFakeTransport();
    const dev = new TTBoardDevice(transport);
    await dev.start();
    const all = written.join('');
    expect(all).toContain('\x03\x03'); // stop running program
    expect(all).toContain('\x01'); // enter RAW REPL
    expect(all).toContain(ttControl); // the bit-banging control script
    expect(all).toContain('read_rom()\x04');
  });

  it('parses firmware=/version=/shuttle= lines into the store', async () => {
    const { transport, feed } = makeFakeTransport();
    const dev = new TTBoardDevice(transport);
    await dev.start();
    feed('firmware=tt-demo-rp2040\r\nversion=1.2.2\r\n');
    await Promise.resolve();
    expect(dev.data.deviceName).toBe('tt-demo-rp2040');
    expect(dev.data.version).toBe('1.2.2');
  });

  it('selectDesign(n) sends select_design(n) with RAW-REPL terminator', async () => {
    const { transport, written } = makeFakeTransport();
    const dev = new TTBoardDevice(transport);
    await dev.start();
    await dev.selectDesign(5);
    expect(written.join('')).toContain('select_design(5)\x04');
  });

  it('close() tears down without throwing when the carrier is already dead', async () => {
    const { transport, kill } = makeFakeTransport();
    const dev = new TTBoardDevice(transport);
    await dev.start();
    kill();
    await expect(dev.close()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2:** `npm test -- --run` — Expected: FAIL (constructor still takes `SerialPort`, `close()` rethrows on dead carrier).
- [ ] **Step 3:** Port `TTBoardDevice.ts`, mirroring the fpgas-online adaptation but keeping the simpler legacy protocol:
  - `constructor(readonly transport: SerialTransport)`; drop the `SerialPort` import/reference.
  - `start()`: keep the legacy sequence exactly (`\x03\x03`, `\x01`, `ttControl + '\x04'`, `sendCommand('read_rom()')`) but pipe through `this.transport.writable` and add `this.writableStreamClosed.catch(() => {});` after the `pipeTo` (a remote carrier can drop at any moment).
  - `run()`: replace `while (port.readable)` with the single-pass loop from the ported branch — `while (transport.state !== 'closed' && transport.readable)` with `break outer` when `done` (a transport readable ends exactly once; never re-pipe a finished stream), and `this.readableStreamClosed.catch(() => {});` plus `.catch()` on `processTerminalStream(...)` (see `git show origin/fpgas-online:src/ttcontrol/TTBoardDevice.ts` lines ~330-390 for the exact shape).
  - `close()`: guard every step with `.catch(() => {})` exactly like the ported branch (reader cancels, `readableStreamClosed`, writer write/close, then `await this.transport.close()` instead of `port.close()`), and dispatch `close` once at the end.
- [ ] **Step 4:** Update `src/components/App.tsx` connect(): keep WebSerial for the standalone page by wrapping the port:

```ts
import { WebSerialTransport } from '~/transport/WebSerialTransport';
// inside connect(), after await port.open({ baudRate: 115200 }):
const device = new TTBoardDevice(new WebSerialTransport(port));
```

- [ ] **Step 5:** `npm test -- --run` — Expected: PASS. `npm run build` — Expected: PASS.
- [ ] **Step 6:** Commit: `git add src/ttcontrol/TTBoardDevice.ts src/ttcontrol/TTBoardDevice.spec.ts src/components/App.tsx && git commit -m "feat(legacy): drive TTBoardDevice through the SerialTransport seam"`

### Task 5: EmbedApp + mountCommander (legacy variant)

**Files:**
- Create: `src/model/backoff.ts`, `src/model/backoff.spec.ts`, `src/components/EmbedApp.tsx`, `src/embed.tsx`
- Modify: `src/components/BoardCommander.tsx`
- Test: `src/components/EmbedApp.spec.tsx`

**Interfaces:** Produces `mountCommander(el: HTMLElement, opts: EmbedOptions): { unmount(): void }` from `src/embed.tsx` with `EmbedOptions = { transport: { kind: 'websocket'; url: string; WebSocketImpl?: typeof WebSocket }; chrome?: { header: boolean; footer: boolean }; admin?: boolean; reconnect?: { minDelayMs: number; maxDelayMs: number } }` — the same call shape the site already uses for the main embed, minus `board`/`apiBase` (the legacy embed is ASIC-only and needs neither). `BoardCommander` gains optional `embedded?: boolean; admin?: boolean` props.

- [ ] **Step 1:** Copy the backoff helper + spec verbatim: `mkdir -p src/model` (exists) then `git show origin/fpgas-online:src/model/backoff.ts > src/model/backoff.ts` and the same for `src/model/backoff.spec.ts`. Run `npm test -- --run` — backoff spec passes.
- [ ] **Step 2: Write the failing test** `src/components/EmbedApp.spec.tsx`. Start from `git show origin/fpgas-online:src/components/EmbedApp.spec.tsx` (FakeWebSocket-driven: connect, surface close reason, back-off retry, single socket per retry — keep those cases, they encode fix #7 for the reconnect storm) and adjust:
  - remove the `board`/`apiBase`/fpga cases and the firmware-outdated case (the legacy embed has no version gate);
  - add: `it('hides Disconnect and Reset to Bootloader when not admin', ...)` — render with `admin: false` (default), assert neither button is in the DOM; with `admin: true`, both appear.
- [ ] **Step 3:** `npm test -- --run` — Expected: FAIL (`EmbedApp` does not exist).
- [ ] **Step 4:** Create `src/components/EmbedApp.tsx` from `git show origin/fpgas-online:src/components/EmbedApp.tsx`, then strip it down:
  - delete the `boardInfo`/`fpgaDesigns`/`firmware` imports and everything they gate (`setBoardInfo(...)` call, `loadFpgaDesigns` in `onMount`, the whole `firmwareOutdated` signal/effect and its `<Paper>` block);
  - `EmbedOptions` shrinks to the shape in **Interfaces** above;
  - keep unchanged: `STABLE_CONNECTION_MS`, `scheduleReconnect`/`makeTransport`/`connect`/`reconnectNow`/`onCleanup` (this logic is the hard-won #7 fix — copy, don't rewrite), the carrier-notice and board-present alerts, the chrome/header/footer handling and the theme-scoped root `<Stack>`;
  - the render becomes `<BoardCommander device={dev()} embedded admin={props.options.admin ?? false} />`.
- [ ] **Step 5:** Modify `src/components/BoardCommander.tsx` (legacy, 108 lines): add to `IBreakoutControlProps` the optional `embedded?: boolean; admin?: boolean`; wrap the Disconnect `<Button>` (lines 53-55) and the "Reset to Bootloader" block (lines 101-105) each in `<Show when={!props.embedded || props.admin}>`. Nothing else changes — Config/Interact/Pinout/REPL tabs stay as upstream wrote them.
- [ ] **Step 6:** Create `src/embed.tsx`:

```tsx
// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026, fpgas.online contributors

import { render } from 'solid-js/web';
import { EmbedApp, type EmbedOptions } from '~/components/EmbedApp';

export type { EmbedOptions };

export interface CommanderHandle {
  unmount(): void;
}

export function mountCommander(el: HTMLElement, opts: EmbedOptions): CommanderHandle {
  const dispose = render(() => <EmbedApp options={opts} />, el);
  return {
    unmount() {
      dispose();
      el.replaceChildren();
    },
  };
}
```

  (No xterm CSS import unless the legacy `ReplPanel` needs it — check `src/components/ReplPanel.tsx` imports; legacy uses `xterm` 5, so if it imports `xterm/css/xterm.css` itself, nothing to add; if the standalone `index.html`/`index.tsx` carries the CSS, add the equivalent import here.)
- [ ] **Step 7:** `npm test -- --run` — Expected: PASS (all specs). `npm run build` — PASS.
- [ ] **Step 8:** Commit: `git add src/model/backoff.ts src/model/backoff.spec.ts src/components/EmbedApp.tsx src/components/EmbedApp.spec.tsx src/components/BoardCommander.tsx src/embed.tsx && git commit -m "feat(legacy): WebSocket embed with mountCommander, no firmware gate"`

### Task 6: Embed library build

**Files:**
- Create: `vite.embed.config.js`
- Modify: `.gitignore` (if `dist/` is not already ignored)

**Interfaces:** Produces `npm run build:embed` → `dist/embed/tt-commander-embed.js` + `tt-commander-embed.css` + source map. Keep these exact output filenames — the site's loader is uniform across main/legacy bundles; the *version directory* (site/infra concern) is what distinguishes them.

- [ ] **Step 1:** `git show origin/fpgas-online:vite.embed.config.js > vite.embed.config.js` — verbatim copy (lib build, ES format, `fileName: () => 'tt-commander-embed.js'`, sourcemap, `publicDir: false`, `process.env.NODE_ENV` defined). The `__COMMIT_HASH__`/`__BUILD_TIME__` defines are harmless if legacy code never references them; if the build fails on them, keep them (they are `define`s, not imports).
- [ ] **Step 2:** `npm run build:embed` — Expected: `dist/embed/tt-commander-embed.js` (a few hundred KB) + `.css` + `.js.map` produced.
- [ ] **Step 3:** Commit: `git add vite.embed.config.js .gitignore && git commit -m "build(legacy): tt-commander-embed library bundle"`

### Task 7: CI and release workflows

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/release-legacy-embed.yml`

**Interfaces:** CI runs on pushes/PRs to `legacy-fpgas-online` and `legacy-*` branches: install, lint-if-present, typecheck, `npm test -- --run`, `npm run build`, `npm run build:embed`. Release fires on tags `legacy-embed-v*` and uploads `tt-commander-legacy-embed-<version>.tar.gz` (containing `tt-commander-embed.js/.css/.js.map`) + a `.sha256` file to a GitHub Release — the same secretless pull model the main embed uses (infra downloads by tag + sha256 pin).

- [ ] **Step 1:** Read the ported branch's workflows first: `git show origin/fpgas-online:.github/workflows/ci.yml` and `git show origin/fpgas-online:.github/workflows/release-embed.yml`. Copy both, then adjust:
  - `ci.yml`: branch filters → `[legacy-fpgas-online, 'legacy-*']`; drop steps that call scripts the legacy branch lacks (e.g. `npm run lint` if Task 2 did not add a lint script — legacy's eslint 6 setup predates the flat-config wrapper; do NOT port the lint script in this plan) — keep typecheck, test, build, build:embed.
  - `release-legacy-embed.yml` (renamed from `release-embed.yml`): tag trigger `legacy-embed-v*`; tarball name `tt-commander-legacy-embed-${VERSION}.tar.gz`; contents from `dist/embed/`.
- [ ] **Step 2:** Validate YAML locally: `uv run python -c "import pathlib, yaml; [yaml.safe_load(p.read_text()) for p in pathlib.Path('.github/workflows').glob('*.yml')]; print('ok')"`
- [ ] **Step 3:** Commit: `git add .github/workflows && git commit -m "ci(legacy): test/build workflow + legacy-embed release from legacy-embed-v* tags"`

### Task 8: Docs

**Files:**
- Create: `README.legacy-fpgas-online.md`

- [ ] **Step 1:** Write `README.legacy-fpgas-online.md` (model: `git show origin/fpgas-online:README.fpgas-online.md`). Must cover: why this branch exists (tt03p5 needs firmware 1.2.2; upstream `legacy` is the SDK-agnostic app), the branch model (`legacy` mirror / `legacy-fpgas-online` port / PRs with explicit `--base`), the `mountCommander` options contract from Task 5, `npm` commands, the release-tag flow, the **no-upstream-contact rule**, and the explicit warning that the firmware-update path must never be added because 2.x firmware breaks tt03p5.
- [ ] **Step 2:** `npx prettier --write README.legacy-fpgas-online.md`
- [ ] **Step 3:** Commit: `git add README.legacy-fpgas-online.md && git commit -m "docs(legacy): fpgas.online legacy-branch port notes"`
- [ ] **Step 4 (separate PR, after this branch merges):** on a new branch off `fpgas-online`, update `CLAUDE.md`'s Branches section to document `legacy` / `legacy-fpgas-online`, PR into `fpgas-online`.

### Task 9: Hardware verification against tt03p5 (firmware 1.2.2)

**Files:**
- Create: `tmp/legacy-embed-harness.html` (untracked scratch; delete after)

**Interfaces:** Consumes the Task 6 bundle and the live bridge `wss://tinytapeout.fpgas.online/ws/board/tt03p5/serial` (single-owner: connecting takes the board's serial — fine, it is our board).

- [ ] **Step 1:** Build (`npm run build:embed`) and write `tmp/legacy-embed-harness.html`:

```html
<!doctype html>
<meta charset="utf-8" />
<title>legacy embed harness</title>
<link rel="stylesheet" href="../dist/embed/tt-commander-embed.css" />
<div id="root"></div>
<script type="module">
  import { mountCommander } from '../dist/embed/tt-commander-embed.js';
  mountCommander(document.getElementById('root'), {
    transport: { kind: 'websocket', url: 'wss://tinytapeout.fpgas.online/ws/board/tt03p5/serial' },
    admin: false,
  });
</script>
```

- [ ] **Step 2:** Serve the repo root (`uv run python -m http.server 8931`) and drive `http://localhost:8931/tmp/legacy-embed-harness.html` with the Playwright MCP browser. Acceptance, in order:
  1. The embed connects (no reconnect loop within 60 s — watch for #7-style storms in the network log).
  2. `shuttle=tt03p5` is detected and the Config tab lists the 27 projects (shuttle index from index.tinytapeout.com).
  3. Selecting `tt_um_test` and one other project sends `select_design(...)` and the DebugLogs pane shows the board's responses without errors.
  4. The REPL tab round-trips (type `help()` → output).
  5. No "Disconnect"/"Reset to Bootloader" buttons are visible.
- [ ] **Step 3:** Reload the page twice — the daemon must keep exactly one client (`/board/tt03p5/status.json` → `clients` ≤ 1 after settle); confirms no leaked sockets.
- [ ] **Step 4:** Record results (pass/fail per acceptance item, firmware/shuttle strings observed) in the PR description; comment the summary on issue #9 **in the fork repo** (`gh issue comment 9 -R fpgas-online/tt-commander-app`). Delete `tmp/legacy-embed-harness.html`.

### Out of scope (follow-up, other repos)

- **fpgas.online-site:** load the legacy bundle for boards whose catalogue row selects it (e.g. `commander: legacy`) and pass no `board`/`apiBase`; new `TTSITE_COMMANDER_LEGACY_VERSION` setting.
- **fpgas.online-infra:** pin + fetch the `legacy-embed-v*` release into the ttsite static tree (mirror of the existing embed pin, sha256-verified); flip the tt03p5 catalogue description away from "camera-only".
- Tag `legacy-embed-v0.1.0` once the site integration is ready to consume it.

## Self-review notes

- Spec coverage: issue #9 items — legacy port instead of 1.x compat (Tasks 3-6), never offer 2.x firmware (Task 5 hides bootloader; legacy has no update flow — Task 8 documents the rule), protocol verification against 1.2.2 (Task 9), catalogue stays gated until this lands (out-of-scope section).
- Type consistency: `EmbedOptions` defined once in Task 5 and echoed in Tasks 6/9 harness; `TTBoardDevice(transport: SerialTransport)` consistent across Tasks 4-5.

# Commander fork: web transport + embeddable build (phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fork `TinyTapeout/tt-commander-app` under `fpgas-online`, put all hardware I/O behind a `SerialTransport` interface, add a `WebSocketTransport` that talks to the Pi daemon's `WS /serial`, and ship an embeddable ES-module build (`mountCommander(el, opts)`) the Django `ttsite` page can mount — with CI and a tagged release artifact.

**Architecture:** Upstream `TTBoardDevice` drives the MicroPython raw REPL over a WebSerial `SerialPort`'s `readable`/`writable` streams. We introduce `SerialTransport` (the exact stream subset `TTBoardDevice` uses), a `WebSerialTransport` adapter (standalone app unchanged), and a single-shot `WebSocketTransport` whose streams end when the socket closes; reconnection lives in the embed layer (`EmbedApp`), which tears down and recreates transport + device with back-off. The embed is a Vite library build of `src/embed.tsx`; the standalone Pages app keeps working for upstream parity. Kind-aware behaviour (`kianv`/`fpga`, spec §4.3) is **later phases** — only the `board` metadata plumbing lands now.

**Tech Stack:** SolidJS 1.9, SUID (MUI for Solid), xterm, Vite 6, vitest (+ jsdom), TypeScript strict, ESLint/Prettier, GitHub Actions, Node 24.

**Spec:** `fpgas.online-infra/docs/superpowers/specs/2026-08-22-tinytapeout-fpgas-online-design.md` §4 (A.1–A.5), §3, §9, §12. Daemon protocol (consumed here): `fpgas.online-tt` README — binary frames = board bytes both ways; server→client text frames = JSON events `{"event":"board","present":bool,"device":str}` / `{"event":"error","error":str}`; close 1011 `board disconnected`, 1008 `client too slow`, 1001 `server shutdown`.

## Global Constraints

- Fork repo `fpgas-online/tt-commander-app`. `main` mirrors upstream and is never committed to. Long-lived branch **`fpgas-online`** (the fork's default branch) carries our work; every change is a feature branch (in `.worktrees/`) → PR into `fpgas-online` → CI green → merge. Rebaseable on upstream: every change is additive or a minimal seam; never reformat or reorganise upstream files beyond the seam.
- Keep upstream's `SPDX-License-Identifier: Apache-2.0` headers; new files carry `// SPDX-License-Identifier: Apache-2.0` and `// Copyright (C) 2026, fpgas.online contributors`.
- `TTBoardDevice`'s REPL bootstrap and command protocol are unchanged. The only change to it is the constructor parameter type and the three places it touches `port.readable` / `port.writable` / `port.close()`.
- `SerialTransport` interface (exact):
  ```ts
  export type TransportState = 'connecting' | 'open' | 'closed';
  export interface SerialTransport extends EventTarget {
    readonly readable: ReadableStream<Uint8Array>;
    readonly writable: WritableStream<Uint8Array>;
    readonly state: TransportState;
    close(): Promise<void>;
  }
  // events: 'open' (Event), 'close' (Event), 'error' (ErrorEvent-like CustomEvent<{message:string}>),
  //         'message' (CustomEvent<Record<string, unknown>>) — out-of-band JSON events from the daemon
  ```
- `EmbedOptions` (exact):
  ```ts
  export interface EmbedOptions {
    transport: { kind: 'websocket'; url: string } | { kind: 'webserial' };
    board: { slug: string; kind: 'asic' | 'kianv' | 'fpga'; shuttle?: string };
    apiBase?: string;
    chrome?: { header: boolean; footer: boolean }; // default { header: false, footer: false }
    admin?: boolean; // default false; shows "Reset to Bootloader"
    reconnect?: { minDelayMs: number; maxDelayMs: number }; // default { 1000, 30000 }
  }
  export function mountCommander(el: HTMLElement, opts: EmbedOptions): { unmount(): void };
  ```
- Embed build output: `dist/embed/tt-commander-embed.js` (ES module, all deps inlined, no externals) + `dist/embed/tt-commander-embed.css`; no Google Fonts link inside the bundle (the host page provides Roboto).
- Prettier config is upstream's (`printWidth: 100`, single quotes, trailing commas); run `npx prettier --write` on every file you touch; CI runs `prettier --check`.
- Commit trailer on every commit:
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01UdRpsg6jY8PbcQxxX6txKE
  ```
- Dates ISO; never `/tmp` (use `./tmp/` inside the repo — add it to `.gitignore`).

---

## File structure

```
tt-commander-app/  (fork, branch fpgas-online)
├── src/transport/SerialTransport.ts        interface + TransportState + event typing helpers
├── src/transport/WebSerialTransport.ts     adapter over navigator.serial SerialPort
├── src/transport/WebSocketTransport.ts     single-shot WS → streams; JSON text → 'message' events
├── src/transport/WebSocketTransport.spec.ts
├── src/transport/WebSerialTransport.spec.ts
├── src/ttcontrol/TTBoardDevice.ts          (modify: takes SerialTransport)
├── src/components/App.tsx                  (modify: wraps SerialPort in WebSerialTransport)
├── src/components/BoardCommander.tsx       (modify: `embedded` + `admin` props)
├── src/components/EmbedApp.tsx             connection loop + chrome + status banner + BoardCommander
├── src/components/EmbedApp.spec.tsx        mount smoke test (jsdom)
├── src/embed.tsx                           mountCommander()
├── src/model/board.ts                      BoardInfo store (slug/kind/shuttle/apiBase) for later phases
├── vite.embed.config.js                    library build
├── vite.config.js                          (modify: vitest environment jsdom)
├── package.json                            (modify: build:embed, lint, test scripts)
├── .github/workflows/ci.yml                lint + typecheck + test + both builds, on PRs to fpgas-online
├── .github/workflows/release-embed.yml     on tag embed-v*: build embed, tarball, GitHub Release asset
├── .gitignore                              (modify: .worktrees/, tmp/, .superpowers/)
├── README.fpgas-online.md                  what the fork adds, how to embed, protocol pointer
├── CLAUDE.md                               fork conventions (new; upstream has none)
└── docs/superpowers/plans/2026-08-22-commander-web-transport-phase1.md  (this file)
```

---

### Task 1: Fork, `fpgas-online` branch, CI baseline

**Files:**

- Create: `.github/workflows/ci.yml`, `CLAUDE.md`, `docs/superpowers/plans/2026-08-22-commander-web-transport-phase1.md` (copy of this plan), `.gitignore` additions
- Modify: `package.json` scripts

**Interfaces:**

- Produces: the fork repo with default branch `fpgas-online`; `npm run lint`, `npm run typecheck`, `npm test -- --run`, `npm run build` all green in CI.

- [ ] **Step 1: Fork and clone**

```bash
cd /home/tim/github/fpgas-online
gh repo fork TinyTapeout/tt-commander-app --org fpgas-online --clone=false --default-branch-only
git clone git@github.com:fpgas-online/tt-commander-app.git   # or https, whatever gh is set up for
cd tt-commander-app
git remote add upstream https://github.com/TinyTapeout/tt-commander-app.git
git fetch upstream
git checkout -b fpgas-online upstream/main
```

Then invoke the `github-setup` skill for `fpgas-online/tt-commander-app` (public) — apply the org-standard settings; afterwards set the default branch: `gh repo edit fpgas-online/tt-commander-app --default-branch fpgas-online` (push the branch first, Step 6). Leave `main` untouched forever (mirror of upstream: `git fetch upstream && git push origin upstream/main:main` is the only thing that ever moves it).

- [ ] **Step 2: Baseline the toolchain**

Run: `npm ci && npm run build && npx vitest run`
Expected: build OK (warns about chunk size are fine), vitest passes the two upstream spec files (`firmware.spec.ts`, `shuttle.spec.ts`).
Then try lint: `npx eslint src --ext .ts,.tsx`. If ESLint 9 rejects the legacy-format `eslint.config.cjs` ("ESLint couldn't find an eslint.config… " or a flat-config error), use `ESLINT_USE_FLAT_CONFIG=false npx eslint src --ext .ts,.tsx` and record that in `package.json`'s `lint` script; do not rewrite upstream's ESLint config.

- [ ] **Step 3: Scripts, gitignore, CLAUDE.md**

`package.json` scripts — add/adjust (keep upstream's `start`, `build`, `test`, `prepare`):

```json
"lint": "ESLINT_USE_FLAT_CONFIG=false eslint src --ext .ts,.tsx && prettier --check .",
"typecheck": "tsc --noEmit",
"build:embed": "vite build --config vite.embed.config.js"
```

(`build:embed` will fail until Task 4 creates the config — CI only adds it in Task 4.) If Step 2 showed ESLint works without the env var, drop it from the script.

`.gitignore` — append:

```
# git worktrees for feature branches (superpowers:using-git-worktrees)
.worktrees/
# SDD workspace
.superpowers/
# local scratch
tmp/
```

`CLAUDE.md` (new):

```markdown
## Background

This is the fpgas.online fork of [TinyTapeout/tt-commander-app](https://github.com/TinyTapeout/tt-commander-app),
used by [tinytapeout.fpgas.online](https://tinytapeout.fpgas.online) to drive Tiny Tapeout demo boards
that live on Raspberry Pis at Welland, South Australia, over a WebSocket bridge instead of local WebSerial.
Design spec: `fpgas.online-infra/docs/superpowers/specs/2026-08-22-tinytapeout-fpgas-online-design.md` §4.

## Branches

- `main` — mirror of upstream `TinyTapeout/tt-commander-app` `main`. Never commit here.
- `fpgas-online` — default branch; all fork work lands here via PRs. Keep changes additive
  behind the `SerialTransport` seam so upstream rebases cleanly and pieces can be offered upstream.

## What the fork adds

- `src/transport/` — `SerialTransport` interface, `WebSerialTransport` (upstream behaviour),
  `WebSocketTransport` (Pi daemon bridge: binary frames = board bytes, text frames = JSON events).
- `src/embed.tsx` + `src/components/EmbedApp.tsx` — `mountCommander(el, opts)` embeddable build
  (`npm run build:embed` → `dist/embed/tt-commander-embed.{js,css}`).
- `.github/workflows/ci.yml` (lint, typecheck, test, builds) and `release-embed.yml` (tag `embed-v*`).

## Conventions

- Node 24, `npm ci`. `npm run lint`, `npm run typecheck`, `npm test -- --run`, `npm run build`, `npm run build:embed`.
- Prettier is upstream's config; run `npx prettier --write` on files you touch.
- Dates ISO 8601. Small, discrete commits; every change via PR into `fpgas-online`; CI green before merge; never force-push.
- Apache-2.0 (upstream's licence); keep SPDX headers.
```

- [ ] **Step 4: CI workflow**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [fpgas-online]
  pull_request:
    branches: [fpgas-online]

jobs:
  check:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v6
        with:
          node-version: '24'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npx vitest run
      - run: npm run build
```

(Task 4 adds `- run: npm run build:embed` and an artifact upload.)

Also edit upstream's `.github/workflows/deploy.yml` so it does not fire on the fork: change its trigger to `workflow_dispatch` only (one-line `on:` change; leave the rest). Rationale: the fork has no Pages site and a failing deploy on every push to `main` mirror is noise.

- [ ] **Step 5: Copy the plan in, verify, commit**

```bash
mkdir -p docs/superpowers/plans
cp /home/tim/github/fpgas-online/tmp/2026-08-22-commander-web-transport-phase1.md docs/superpowers/plans/
npm run lint && npm run typecheck && npx vitest run && npm run build
```

Expected: all green. Then:

```bash
git add .github/workflows/ci.yml .github/workflows/deploy.yml CLAUDE.md .gitignore package.json package-lock.json docs/
git commit -F - <<'EOF'
chore(fork): fpgas-online branch baseline — CI, CLAUDE.md, plan

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UdRpsg6jY8PbcQxxX6txKE
EOF
```

- [ ] **Step 6: Push the branch, make it default, confirm CI**

```bash
git push -u origin fpgas-online
gh repo edit fpgas-online/tt-commander-app --default-branch fpgas-online
gh run list --repo fpgas-online/tt-commander-app --limit 2     # CI on push to fpgas-online must be green
```

This is the one direct push to `fpgas-online` (branch creation). From here on: worktree → PR into `fpgas-online`.

---

### Task 2: `SerialTransport` interface + `WebSerialTransport`; `TTBoardDevice` takes a transport

**Files:**

- Create: `src/transport/SerialTransport.ts`, `src/transport/WebSerialTransport.ts`, `src/transport/WebSerialTransport.spec.ts`
- Modify: `src/ttcontrol/TTBoardDevice.ts` (constructor + 3 call sites), `src/components/App.tsx` (wrap the port)

**Interfaces:**

- Produces: `SerialTransport`, `TransportState`, `TransportEvents` helpers; `class WebSerialTransport implements SerialTransport` with `constructor(port: SerialPort)`; `TTBoardDevice` `constructor(readonly transport: SerialTransport)`.

- [ ] **Step 1: Write the interface**

`src/transport/SerialTransport.ts`:

```ts
// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026, fpgas.online contributors

/**
 * The subset of the Web Serial `SerialPort` surface that `TTBoardDevice` uses,
 * so the board can be reached over any byte-stream carrier (local WebSerial, a
 * WebSocket bridge to a remote Pi, a test double).
 *
 * Events: 'open' when the carrier becomes usable, 'close' when it ends (streams
 * are finished/errored by then), 'error' (CustomEvent<{ message: string }>) for
 * carrier-level failures, 'message' (CustomEvent<Record<string, unknown>>) for
 * out-of-band JSON events from the carrier (e.g. the Pi daemon's
 * {"event":"board",...}). Board bytes NEVER travel via events — only via `readable`.
 */
export type TransportState = 'connecting' | 'open' | 'closed';

export interface SerialTransport extends EventTarget {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
  readonly state: TransportState;
  close(): Promise<void>;
}

export type TransportMessage = Record<string, unknown>;

export function transportErrorEvent(message: string) {
  return new CustomEvent<{ message: string }>('error', { detail: { message } });
}

export function transportMessageEvent(detail: TransportMessage) {
  return new CustomEvent<TransportMessage>('message', { detail });
}
```

- [ ] **Step 2: Write the failing WebSerialTransport test**

`src/transport/WebSerialTransport.spec.ts`:

```ts
import { describe, expect, test, vi } from 'vitest';
import { WebSerialTransport } from './WebSerialTransport';

function fakePort() {
  const readable = new ReadableStream<Uint8Array>();
  const writable = new WritableStream<Uint8Array>();
  const close = vi.fn(async () => {});
  return { readable, writable, close } as unknown as SerialPort & { close: typeof close };
}

describe('WebSerialTransport', () => {
  test('exposes the port streams and is open immediately', () => {
    const port = fakePort();
    const t = new WebSerialTransport(port);
    expect(t.readable).toBe(port.readable);
    expect(t.writable).toBe(port.writable);
    expect(t.state).toBe('open');
  });

  test('close() closes the port, flips state and emits close once', async () => {
    const port = fakePort();
    const t = new WebSerialTransport(port);
    const onClose = vi.fn();
    t.addEventListener('close', onClose);
    await t.close();
    await t.close();
    expect(port.close).toHaveBeenCalledTimes(1);
    expect(t.state).toBe('closed');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/transport`
Expected: FAIL — cannot resolve `./WebSerialTransport`.

- [ ] **Step 4: Implement `WebSerialTransport`**

`src/transport/WebSerialTransport.ts`:

```ts
// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026, fpgas.online contributors

/// <reference types="dom-serial" />

import type { SerialTransport, TransportState } from './SerialTransport';

/** Local Web Serial port — upstream Commander behaviour, unchanged. */
export class WebSerialTransport extends EventTarget implements SerialTransport {
  private _state: TransportState = 'open';

  constructor(readonly port: SerialPort) {
    super();
  }

  get readable(): ReadableStream<Uint8Array> {
    return this.port.readable!;
  }

  get writable(): WritableStream<Uint8Array> {
    return this.port.writable!;
  }

  get state(): TransportState {
    return this._state;
  }

  async close(): Promise<void> {
    if (this._state === 'closed') {
      return;
    }
    this._state = 'closed';
    await this.port.close();
    this.dispatchEvent(new Event('close'));
  }
}
```

- [ ] **Step 5: Thread the transport through `TTBoardDevice` and `App.tsx`**

In `src/ttcontrol/TTBoardDevice.ts`:

- add `import type { SerialTransport } from '~/transport/SerialTransport';`
- change `constructor(readonly port: SerialPort)` → `constructor(readonly transport: SerialTransport)`
- in `start()`: `this.writableStreamClosed = textEncoderStream.readable.pipeTo(this.transport.writable);`
- in `run()`: replace `const { port } = this;` / `while (port.readable)` / `port.readable.pipeTo(...)` with `const { transport } = this;` / `while (transport.state !== 'closed')` / `transport.readable.pipeTo(textDecoder.writable)` — and make the loop `break` after the reader returns `done` (the WebSocket transport's readable ends exactly once; do not loop re-piping a finished stream).
- in `close()`: `await this.port.close();` → `await this.transport.close();`
- remove the `/// <reference types="dom-serial" />` dependency from this file if it is now unused (it is only needed where `SerialPort` is named).

In `src/components/App.tsx`:

- `import { WebSerialTransport } from '~/transport/WebSerialTransport';`
- `const device = new TTBoardDevice(new WebSerialTransport(port));`
  Nothing else in App changes.

- [ ] **Step 6: Run everything**

Run: `npx vitest run && npm run typecheck && npm run lint && npm run build`
Expected: all green (upstream specs + 2 new tests). Manually sanity check the standalone app still builds; behaviour is unchanged by construction.

- [ ] **Step 7: Commit, PR, CI**

```bash
git worktree add .worktrees/transport -b transport fpgas-online   # (before Step 1 if starting fresh)
git add src/transport/SerialTransport.ts src/transport/WebSerialTransport.ts src/transport/WebSerialTransport.spec.ts src/ttcontrol/TTBoardDevice.ts src/components/App.tsx
git commit -F - <<'EOF'
refactor(transport): SerialTransport seam; TTBoardDevice takes a transport

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UdRpsg6jY8PbcQxxX6txKE
EOF
git push -u origin transport && gh pr create --base fpgas-online --fill && gh pr checks --watch
```

---

### Task 3: `WebSocketTransport`

**Files:**

- Create: `src/transport/WebSocketTransport.ts`, `src/transport/WebSocketTransport.spec.ts`

**Interfaces:**

- Produces: `class WebSocketTransport implements SerialTransport` with `constructor(url: string, opts?: { WebSocketImpl?: typeof WebSocket; openTimeoutMs?: number })`, `readonly ready: Promise<void>` (resolves on open, rejects on failure/timeout), `readonly closeInfo: { code: number; reason: string } | null`.
- Protocol: incoming **binary** frames → `readable` chunks (`Uint8Array`); incoming **text** frames → parsed as JSON → `'message'` CustomEvent (malformed JSON → `'error'` event, never thrown); `writable` chunks → `ws.send(chunk)` (writes before open wait for `ready`; writes after close reject with `Error('transport closed')`); socket close → `readable` controller closed, `writable` errored, `state='closed'`, `'close'` event (once), `closeInfo` set; socket error → `'error'` event then the close path.

- [ ] **Step 1: Write the failing tests**

`src/transport/WebSocketTransport.spec.ts`:

```ts
import { describe, expect, test, vi } from 'vitest';
import { WebSocketTransport } from './WebSocketTransport';

/** Minimal scripted WebSocket double (no network). */
class FakeWebSocket extends EventTarget {
  static instances: FakeWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = FakeWebSocket.CONNECTING;
  binaryType = 'blob';
  sent: (string | ArrayBuffer | ArrayBufferView)[] = [];
  constructor(
    public url: string,
    public protocols?: string | string[],
  ) {
    super();
    FakeWebSocket.instances.push(this);
  }
  send(data: string | ArrayBuffer | ArrayBufferView) {
    this.sent.push(data);
  }
  close(code = 1000, reason = '') {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent('close', { code, reason, wasClean: true }));
  }
  // test helpers
  serverOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }
  serverBinary(bytes: Uint8Array) {
    this.dispatchEvent(
      new MessageEvent('message', {
        data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      }),
    );
  }
  serverText(text: string) {
    this.dispatchEvent(new MessageEvent('message', { data: text }));
  }
  serverClose(code: number, reason: string) {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent('close', { code, reason, wasClean: true }));
  }
}

function make() {
  FakeWebSocket.instances = [];
  const t = new WebSocketTransport('ws://example/serial', {
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
  });
  return { t, ws: FakeWebSocket.instances[0] };
}

describe('WebSocketTransport', () => {
  test('starts connecting, sets binaryType, opens on socket open', async () => {
    const { t, ws } = make();
    expect(t.state).toBe('connecting');
    expect(ws.binaryType).toBe('arraybuffer');
    const onOpen = vi.fn();
    t.addEventListener('open', onOpen);
    ws.serverOpen();
    await t.ready;
    expect(t.state).toBe('open');
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  test('binary frames appear on readable as Uint8Array chunks', async () => {
    const { t, ws } = make();
    ws.serverOpen();
    await t.ready;
    const reader = t.readable.getReader();
    ws.serverBinary(new Uint8Array([0x3e, 0x3e, 0x3e, 0x20]));
    const { value } = await reader.read();
    expect(Array.from(value!)).toEqual([0x3e, 0x3e, 0x3e, 0x20]);
    reader.releaseLock();
  });

  test('text frames become message events, not readable bytes', async () => {
    const { t, ws } = make();
    ws.serverOpen();
    await t.ready;
    const onMessage = vi.fn();
    t.addEventListener('message', onMessage);
    ws.serverText('{"event":"board","present":true,"device":"/dev/ttboard"}');
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect((onMessage.mock.calls[0][0] as CustomEvent).detail).toEqual({
      event: 'board',
      present: true,
      device: '/dev/ttboard',
    });
  });

  test('malformed text frame emits error event and does not throw', async () => {
    const { t, ws } = make();
    ws.serverOpen();
    await t.ready;
    const onError = vi.fn();
    t.addEventListener('error', onError);
    expect(() => ws.serverText('not json')).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  test('writable chunks are sent as binary; writes queued before open are flushed on open', async () => {
    const { t, ws } = make();
    const writer = t.writable.getWriter();
    const pending = writer.write(new Uint8Array([0x01]));
    expect(ws.sent).toHaveLength(0);
    ws.serverOpen();
    await t.ready;
    await pending;
    await writer.write(new Uint8Array([0x04]));
    expect(ws.sent).toHaveLength(2);
    expect(new Uint8Array(ws.sent[1] as ArrayBuffer)[0]).toBe(0x04);
    writer.releaseLock();
  });

  test('server close ends readable, errors writable, emits close once with closeInfo', async () => {
    const { t, ws } = make();
    ws.serverOpen();
    await t.ready;
    const onClose = vi.fn();
    t.addEventListener('close', onClose);
    const reader = t.readable.getReader();
    ws.serverClose(1011, 'board disconnected');
    const { done } = await reader.read();
    expect(done).toBe(true);
    expect(t.state).toBe('closed');
    expect(t.closeInfo).toEqual({ code: 1011, reason: 'board disconnected' });
    expect(onClose).toHaveBeenCalledTimes(1);
    await expect(t.writable.getWriter().write(new Uint8Array([1]))).rejects.toThrow(/closed/);
  });

  test('close() closes the socket and resolves; idempotent', async () => {
    const { t, ws } = make();
    ws.serverOpen();
    await t.ready;
    const onClose = vi.fn();
    t.addEventListener('close', onClose);
    await t.close();
    await t.close();
    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('open timeout rejects ready and closes', async () => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    const t = new WebSocketTransport('ws://example/serial', {
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      openTimeoutMs: 50,
    });
    const rejection = expect(t.ready).rejects.toThrow(/timeout/);
    vi.advanceTimersByTime(60);
    await rejection;
    expect(t.state).toBe('closed');
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/transport/WebSocketTransport.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `WebSocketTransport`**

`src/transport/WebSocketTransport.ts`:

```ts
// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026, fpgas.online contributors

import {
  transportErrorEvent,
  transportMessageEvent,
  type SerialTransport,
  type TransportState,
} from './SerialTransport';

export interface WebSocketTransportOptions {
  /** Injectable for tests; defaults to the global WebSocket. */
  WebSocketImpl?: typeof WebSocket;
  /** Reject `ready` if the socket is not open within this many ms (default 10_000). */
  openTimeoutMs?: number;
}

/**
 * Single-shot WebSocket carrier for the Pi daemon's `WS /serial`:
 * binary frames are board bytes (both directions); server text frames are
 * JSON events surfaced as 'message' CustomEvents. When the socket closes the
 * readable ends, the writable errors, and 'close' fires once — reconnection is
 * the caller's job (see EmbedApp), which keeps TTBoardDevice oblivious.
 */
export class WebSocketTransport extends EventTarget implements SerialTransport {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
  readonly ready: Promise<void>;
  closeInfo: { code: number; reason: string } | null = null;

  private _state: TransportState = 'connecting';
  private readonly ws: WebSocket;
  private readableController!: ReadableStreamDefaultController<Uint8Array>;
  private resolveReady!: () => void;
  private rejectReady!: (err: Error) => void;
  private openTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    readonly url: string,
    opts: WebSocketTransportOptions = {},
  ) {
    super();
    const Impl = opts.WebSocketImpl ?? WebSocket;
    const openTimeoutMs = opts.openTimeoutMs ?? 10_000;

    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    // Avoid unhandled-rejection noise when nobody awaits `ready`; callers that
    // care still see the rejection.
    this.ready.catch(() => {});

    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.readableController = controller;
      },
    });

    this.writable = new WritableStream<Uint8Array>({
      write: async (chunk) => {
        if (this._state === 'connecting') {
          await this.ready;
        }
        if (this._state !== 'open') {
          throw new Error('transport closed');
        }
        this.ws.send(chunk);
      },
      close: async () => {
        await this.close();
      },
      abort: async () => {
        await this.close();
      },
    });

    this.ws = new Impl(url);
    this.ws.binaryType = 'arraybuffer';
    this.ws.addEventListener('open', () => this.onOpen());
    this.ws.addEventListener('message', (ev) => this.onMessage(ev as MessageEvent));
    this.ws.addEventListener('error', () => {
      this.dispatchEvent(transportErrorEvent('websocket error'));
    });
    this.ws.addEventListener('close', (ev) =>
      this.onClose((ev as CloseEvent).code, (ev as CloseEvent).reason),
    );

    this.openTimer = setTimeout(() => {
      if (this._state === 'connecting') {
        this.rejectReady(new Error(`websocket open timeout after ${openTimeoutMs} ms`));
        this.dispatchEvent(transportErrorEvent('websocket open timeout'));
        this.ws.close();
        this.onClose(4000, 'open timeout');
      }
    }, openTimeoutMs);
  }

  get state(): TransportState {
    return this._state;
  }

  private onOpen() {
    if (this._state !== 'connecting') {
      return;
    }
    this.clearOpenTimer();
    this._state = 'open';
    this.resolveReady();
    this.dispatchEvent(new Event('open'));
  }

  private onMessage(ev: MessageEvent) {
    const data: unknown = ev.data;
    if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data) as Record<string, unknown>;
        this.dispatchEvent(transportMessageEvent(parsed));
      } catch {
        this.dispatchEvent(transportErrorEvent(`malformed event frame: ${data.slice(0, 80)}`));
      }
      return;
    }
    if (data instanceof ArrayBuffer) {
      this.readableController.enqueue(new Uint8Array(data));
      return;
    }
    if (ArrayBuffer.isView(data)) {
      this.readableController.enqueue(
        new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      );
      return;
    }
    this.dispatchEvent(transportErrorEvent('unexpected frame type'));
  }

  private onClose(code: number, reason: string) {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.clearOpenTimer();
    const wasConnecting = this._state === 'connecting';
    this._state = 'closed';
    this.closeInfo = { code, reason };
    if (wasConnecting) {
      this.rejectReady(new Error(`websocket closed before open (${code} ${reason})`));
    }
    try {
      this.readableController.close();
    } catch {
      /* already closed */
    }
    this.dispatchEvent(new Event('close'));
  }

  private clearOpenTimer() {
    if (this.openTimer) {
      clearTimeout(this.openTimer);
      this.openTimer = null;
    }
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close(1000, 'client close');
    }
    // The socket's close event drives onClose(); if the implementation closes
    // synchronously (tests) we are already done, otherwise make sure state flips.
    if (!this.closed) {
      this.onClose(1000, 'client close');
    }
  }
}
```

Note for the implementer: `WebSocket.OPEN` in `close()` must tolerate the injected fake — use `this.ws.readyState === 1 || this.ws.readyState === 0` literals if `WebSocket` is not defined in the test environment, or compare against `(this.ws.constructor as typeof WebSocket).OPEN`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/transport && npm run typecheck && npm run lint`
Expected: all pass. If jsdom lacks `CloseEvent`/`MessageEvent` constructors in your vitest environment, add `environment: 'jsdom'` to `vite.config.js` (`test: { environment: 'jsdom' }`) — jsdom is already a devDependency; if `CloseEvent` is still missing under jsdom, polyfill it in the spec file only (`class CloseEvent extends Event { code; reason; wasClean; constructor(type, init) {...} }`), never in `src/`.

- [ ] **Step 5: Commit, PR, CI**

```bash
git worktree add .worktrees/ws-transport -b ws-transport fpgas-online
git add src/transport/WebSocketTransport.ts src/transport/WebSocketTransport.spec.ts vite.config.js
git commit -F - <<'EOF'
feat(transport): WebSocketTransport for the Pi daemon serial bridge

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UdRpsg6jY8PbcQxxX6txKE
EOF
git push -u origin ws-transport && gh pr create --base fpgas-online --fill && gh pr checks --watch
```

---

### Task 4: Embeddable build — `mountCommander`, `EmbedApp`, `BoardCommander` props, Vite lib config

**Files:**

- Create: `src/embed.tsx`, `src/components/EmbedApp.tsx`, `src/components/EmbedApp.spec.tsx`, `src/model/board.ts`, `vite.embed.config.js`
- Modify: `src/components/BoardCommander.tsx` (props `embedded?: boolean`, `admin?: boolean`), `src/components/FirmwareUpgradeRequired.tsx` (no change needed — EmbedApp renders a banner instead), `package.json` (`build:embed` exists from Task 1), `.github/workflows/ci.yml` (add embed build + artifact)

**Interfaces:**

- Consumes: `WebSocketTransport` (Task 3), `WebSerialTransport` (Task 2), `TTBoardDevice(transport)`.
- Produces: `mountCommander(el, opts)` per Global Constraints; `boardInfo` store (`src/model/board.ts`: `createStore({ slug: '', kind: 'asic' as BoardKind, shuttle: undefined as string | undefined, apiBase: undefined as string | undefined })` + `setBoardInfo`), used by later phases; `BoardCommander` props `embedded` (hides Disconnect → shows "Reconnect"; hides "Reset to Bootloader" unless `admin`) and `admin`.

- [ ] **Step 1: `src/model/board.ts`**

```ts
// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026, fpgas.online contributors

import { createStore } from 'solid-js/store';

export type BoardKind = 'asic' | 'kianv' | 'fpga';

export interface BoardInfo {
  slug: string;
  kind: BoardKind;
  shuttle?: string;
  apiBase?: string;
}

/** Which board this Commander instance is driving (embedded mode). Later phases read kind/apiBase. */
export const [boardInfo, setBoardInfo] = createStore<BoardInfo>({ slug: '', kind: 'asic' });
```

- [ ] **Step 2: `BoardCommander` props (minimal seam)**

In `src/components/BoardCommander.tsx`:

- `export interface IBreakoutControlProps { device: TTBoardDevice; embedded?: boolean; admin?: boolean; }`
- The Disconnect button: label `props.embedded ? 'Reconnect' : 'Disconnect'` (same `onClick` — `device.close()`; in embed the close event triggers the reconnect loop).
- Wrap the `Reset to Bootloader` `<Stack>` in `<Show when={!props.embedded || props.admin}>`.
  Nothing else changes in this file.

- [ ] **Step 3: Write the failing embed smoke test**

`src/components/EmbedApp.spec.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { mountCommander } from '~/embed';

describe('mountCommander', () => {
  test('mounts into the element, shows connecting state, and unmounts cleanly', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    // A URL nothing listens on: we only assert the initial render + teardown.
    const handle = mountCommander(el, {
      transport: { kind: 'websocket', url: 'ws://127.0.0.1:9/serial' },
      board: { slug: 'tt06', kind: 'asic', shuttle: 'tt06' },
    });
    expect(el.textContent).toMatch(/connecting/i);
    handle.unmount();
    expect(el.childElementCount).toBe(0);
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npx vitest run src/components/EmbedApp.spec.tsx`
Expected: FAIL — `~/embed` not found.

- [ ] **Step 5: Implement `EmbedApp` and `embed.tsx`**

`src/components/EmbedApp.tsx`:

```tsx
// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026, fpgas.online contributors

import { Warning } from '@suid/icons-material';
import {
  Alert,
  Button,
  CssBaseline,
  Paper,
  Stack,
  ThemeProvider,
  Typography,
} from '@suid/material';
import { Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { compareVersions, minimumFirmwareVersion } from '~/model/firmware';
import { BoardCommander } from '~/components/BoardCommander';
import { Footer } from '~/components/Footer';
import { Header } from '~/components/Header';
import { setBoardInfo, type BoardInfo } from '~/model/board';
import type { SerialTransport } from '~/transport/SerialTransport';
import { WebSerialTransport } from '~/transport/WebSerialTransport';
import { WebSocketTransport } from '~/transport/WebSocketTransport';
import { TTBoardDevice } from '~/ttcontrol/TTBoardDevice';
import { theme } from '~/utils/theme';

export interface EmbedOptions {
  transport: { kind: 'websocket'; url: string } | { kind: 'webserial' };
  board: BoardInfo;
  apiBase?: string;
  chrome?: { header: boolean; footer: boolean };
  admin?: boolean;
  reconnect?: { minDelayMs: number; maxDelayMs: number };
}

type ConnState =
  | { phase: 'connecting'; attempt: number }
  | { phase: 'connected' }
  | { phase: 'waiting'; attempt: number; retryInMs: number; reason: string }
  | { phase: 'idle' };

export function EmbedApp(props: { options: EmbedOptions }) {
  const reconnect = () => props.options.reconnect ?? { minDelayMs: 1000, maxDelayMs: 30000 };
  const [device, setDevice] = createSignal<TTBoardDevice | null>(null);
  const [conn, setConn] = createSignal<ConnState>({ phase: 'idle' });
  const [boardPresent, setBoardPresent] = createSignal<boolean | null>(null);
  const [firmwareOutdated, setFirmwareOutdated] = createSignal<string | null>(null);
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  setBoardInfo({ ...props.options.board, apiBase: props.options.apiBase });

  const delayFor = (n: number) => {
    const { minDelayMs, maxDelayMs } = reconnect();
    return Math.min(maxDelayMs, minDelayMs * 2 ** Math.max(0, n - 1));
  };

  const scheduleReconnect = (reason: string) => {
    if (disposed) return;
    attempt += 1;
    const retryInMs = delayFor(attempt);
    setConn({ phase: 'waiting', attempt, retryInMs, reason });
    retryTimer = setTimeout(() => void connect(), retryInMs);
  };

  const makeTransport = async (): Promise<SerialTransport> => {
    const t = props.options.transport;
    if (t.kind === 'websocket') {
      const ws = new WebSocketTransport(t.url);
      ws.addEventListener('message', (ev) => {
        const detail = (ev as CustomEvent<Record<string, unknown>>).detail;
        if (detail.event === 'board') setBoardPresent(Boolean(detail.present));
      });
      await ws.ready;
      return ws;
    }
    const port = await navigator.serial.requestPort({
      filters: [{ usbVendorId: 0x2e8a, usbProductId: 0x0005 }],
    });
    await port.open({ baudRate: 115200 });
    return new WebSerialTransport(port);
  };

  const connect = async () => {
    if (disposed) return;
    setConn({ phase: 'connecting', attempt });
    try {
      const transport = await makeTransport();
      const dev = new TTBoardDevice(transport);
      dev.addEventListener('close', () => {
        setDevice(null);
        const info = (transport as WebSocketTransport).closeInfo;
        scheduleReconnect(info ? `${info.code} ${info.reason}` : 'connection closed');
      });
      setDevice(dev);
      setConn({ phase: 'connected' });
      attempt = 0;
      void dev.start();
    } catch (e) {
      scheduleReconnect((e as Error).message);
    }
  };

  const reconnectNow = () => {
    if (retryTimer) clearTimeout(retryTimer);
    attempt = 0;
    void device()?.close();
    if (!device()) void connect();
  };

  onMount(() => void connect());
  onCleanup(() => {
    disposed = true;
    if (retryTimer) clearTimeout(retryTimer);
    void device()?.close();
  });

  createEffect(() => {
    const v = device()?.data.version;
    if (!v) return setFirmwareOutdated(null);
    try {
      setFirmwareOutdated(compareVersions(v, minimumFirmwareVersion) < 0 ? v : null);
    } catch {
      setFirmwareOutdated(v);
    }
  });

  const chrome = () => props.options.chrome ?? { header: false, footer: false };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline enableColorScheme />
      <Stack component="section" width="100%">
        <Show when={chrome().header}>
          <Header />
        </Show>

        <Show when={conn().phase !== 'connected'}>
          <Alert severity={conn().phase === 'waiting' ? 'warning' : 'info'} sx={{ my: 1 }}>
            <Show when={conn().phase === 'connecting'}>Connecting to the board…</Show>
            <Show when={conn().phase === 'waiting'}>
              {(() => {
                const c = conn() as Extract<ConnState, { phase: 'waiting' }>;
                return `Disconnected (${c.reason}). Retrying in ${Math.round(c.retryInMs / 1000)} s (attempt ${c.attempt}).`;
              })()}
              <Button size="small" onClick={reconnectNow} sx={{ ml: 1 }}>
                Retry now
              </Button>
            </Show>
          </Alert>
        </Show>

        <Show when={boardPresent() === false}>
          <Alert severity="error" sx={{ my: 1 }} icon={<Warning />}>
            The Pi is reachable but no Tiny Tapeout board is detected on it. Try "Power-cycle board"
            on the page.
          </Alert>
        </Show>

        <Show when={firmwareOutdated()}>
          {(v) => (
            <Paper sx={{ bgcolor: 'warning.light', p: 2, my: 1 }}>
              <Typography variant="body2">
                This board runs demo-board firmware {v()}, older than the {minimumFirmwareVersion}{' '}
                this app expects; some features may not work. The fpgas.online maintainers upgrade
                firmware — it cannot be done remotely.
              </Typography>
            </Paper>
          )}
        </Show>

        <Show when={device()}>
          {(dev) => <BoardCommander device={dev()} embedded admin={props.options.admin ?? false} />}
        </Show>

        <Show when={chrome().footer}>
          <Footer />
        </Show>
      </Stack>
    </ThemeProvider>
  );
}
```

`src/embed.tsx`:

```tsx
// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026, fpgas.online contributors

import { render } from 'solid-js/web';
import { EmbedApp, type EmbedOptions } from '~/components/EmbedApp';
import '@xterm/xterm/css/xterm.css';

export type { EmbedOptions };

export function mountCommander(el: HTMLElement, opts: EmbedOptions): { unmount(): void } {
  const dispose = render(() => <EmbedApp options={opts} />, el);
  return {
    unmount() {
      dispose();
      el.replaceChildren();
    },
  };
}
```

- [ ] **Step 6: Vite library config and CI**

`vite.embed.config.js`:

```js
import suidPlugin from '@suid/vite-plugin';
import child from 'child_process';
import path from 'path';
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

const commitHash = child.execSync('git rev-parse --short HEAD').toString().trim();

export default defineConfig({
  plugins: [suidPlugin(), solidPlugin()],
  resolve: { alias: { '~': path.resolve(__dirname, './src') } },
  define: {
    __COMMIT_HASH__: JSON.stringify(commitHash),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    outDir: 'dist/embed',
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: path.resolve(__dirname, 'src/embed.tsx'),
      name: 'TTCommander',
      formats: ['es'],
      fileName: () => 'tt-commander-embed.js',
    },
    rollupOptions: {
      output: { assetFileNames: 'tt-commander-embed.[ext]' },
    },
  },
});
```

`ci.yml`: append `- run: npm run build:embed` and

```yaml
- uses: actions/upload-artifact@v4
  with:
    name: tt-commander-embed
    path: dist/embed/
```

- [ ] **Step 7: Run everything**

Run: `npx vitest run && npm run typecheck && npm run lint && npm run build && npm run build:embed && ls -la dist/embed`
Expected: tests pass (incl. the embed smoke test), both builds succeed, `dist/embed/tt-commander-embed.js` and `tt-commander-embed.css` exist, the JS contains no `import` of bare package names (`grep -c "from \"solid-js\"" dist/embed/tt-commander-embed.js` → 0). If `@suid` or `xterm` CSS is missing from the `.css`, check that `ReplPanel`'s `import '@xterm/xterm/css/xterm.css'` is reached by the entry (it is, via BoardCommander) — otherwise the explicit import in `embed.tsx` covers it.

Manual check (recommended, not blocking): `npm start`-style local page that imports `dist/embed/tt-commander-embed.js`, mounts with `transport: {kind:'websocket', url:'ws://localhost:8765/serial'}` against the Pi daemon running on a pty (`uv run fpgas-tt --device /dev/pts/N …` from `fpgas.online-tt`) — the banner shows "Connecting…" then the Commander UI with the board status from the `board` event.

- [ ] **Step 8: Commit, PR, CI**

```bash
git worktree add .worktrees/embed -b embed fpgas-online
npx prettier --write src/embed.tsx src/components/EmbedApp.tsx src/components/EmbedApp.spec.tsx src/model/board.ts src/components/BoardCommander.tsx vite.embed.config.js
git add src/embed.tsx src/components/EmbedApp.tsx src/components/EmbedApp.spec.tsx src/model/board.ts src/components/BoardCommander.tsx vite.embed.config.js .github/workflows/ci.yml
git commit -F - <<'EOF'
feat(embed): mountCommander() embeddable build with reconnecting WebSocket transport

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UdRpsg6jY8PbcQxxX6txKE
EOF
git push -u origin embed && gh pr create --base fpgas-online --fill && gh pr checks --watch
```

---

### Task 5: Release workflow + fork README

**Files:**

- Create: `.github/workflows/release-embed.yml`, `README.fpgas-online.md`
- Modify: `README.md` (one paragraph at the top pointing to `README.fpgas-online.md` — keep upstream text intact below it)

**Interfaces:**

- Produces: on tag `embed-v<semver>`, a GitHub Release with asset `tt-commander-embed-<semver>.tar.gz` containing `tt-commander-embed.js`, `tt-commander-embed.css`, `VERSION` (semver + commit). Plan D's Ansible role downloads this asset by version + sha256.

- [ ] **Step 1: Workflow**

`.github/workflows/release-embed.yml`:

```yaml
name: Release embed bundle

on:
  push:
    tags: ['embed-v*']
  workflow_dispatch:

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v6
        with:
          node-version: '24'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint && npm run typecheck && npx vitest run
      - run: npm run build:embed
      - name: Package
        run: |
          VERSION="${GITHUB_REF_NAME#embed-v}"
          echo "${VERSION} $(git rev-parse --short HEAD)" > dist/embed/VERSION
          tar -C dist/embed -czf "tt-commander-embed-${VERSION}.tar.gz" tt-commander-embed.js tt-commander-embed.css VERSION
          sha256sum "tt-commander-embed-${VERSION}.tar.gz" > "tt-commander-embed-${VERSION}.tar.gz.sha256"
      - name: GitHub Release
        if: startsWith(github.ref, 'refs/tags/embed-v')
        uses: softprops/action-gh-release@v2
        with:
          files: |
            tt-commander-embed-*.tar.gz
            tt-commander-embed-*.tar.gz.sha256
```

- [ ] **Step 2: `README.fpgas-online.md`**

````markdown
# tt-commander-app — fpgas.online fork

This fork lets the [Tiny Tapeout Commander](https://github.com/TinyTapeout/tt-commander-app) drive a
demo board that is plugged into a Raspberry Pi at [tinytapeout.fpgas.online](https://tinytapeout.fpgas.online),
over a WebSocket bridge, instead of a board on your own USB port. Upstream behaviour (WebSerial) is unchanged.

## Embedding

```html
<link rel="stylesheet" href="/static/tt-commander/0.1.0/tt-commander-embed.css" />
<div id="tt-commander"></div>
<script type="module">
  import { mountCommander } from '/static/tt-commander/0.1.0/tt-commander-embed.js';
  mountCommander(document.getElementById('tt-commander'), {
    transport: { kind: 'websocket', url: `wss://${location.host}/ws/board/tt06/serial` },
    board: { slug: 'tt06', kind: 'asic', shuttle: 'tt06' },
    apiBase: '/api/board/tt06',
  });
</script>
```

The page must provide the Roboto font (the bundle does not fetch Google Fonts).

## Wire protocol (Pi daemon `fpgas-tt`, `WS /serial`)

- binary frames: board bytes, both directions (the MicroPython REPL);
- server → client text frames: JSON events, e.g. `{"event":"board","present":true,"device":"/dev/ttboard"}`,
  `{"event":"error","error":"board not present"}`;
- close codes: `1011 board disconnected`, `1008 client too slow`, `1001 server shutdown`.
  The embed reconnects with exponential back-off (1 s → 30 s) and re-runs the REPL bootstrap on each connection.

## Development

```bash
npm ci
npm run lint && npm run typecheck && npx vitest run
npm run build          # standalone app (upstream)
npm run build:embed    # dist/embed/tt-commander-embed.{js,css}
```

Branches: `main` mirrors upstream; `fpgas-online` is the default branch; PRs go there. See `CLAUDE.md`.

## Releases

Tag `embed-vX.Y.Z` on `fpgas-online` → GitHub Release with `tt-commander-embed-X.Y.Z.tar.gz` (+ `.sha256`),
consumed by `fpgas.online-infra`'s `ttsite` role.
````

`README.md`: prepend

```markdown
> **fpgas.online fork** — adds a WebSocket transport and an embeddable build for
> [tinytapeout.fpgas.online](https://tinytapeout.fpgas.online). See [README.fpgas-online.md](README.fpgas-online.md).
> Upstream README follows.
```

- [ ] **Step 3: Verify, commit, PR, CI**

Run: `npm run lint` (prettier check covers the YAML/MD if configured; at least the YAML must parse — `npx js-yaml .github/workflows/release-embed.yml >/dev/null` or `python3 -c 'import yaml,sys;yaml.safe_load(open(sys.argv[1]))' …` via `uv run`).

```bash
git worktree add .worktrees/release -b release fpgas-online
git add .github/workflows/release-embed.yml README.fpgas-online.md README.md
git commit -F - <<'EOF'
build: embed release workflow (tag embed-v*) and fork README

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UdRpsg6jY8PbcQxxX6txKE
EOF
git push -u origin release && gh pr create --base fpgas-online --fill && gh pr checks --watch
```

- [ ] **Step 4: Cut `embed-v0.1.0`** (after merge; no secret needed — uses `GITHUB_TOKEN`)

```bash
git checkout fpgas-online && git pull --ff-only
git tag -a embed-v0.1.0 -m "tt-commander-embed 0.1.0: WebSocket transport + embeddable build"
git push origin embed-v0.1.0
gh run watch --repo fpgas-online/tt-commander-app
gh release view embed-v0.1.0 --repo fpgas-online/tt-commander-app --json assets -q '.assets[].name'
```

Expected: the two assets listed.

---

## Self-review against the spec

- §4.1 transport abstraction: interface + WebSerial + WebSocket (Tasks 2–3); `TTBoardDevice` bootstrap untouched ✔. Reconnect lives in EmbedApp (Task 4) rather than inside the transport — a deliberate simplification: `pipeTo` locks a writable once, so a fresh transport+device per connection is the robust shape; surfaced state matches the spec ("reconnect with back-off surfacing state").
- §4.2 embed: `mountCommander`, library build, standalone unchanged, skip WebSerial check/Connect button, "Reconnect" label, bootloader hidden unless admin, firmware-upgrade → informational banner ✔ (Task 4). Release asset (Task 5) ✔.
- §4.3 kind-aware: **out of scope (phases 2–3)**; only `boardInfo` store lands so later work has the hook.
- §4.4 multi-viewer: nothing to build; documented in README ✔.
- §4.5 CI: lint/test/both builds, release on tag ✔ (Tasks 1, 4, 5).
- Placeholder scan: none. Types consistent: `SerialTransport` (Task 2) is what `WebSocketTransport` (3), `TTBoardDevice` (2) and `EmbedApp` (4) use; `EmbedOptions.board` is `BoardInfo` (4); `closeInfo` used by EmbedApp exists on `WebSocketTransport` ✔.

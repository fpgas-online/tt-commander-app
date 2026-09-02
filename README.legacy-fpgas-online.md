# tt-commander-app `legacy` — fpgas.online port

This branch (`legacy-fpgas-online`) is the fpgas.online port of upstream's
**`legacy`** branch — the SDK-agnostic Commander that upstream deploys at
legacy.commander.tinytapeout.com for boards whose chips predate TT SDK 2.x.
It exists for one board: the Welland **tt03p5** (pi-sw2-p3), whose chip only
works on demo-board firmware **v1.2.2** (the last release supporting that
shuttle). See fpgas-online/tt-commander-app#9 for the history.

Unlike the `fpgas-online` branch (ported from `main`), this app has **no
firmware minimum**: its `src/ttcontrol/ttcontrol.py` bit-bangs the demo
board's mux-control pins from the RP2040 GPIOs directly, reads the chip ID
via the 7-segment magic values, and falls back to `rom_fallback.txt` for
shuttle identification. That is what makes it safe for 1.x-firmware boards.

## Branch model

| Branch                | Role                                                          |
| --------------------- | ------------------------------------------------------------- |
| `main`                | mirror of upstream `main` — never commit                      |
| `fpgas-online`        | default branch; port of `main` (embed used for tt04+, fpga-N) |
| `legacy`              | mirror of upstream `legacy` — never commit                    |
| `legacy-fpgas-online` | this port; all changes land via PRs into it                   |

Create PRs with `-R fpgas-online/tt-commander-app --base legacy-fpgas-online`
— never let `gh` default to the upstream repo. **Never push, open PRs, file
issues, or comment on `TinyTapeout/tt-commander-app`**; keep the `upstream`
remote's push URL disabled.

## What the port adds

- `src/transport/` — the `SerialTransport` seam plus `WebSerialTransport`
  (standalone app) and `WebSocketTransport` (Pi daemon bridge: binary frames
  are board bytes, text frames are JSON events), copied from the
  `fpgas-online` branch.
- `src/embed.tsx` + `src/components/EmbedApp.tsx` — `mountCommander(el, opts)`
  embeddable build with the `fpgas-online` branch's reconnect machinery
  (back-off, carrier teardown on every path — issue #7) and **without** the
  firmware-version gate.
- CI (`.github/workflows/ci.yml`) and a release workflow that publishes
  `tt-commander-legacy-embed-<version>.tar.gz` (+ `.sha256`) from tags
  `legacy-embed-v*`. The tarball's inner filenames stay
  `tt-commander-embed.{js,css}` so the site's loader is uniform; the version
  directory it is unpacked into is what distinguishes legacy from main.

## Embed options

```ts
mountCommander(el, {
  transport: { kind: 'websocket', url: 'wss://…/ws/board/tt03p5/serial' },
  chrome: { header: false, footer: false }, // optional, default off
  admin: false, // optional, default off
  reconnect: { minDelayMs: 1000, maxDelayMs: 30000 }, // optional
});
```

No `board`/`apiBase` options (unlike the main embed): the legacy embed is
ASIC-only and learns everything from the board's REPL.

`admin: false` hides **Disconnect** and **Reset to Bootloader**. Keep it off
on public pages: the bootloader takes the RP2040 offline until a human
intervenes, and a tt03p5 board must **never** be offered a firmware update —
2.x firmware does not support its shuttle and would brick the deployment.
This app has no update flow today; do not add one to embedded mode.

## Development

```sh
npm ci
npm test -- --run   # vitest
npm run typecheck
npm run build        # standalone app
npm run build:embed  # dist/embed/tt-commander-embed.{js,css}
```

There is no `npm run lint` on this branch (upstream's eslint 6 setup predates
the flat-config wrapper the `fpgas-online` branch uses); lint-staged still
runs eslint + prettier on staged files at commit time.

Test doubles must honour the `SerialTransport` contract: when a carrier dies,
its `state` becomes `'closed'` as the streams error (as `WebSocketTransport`
does). A fake that errors its readable while still claiming `state: 'open'`
sends `TTBoardDevice.run()`'s re-pipe loop into a busy spin.

## Releases

- (none yet — first release once the site integration is ready to consume it)

# tt-commander-app — fpgas.online fork

This fork lets the [Tiny Tapeout Commander](https://github.com/TinyTapeout/tt-commander-app) drive a
demo board that is plugged into a Raspberry Pi at [tinytapeout.fpgas.online](https://tinytapeout.fpgas.online),
over a WebSocket bridge, instead of a board on your own USB port. Upstream behaviour (WebSerial) is unchanged.

## Embedding

```html
<link rel="stylesheet" href="/static/tt-commander/0.2.0/tt-commander-embed.css" />
<div id="tt-commander"></div>
<script type="module">
  import { mountCommander } from '/static/tt-commander/0.2.0/tt-commander-embed.js';
  mountCommander(document.getElementById('tt-commander'), {
    transport: { kind: 'websocket', url: `wss://${location.host}/ws/board/tt06/serial` },
    board: { slug: 'tt06', kind: 'asic', shuttle: 'tt06' },
    apiBase: '/api/board/tt06',
  });
</script>
```

`mountCommander(el, opts)` returns `{ unmount, refreshDesigns }`:

- `unmount()` — tears the widget down and clears the mount point.
- `refreshDesigns()` — re-fetches the FPGA daemon's design list (`GET ${apiBase}/designs`) into
  the running widget. Call it after an upload completes elsewhere on the host page (e.g. a
  separate "upload design" form), so the project dropdown and pinout tab pick up the new design
  without a full remount. A no-op that resolves immediately for non-`fpga` boards.

Options:

| option      | meaning                                                                                                                                                                                                                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `transport` | `{ kind: 'websocket', url }` — the daemon's `WS /serial`. **WebSocket-only**: WebSerial needs a user gesture per page load, which an embedded widget cannot promise, so the standalone app keeps that job. `WebSocketImpl` may be set to a `WebSocket` double **in tests only** (see `src/transport/testing/FakeWebSocket.ts`). |
| `board`     | `{ slug, kind, shuttle? }` — board identity (`apiBase` is its own option, not part of this). `kind` is `'asic'` or `'fpga'` (`'kianv'` is phase 3, not yet implemented).                                                                                                                                                        |
| `apiBase`   | e.g. `/api/board/<slug>`; required for `kind` `fpga`/`kianv`.                                                                                                                                                                                                                                                                   |
| `chrome`    | `{ header, footer }`, both default `false` when embedded.                                                                                                                                                                                                                                                                       |
| `admin`     | shows maintenance controls (Reset to Bootloader); default `false`.                                                                                                                                                                                                                                                              |
| `csrfToken` | `() => string` returning the host page's CSRF token; sent as `X-CSRFToken` on every non-GET request (enabling a design, loading a library design). Called per request. Unset: no header.                                                                                                                                        |
| `reconnect` | `{ minDelayMs, maxDelayMs }`; defaults 1 s / 30 s.                                                                                                                                                                                                                                                                              |

### What the embed does and does not do to your page

- **It does not inject global styles.** There is no CSS reset: the host page owns `body`,
  typography and colours. The widget scopes what it needs (border-box, the theme font) to its
  own root element, so give the mount point whatever width and spacing your layout wants.
- The page must provide the Roboto font (the bundle does not fetch Google Fonts).
- `tt-commander-embed.js.map` ships alongside the bundle; serve it next to the `.js` if you
  want readable stack traces.

### Multi-viewer

The daemon fans the board's bytes out to everyone connected, so **everyone connected sees and
can drive the same REPL** — one viewer's `select_design()` changes what every other viewer sees.
The Commander already tolerates unsolicited `tt.*=` lines, so state converges instead of
fighting. Nothing arbitrates access; the host page should say so, e.g. "other people may be
driving this board too".

Mount **one widget per page**: the board, shuttle and design stores are module-global, so a
second `mountCommander(...)` on the same page shares them with the first and the two will
fight over the selected design.

## The `fpga` kind

Boards with `board.kind === 'fpga'` (Tiny Tapeout FPGA emulation boards, driven by a MicroPython
REPL over the same `WS /serial` bridge as `asic`) get a different Config-tab flow, backed by the
daemon's REST endpoints instead of the TinyTapeout shuttle index:

- **Project list**: `GET ${apiBase}/designs`, replacing the ASIC's shuttle-index project
  dropdown. Fetched on mount (so the tab is usable even while the board's REPL is silent),
  again on the ROM's `shuttle=` line — i.e. on every connect and reconnect — and on
  `refreshDesigns()`. There is no mux `Index`/`Subtile` field for `fpga` boards: the daemon
  addresses designs by name, and a design's index is only its position in that list, so the
  selection is re-derived from the daemon's `enabled` name after every load (the REPL's
  `tt.design=` lines report the ASIC mux and are ignored on `fpga` boards). A failure to load
  the list is shown in the Config tab with a **Retry** button.
- **Load design**: the "Load design" button (labelled "Select" on `asic` boards) issues
  `POST ${apiBase}/designs/<name>/enable`. A rejection from the daemon — or a network failure —
  is shown as a dismissible error `Alert` in the Config tab (`props.device.data.designError`),
  the same place ASIC danger-level warnings appear. The button stays busy until the daemon
  answers, so a slow reprogram cannot be fired twice.
- **Project links**: the design's own `docs_url` / `repo_url` from the daemon, each shown only
  when it is non-empty. No `tinytapeout.com/chips/…` page and no feedback form exist for an
  FPGA design, so neither is linked.
- **Pinout tab**: renders directly from the selected design's metadata (`pinout.ui_in` /
  `uo_out` / `uio` from the `/designs` response), with no network fetch to
  `index.tinytapeout.com`. It re-derives whenever the selected design changes or `refreshDesigns()`
  updates the design list, so switching projects or uploading a new one updates the tab live.

### The VGA library source

A third source of designs beside the board's demos and uploads: prebuilt iCE40UP5K bitstreams of
Tiny Tapeout VGA designs, published in the
[VGA archive](https://data.wafer.space/big-storage/tinytapeout-vga-videos/) as
`fpga-library.json` (schema 1). The design spec is
[`docs/superpowers/specs/2026-11-26-fpga-library-source-design.md`](https://github.com/mithro/tinytapeout-vga-videos/blob/main/docs/superpowers/specs/2026-11-26-fpga-library-source-design.md)
in tinytapeout-vga-videos, section 4.

| Route                          | Method | Served by | Used for                                                        |
| ------------------------------ | ------ | --------- | --------------------------------------------------------------- |
| `${apiBase}/designs`           | GET    | daemon    | a top-level `library` key means the daemon supports the library |
| `${apiBase}/library`           | GET    | site      | the normalised index, the only source of library metadata       |
| `${apiBase}/library/<id>/load` | POST   | site      | load one library design (body `{}`)                             |

- **When**: the index is fetched only when `/designs` carries the top-level `library` key, and is
  kept until a load says the id is gone. A 404 `VGA library not published` shows "The VGA library
  is not published yet."; any other failure shows the error with a **Retry** button. The board's
  own designs are listed as soon as `/designs` answers and the index is merged in when it
  arrives, so a slow or failing index never hides them. Concurrent loads share one index request.
- **The list**: the board's demos and uploads in the daemon's order, then every index entry in
  index order, then any library entry the Pi holds that the index does not list (under its name).
  Projects are keyed by (name, source), so a library entry and an upload of the same name are two
  projects. A project's address is its position in this list (`mergeProjects`).
- **Selection**: the project whose name is `/designs`' `enabled` and whose source is what
  `/designs` reports for that name (a name the daemon lists twice resolves demo, then library,
  then upload); `library` when `/designs` does not list the name.
- **`/designs` entries**: a library design is listed in the upload shape (empty strings,
  `pinout: {}`, `clock_hz: null`) plus `source: "library"` and `size`. Its title, author, clock,
  pinout, description, links and badges all come from the index; the Pinout tab reads the index
  entry's `pinout` and `description`.
- **Picker**: search covers title, author, shuttle and macro (a library design's board name and
  its `tt_um_` macro). At most 100 VGA library matches are shown (`PROJECT_LIMIT`), with
  "showing 100 of N VGA library designs; type to narrow" under them; every ASIC project, demo and
  upload that matches is always shown. An upload whose name the board now resolves to a library
  design is shown disabled, marked "hidden by a VGA library design".
- **Load**: a library project calls the site's load route; every other project keeps
  `POST ${apiBase}/designs/<name>/enable`. After a library load the Commander runs `dump_state()`
  (the daemon drove `ui_in` pins behind the REPL), and shows `inputs set: 0x..`, held pins and a
  hidden upload in an info alert (`designNotice`, prefixed with the design's title, shown only
  while that design is selected and enabled). A 404 `no such library design` reloads the index.
  Errors go to `designError`; a `dump_state()` failure after a successful load is only logged.
- **Badges** (the site panel's texts, spec section 1): `timing: <fmax> MHz < <clock> MHz`,
  `timing not met on a secondary clock or path` and, when `pdk_latches` is true (Ruling BJ),
  `PDK latch cells: may not behave as on silicon` are
  warnings; `not hardware-validated`,
  `validated at MCU speed only`, `QSPI emulated`, `video: <verdict>` and `inputs set: 0x..`
  (only when `ui_in` is neither null nor 0) are info. A warning sets `danger_level: 'medium'`
  (the warning icon) with the badges joined by `; ` as the reason; `'high'` is never set, so Load
  is never disabled. Every badge is listed under the selector.

## Issue #7 — reconnect and firmware-version robustness

- The carrier (`WebSocketTransport`) is now always closed as part of every reconnect path, so a
  retry never finds the previous WebSocket still open. That covers both halves of the bug: the
  path that starts because `dev.close()`'s own teardown stalls (e.g. awaiting a REPL response
  that will never arrive once the carrier is already gone), where the carrier is closed
  synchronously in the `close` handler; and a failure _during_ `connect()` after the socket is
  already open, where the catch now closes the carrier and claims its teardown before scheduling
  the retry — otherwise the leaked socket's own `close` scheduled a second, competing retry.
- Firmware-version comparisons (`safeCompareVersions`) no longer throw on a version string they
  can't parse — the firmware reporting `unknown`, or an `fpga` board with no firmware version at
  all — treating it as `0.0.0` instead. The Config tab no longer crashes when it renders a board
  in that state.

## Wire protocol (Pi daemon `fpgas-tt`, `WS /serial`)

- binary frames: board bytes, both directions (the MicroPython REPL);
- server → client text frames: JSON events, e.g. `{"event":"board","present":true,"device":"/dev/ttboard"}`,
  `{"event":"error","error":"board not present"}`;
- close codes: `1011 board disconnected`, `1008 client too slow`, `1001 server shutdown`.

### Reconnection

On close the embed shows the close code and reason, tears the old device and its streams down,
and retries with exponential back-off: `minDelayMs * 2 ** (attempt - 1)`, capped at `maxDelayMs`,
with ±20 % jitter so a roomful of viewers does not stampede a daemon that just came back
(`src/model/backoff.ts`). The attempt counter only resets after a connection that stayed up for
10 s, so a board that flaps open/closed backs off instead of retrying every second. "Retry now"
in the banner reconnects immediately. Each new connection re-runs the REPL bootstrap and clears
the previous board-presence state; daemon `{"event":"error",...}` frames and carrier errors are
shown in a dismissible alert.

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
consumed by `fpgas.online-infra`'s `ttsite` role. A manual `workflow_dispatch` run of the same
workflow builds `0.0.0-dev.<sha>` and uploads it as the `tt-commander-embed-dev` artifact instead
of publishing a release.

### 0.3.0

- The VGA library as a third design source on `fpga` boards: `GET ${apiBase}/library`, loads
  through `POST ${apiBase}/library/<id>/load`, merged project list keyed by (name, source),
  badges, index-driven pinout, search by shuttle and macro, and a 100-option cap in the picker.

### 0.2.1

- `csrfToken` option: `X-CSRFToken` on every non-GET request.

### 0.2.0

- The `fpga` kind: project list from `${apiBase}/designs`, "Load design" via
  `POST ${apiBase}/designs/<name>/enable`, and a pinout tab driven by design metadata instead of
  the TinyTapeout shuttle index.
- `mountCommander(...)` handle grows `refreshDesigns()`, for the host page to call after an
  upload elsewhere on the page.
- Issue #7: the carrier is now closed on every reconnect path before the retry — including a
  failure during `connect()` itself — and unparseable firmware versions no longer crash the
  Config tab.

### 0.1.0

- Initial fork: `SerialTransport` seam, `WebSocketTransport` bridge to the Pi daemon, and the
  `mountCommander(el, opts)` embeddable build (`asic` boards only).

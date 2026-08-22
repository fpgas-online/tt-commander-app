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

`mountCommander(el, opts)` returns `{ unmount() }`. Options:

| option      | meaning                                                                                                                                                                                                                                                                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `transport` | `{ kind: 'websocket', url }` — the daemon's `WS /serial`. **WebSocket-only in 0.1.0**: WebSerial needs a user gesture per page load, which an embedded widget cannot promise, so the standalone app keeps that job. `WebSocketImpl` may be set to a `WebSocket` double **in tests only** (see `src/transport/testing/FakeWebSocket.ts`). |
| `board`     | `{ slug, kind, shuttle? }` — board identity (`apiBase` is its own option, not part of this).                                                                                                                                                                                                                                             |
| `apiBase`   | e.g. `/api/board/<slug>`; required for `kind` `fpga`/`kianv` in later phases.                                                                                                                                                                                                                                                            |
| `chrome`    | `{ header, footer }`, both default `false` when embedded.                                                                                                                                                                                                                                                                                |
| `admin`     | shows maintenance controls (Reset to Bootloader); default `false`.                                                                                                                                                                                                                                                                       |
| `reconnect` | `{ minDelayMs, maxDelayMs }`; defaults 1 s / 30 s.                                                                                                                                                                                                                                                                                       |

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

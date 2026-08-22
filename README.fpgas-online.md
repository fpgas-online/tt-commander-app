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

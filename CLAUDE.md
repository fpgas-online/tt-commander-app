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

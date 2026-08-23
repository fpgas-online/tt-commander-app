// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026, fpgas.online contributors

import { Warning } from '@suid/icons-material';
import { Alert, Button, Paper, Stack, ThemeProvider, Typography } from '@suid/material';
import { Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { BoardCommander } from '~/components/BoardCommander';
import { Footer } from '~/components/Footer';
import { Header } from '~/components/Header';
import { backoffDelay } from '~/model/backoff';
import { setBoardInfo, type BoardInfo } from '~/model/board';
import { compareVersions, minimumFirmwareVersion } from '~/model/firmware';
import { loadFpgaDesigns } from '~/model/fpgaDesigns';
import type { SerialTransport } from '~/transport/SerialTransport';
import { WebSocketTransport } from '~/transport/WebSocketTransport';
import { TTBoardDevice } from '~/ttcontrol/TTBoardDevice';
import { theme } from '~/utils/theme';

export interface EmbedOptions {
  /**
   * Embedded mode is WebSocket-only: WebSerial needs a user gesture per page
   * load, which an embedded widget cannot promise. (The standalone app keeps
   * WebSerial.) `WebSocketImpl` is a test seam — leave it unset in production.
   */
  transport: { kind: 'websocket'; url: string; WebSocketImpl?: typeof WebSocket };
  board: Omit<BoardInfo, 'apiBase'>;
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

/**
 * A connection has to survive this long before we treat it as healthy and let
 * the next drop start its back-off from scratch; otherwise a board that flaps
 * open/closed would retry every second forever.
 */
const STABLE_CONNECTION_MS = 10_000;

export function EmbedApp(props: { options: EmbedOptions }) {
  const reconnect = () => props.options.reconnect ?? { minDelayMs: 1000, maxDelayMs: 30000 };
  const [device, setDevice] = createSignal<TTBoardDevice | null>(null);
  const [conn, setConn] = createSignal<ConnState>({ phase: 'idle' });
  const [boardPresent, setBoardPresent] = createSignal<boolean | null>(null);
  const [carrierNotice, setCarrierNotice] = createSignal<string | null>(null);
  const [firmwareOutdated, setFirmwareOutdated] = createSignal<string | null>(null);
  let attempt = 0;
  let connectedAt: number | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let transport: SerialTransport | null = null;
  let closeHandled = false;
  let disposed = false;

  setBoardInfo({ ...props.options.board, apiBase: props.options.apiBase });

  const scheduleReconnect = (reason: string) => {
    if (disposed) return;
    const { minDelayMs, maxDelayMs } = reconnect();
    attempt += 1;
    const retryInMs = backoffDelay(minDelayMs, maxDelayMs, attempt);
    setConn({ phase: 'waiting', attempt, retryInMs, reason });
    retryTimer = setTimeout(() => void connect(), retryInMs);
  };

  const makeTransport = async (): Promise<SerialTransport> => {
    const t = props.options.transport;
    const ws = new WebSocketTransport(t.url, { WebSocketImpl: t.WebSocketImpl });
    transport = ws;
    ws.addEventListener('message', (ev) => {
      const detail = (ev as CustomEvent<Record<string, unknown>>).detail;
      if (detail.event === 'board') setBoardPresent(Boolean(detail.present));
      // The daemon reports its own failures out of band; they explain a REPL
      // that has gone quiet, so show them rather than swallowing them.
      if (detail.event === 'error') setCarrierNotice(String(detail.error ?? 'daemon error'));
    });
    ws.addEventListener('error', (ev) => {
      const detail = (ev as CustomEvent<{ message: string }>).detail;
      setCarrierNotice(detail?.message ?? 'connection error');
    });
    await ws.ready;
    return ws;
  };

  const connect = async () => {
    if (disposed) return;
    // Board presence and carrier notices are per-connection: the previous
    // socket's last word about them says nothing about the new one.
    setBoardPresent(null);
    setCarrierNotice(null);
    setConn({ phase: 'connecting', attempt });
    closeHandled = false;
    try {
      const carrier = await makeTransport();
      // The component may have been unmounted while the carrier was opening.
      if (disposed) {
        void carrier.close();
        return;
      }
      const dev = new TTBoardDevice(carrier);
      // Either signal may fire first, and TTBoardDevice stays quiet when the
      // carrier's readable simply ends (it only dispatches 'close' when its
      // reader errors or when close() is called), so watch both and act once.
      const onClosed = () => {
        if (closeHandled) return;
        closeHandled = true;
        setDevice(null);
        // Release this connection's reader/writer/streams before the next one
        // is built; close() is fully guarded, so a broken carrier is fine.
        void dev.close().catch(() => {});
        // dev.close()'s teardown can stall (e.g. awaiting a REPL response
        // that will never arrive once the carrier is gone); close the
        // carrier directly too so a retry never finds the previous
        // WebSocket still open (#7).
        void carrier.close().catch(() => {});
        const info = (carrier as WebSocketTransport).closeInfo;
        if (connectedAt != null && Date.now() - connectedAt >= STABLE_CONNECTION_MS) {
          attempt = 0; // the connection was healthy; start the back-off over
        }
        connectedAt = null;
        scheduleReconnect(info ? `${info.code} ${info.reason}` : 'connection closed');
      };
      dev.addEventListener('close', onClosed);
      carrier.addEventListener('close', onClosed);
      setDevice(dev);
      setConn({ phase: 'connected' });
      connectedAt = Date.now();
      // The REPL bootstrap can fail on a carrier that dies mid-handshake; the
      // carrier's 'close' drives the reconnect, so just report it.
      dev.start().catch((e: unknown) => console.warn('tt-commander: start failed', e));
    } catch (e) {
      // The carrier may already be open — makeTransport() only rejects after
      // assigning `transport`, and everything after it can throw too. Close it
      // and claim its teardown, or the retry leaves a live socket behind and
      // its later 'close' schedules a second, competing retry (#7).
      closeHandled = true;
      void transport?.close().catch(() => {});
      scheduleReconnect((e as Error).message);
    }
  };

  const reconnectNow = () => {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    attempt = 0;
    connectedAt = null;
    // This teardown is ours: don't let it schedule a back-off retry as well.
    closeHandled = true;
    const dev = device();
    setDevice(null);
    void (async () => {
      await (dev ? dev.close() : (transport?.close() ?? Promise.resolve())).catch(() => {});
      await connect();
    })();
  };

  onMount(() => {
    // The design list is daemon state, not REPL state: fetch it up front so the
    // Config tab is usable even while the board's REPL is silent. The ROM's
    // `shuttle=` line refreshes it on every connect.
    const { board, apiBase } = props.options;
    if (board.kind === 'fpga' && apiBase) {
      void loadFpgaDesigns(apiBase);
    }
    void connect();
  });
  onCleanup(() => {
    disposed = true;
    closeHandled = true;
    if (retryTimer) clearTimeout(retryTimer);
    const dev = device();
    if (dev) {
      void dev.close().catch(() => {});
    } else {
      void transport?.close().catch(() => {});
    }
  });

  createEffect(() => {
    const v = device()?.data.version;
    if (!v) {
      setFirmwareOutdated(null);
      return;
    }
    try {
      setFirmwareOutdated(compareVersions(v, minimumFirmwareVersion) < 0 ? v : null);
    } catch {
      setFirmwareOutdated(v);
    }
  });

  const chrome = () => props.options.chrome ?? { header: false, footer: false };
  const waiting = () => {
    const c = conn();
    return c.phase === 'waiting' ? c : null;
  };

  return (
    <ThemeProvider theme={theme}>
      {/* Deliberately no CssBaseline: an embedded widget must not restyle the
          host page's body or typography. Everything the widget needs is scoped
          to this root element. */}
      <Stack
        component="section"
        width="100%"
        sx={{
          boxSizing: 'border-box',
          // The host page owns body typography, so restate the theme font on
          // our own root instead of imposing it globally.
          fontFamily: theme.typography.fontFamily,
          color: 'text.primary',
          '& *, & *::before, & *::after': { boxSizing: 'inherit' },
        }}
      >
        <Show when={chrome().header}>
          <Header />
        </Show>

        <Show when={conn().phase !== 'connected'}>
          <Alert severity={conn().phase === 'waiting' ? 'warning' : 'info'} sx={{ my: 1 }}>
            <Show when={conn().phase === 'connecting'}>Connecting to the board…</Show>
            <Show when={waiting()}>
              {(c) =>
                `Disconnected (${c().reason}). Retrying in ${Math.round(c().retryInMs / 1000)} s (attempt ${c().attempt}).`
              }
            </Show>
            <Show when={waiting()}>
              <Button size="small" onClick={reconnectNow} sx={{ ml: 1 }}>
                Retry now
              </Button>
            </Show>
          </Alert>
        </Show>

        <Show when={carrierNotice()}>
          {(text) => (
            <Alert severity="warning" sx={{ my: 1 }} onClose={() => setCarrierNotice(null)}>
              {text()}
            </Alert>
          )}
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

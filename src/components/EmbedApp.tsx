// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026, fpgas.online contributors

/// <reference types="dom-serial" />

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
import { BoardCommander } from '~/components/BoardCommander';
import { Footer } from '~/components/Footer';
import { Header } from '~/components/Header';
import { setBoardInfo, type BoardInfo } from '~/model/board';
import { compareVersions, minimumFirmwareVersion } from '~/model/firmware';
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
  let transport: SerialTransport | null = null;
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
      transport = ws;
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
    const serial = new WebSerialTransport(port);
    transport = serial;
    return serial;
  };

  const connect = async () => {
    if (disposed) return;
    setConn({ phase: 'connecting', attempt });
    try {
      const carrier = await makeTransport();
      // The component may have been unmounted while the carrier was opening.
      if (disposed) {
        void carrier.close();
        return;
      }
      const dev = new TTBoardDevice(carrier);
      dev.addEventListener('close', () => {
        setDevice(null);
        const info = (carrier as WebSocketTransport).closeInfo;
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
    const dev = device();
    if (dev) {
      void dev.close();
    } else {
      void transport?.close();
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
      <CssBaseline enableColorScheme />
      <Stack component="section" width="100%">
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

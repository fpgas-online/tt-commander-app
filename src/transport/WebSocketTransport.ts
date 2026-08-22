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
    // Compare against readyState's standardised numeric values (0 = CONNECTING,
    // 1 = OPEN) rather than the global WebSocket constants: the injected
    // WebSocketImpl in tests is not the global WebSocket, and referencing the
    // global here would either miss the fake's readyState or fail outright in
    // environments without a global WebSocket.
    if (this.ws.readyState === 1 || this.ws.readyState === 0) {
      this.ws.close(1000, 'client close');
    }
    // The socket's close event drives onClose(); if the implementation closes
    // synchronously (tests) we are already done, otherwise make sure state flips.
    if (!this.closed) {
      this.onClose(1000, 'client close');
    }
  }
}

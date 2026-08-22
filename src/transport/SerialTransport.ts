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

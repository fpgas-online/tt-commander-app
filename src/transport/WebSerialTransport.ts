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

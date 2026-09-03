// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026, fpgas.online contributors

/**
 * Minimal scripted WebSocket double (no network), shared by the transport and
 * embed specs. Pass it as `WebSocketImpl` to `WebSocketTransport` (or as the
 * embed's `transport.WebSocketImpl`) and drive the connection with the
 * `server*` helpers.
 */
export class FakeWebSocket extends EventTarget {
  static instances: FakeWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = FakeWebSocket.CONNECTING;
  binaryType = 'blob';
  sent: (string | ArrayBuffer | ArrayBufferView)[] = [];

  constructor(
    public url: string,
    public protocols?: string | string[],
  ) {
    super();
    FakeWebSocket.instances.push(this);
  }

  /** Forget every instance created so far (call before each test). */
  static reset() {
    FakeWebSocket.instances = [];
  }

  /** The most recently constructed socket. */
  static get last(): FakeWebSocket {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  }

  /** Usable where a `typeof WebSocket` is expected. */
  static asImpl(): typeof WebSocket {
    return FakeWebSocket as unknown as typeof WebSocket;
  }

  send(data: string | ArrayBuffer | ArrayBufferView) {
    this.sent.push(data);
  }

  close(code = 1000, reason = '') {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent('close', { code, reason, wasClean: true }));
  }

  // --- test helpers -------------------------------------------------------
  serverOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  serverBinary(bytes: Uint8Array) {
    this.dispatchEvent(
      new MessageEvent('message', {
        data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      }),
    );
  }

  serverText(text: string) {
    this.dispatchEvent(new MessageEvent('message', { data: text }));
  }

  serverClose(code: number, reason: string) {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent('close', { code, reason, wasClean: true }));
  }
}

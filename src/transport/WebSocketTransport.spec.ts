// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026, fpgas.online contributors

import { describe, expect, test, vi } from 'vitest';
import { WebSocketTransport } from './WebSocketTransport';

/** Minimal scripted WebSocket double (no network). */
class FakeWebSocket extends EventTarget {
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
  send(data: string | ArrayBuffer | ArrayBufferView) {
    this.sent.push(data);
  }
  close(code = 1000, reason = '') {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent('close', { code, reason, wasClean: true }));
  }
  // test helpers
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

function make() {
  FakeWebSocket.instances = [];
  const t = new WebSocketTransport('ws://example/serial', {
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
  });
  return { t, ws: FakeWebSocket.instances[0] };
}

describe('WebSocketTransport', () => {
  test('starts connecting, sets binaryType, opens on socket open', async () => {
    const { t, ws } = make();
    expect(t.state).toBe('connecting');
    expect(ws.binaryType).toBe('arraybuffer');
    const onOpen = vi.fn();
    t.addEventListener('open', onOpen);
    ws.serverOpen();
    await t.ready;
    expect(t.state).toBe('open');
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  test('binary frames appear on readable as Uint8Array chunks', async () => {
    const { t, ws } = make();
    ws.serverOpen();
    await t.ready;
    const reader = t.readable.getReader();
    ws.serverBinary(new Uint8Array([0x3e, 0x3e, 0x3e, 0x20]));
    const { value } = await reader.read();
    expect(Array.from(value!)).toEqual([0x3e, 0x3e, 0x3e, 0x20]);
    reader.releaseLock();
  });

  test('text frames become message events, not readable bytes', async () => {
    const { t, ws } = make();
    ws.serverOpen();
    await t.ready;
    const onMessage = vi.fn();
    t.addEventListener('message', onMessage);
    ws.serverText('{"event":"board","present":true,"device":"/dev/ttboard"}');
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect((onMessage.mock.calls[0][0] as CustomEvent).detail).toEqual({
      event: 'board',
      present: true,
      device: '/dev/ttboard',
    });
  });

  test('malformed text frame emits error event and does not throw', async () => {
    const { t, ws } = make();
    ws.serverOpen();
    await t.ready;
    const onError = vi.fn();
    t.addEventListener('error', onError);
    expect(() => ws.serverText('not json')).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  test('writable chunks are sent as binary; writes queued before open are flushed on open', async () => {
    const { t, ws } = make();
    const writer = t.writable.getWriter();
    const pending = writer.write(new Uint8Array([0x01]));
    expect(ws.sent).toHaveLength(0);
    ws.serverOpen();
    await t.ready;
    await pending;
    await writer.write(new Uint8Array([0x04]));
    expect(ws.sent).toHaveLength(2);
    expect(new Uint8Array(ws.sent[1] as ArrayBuffer)[0]).toBe(0x04);
    writer.releaseLock();
  });

  test('server close ends readable, errors writable, emits close once with closeInfo', async () => {
    const { t, ws } = make();
    ws.serverOpen();
    await t.ready;
    const onClose = vi.fn();
    t.addEventListener('close', onClose);
    const reader = t.readable.getReader();
    ws.serverClose(1011, 'board disconnected');
    const { done } = await reader.read();
    expect(done).toBe(true);
    expect(t.state).toBe('closed');
    expect(t.closeInfo).toEqual({ code: 1011, reason: 'board disconnected' });
    expect(onClose).toHaveBeenCalledTimes(1);
    await expect(t.writable.getWriter().write(new Uint8Array([1]))).rejects.toThrow(/closed/);
  });

  test('close() closes the socket and resolves; idempotent', async () => {
    const { t, ws } = make();
    ws.serverOpen();
    await t.ready;
    const onClose = vi.fn();
    t.addEventListener('close', onClose);
    await t.close();
    await t.close();
    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('open timeout rejects ready and closes', async () => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    const t = new WebSocketTransport('ws://example/serial', {
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      openTimeoutMs: 50,
    });
    const rejection = expect(t.ready).rejects.toThrow(/timeout/);
    vi.advanceTimersByTime(60);
    await rejection;
    expect(t.state).toBe('closed');
    vi.useRealTimers();
  });
});

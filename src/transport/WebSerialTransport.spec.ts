// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026, fpgas.online contributors

import { describe, expect, test, vi } from 'vitest';
import { WebSerialTransport } from './WebSerialTransport';

function fakePort() {
  const readable = new ReadableStream<Uint8Array>();
  const writable = new WritableStream<Uint8Array>();
  const close = vi.fn(async () => {});
  return { readable, writable, close } as unknown as SerialPort & { close: typeof close };
}

describe('WebSerialTransport', () => {
  test('exposes the port streams and is open immediately', () => {
    const port = fakePort();
    const t = new WebSerialTransport(port);
    expect(t.readable).toBe(port.readable);
    expect(t.writable).toBe(port.writable);
    expect(t.state).toBe('open');
  });

  test('close() closes the port, flips state and emits close once', async () => {
    const port = fakePort();
    const t = new WebSerialTransport(port);
    const onClose = vi.fn();
    t.addEventListener('close', onClose);
    await t.close();
    await t.close();
    expect(port.close).toHaveBeenCalledTimes(1);
    expect(t.state).toBe('closed');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

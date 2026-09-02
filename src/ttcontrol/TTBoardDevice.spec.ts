// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026, fpgas.online contributors

import { describe, expect, test } from 'vitest';
import type { SerialTransport, TransportState } from '~/transport/SerialTransport';
import { TTBoardDevice } from './TTBoardDevice';
import ttControl from './ttcontrol.py?raw';

/**
 * A carrier that records everything written to it (decoded back into text).
 * Its readable can be fed by tests and killed to simulate a dropped carrier.
 */
class FakeTransport extends EventTarget implements SerialTransport {
  state: TransportState = 'open';
  readonly written: string[] = [];
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
  private controller!: ReadableStreamDefaultController<Uint8Array>;
  private dead = false;

  constructor() {
    super();
    this.readable = new ReadableStream<Uint8Array>({
      start: (c) => {
        this.controller = c;
      },
    });
    const decoder = new TextDecoder();
    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        if (this.dead) {
          throw new Error('carrier gone');
        }
        this.written.push(decoder.decode(chunk, { stream: true }));
      },
    });
  }

  feed(text: string) {
    this.controller.enqueue(new TextEncoder().encode(text));
  }

  /**
   * Simulate the carrier dropping: reads error, writes reject. Per the
   * SerialTransport contract the state flips to 'closed' with the failure
   * (WebSocketTransport does the same) — run()'s re-pipe loop exits on it;
   * a fake that errors the stream while claiming to be 'open' would spin
   * that loop forever on the same errored stream.
   */
  kill() {
    this.dead = true;
    this.state = 'closed';
    this.controller.error(new Error('carrier gone'));
  }

  async close() {
    this.state = 'closed';
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('TTBoardDevice (legacy protocol)', () => {
  test('start() enters RAW REPL, sends ttcontrol.py and read_rom()', async () => {
    const transport = new FakeTransport();
    const dev = new TTBoardDevice(transport);
    await dev.start();
    const all = transport.written.join('');
    expect(all).toContain('\x03\x03'); // stop any running program
    expect(all).toContain('\x01'); // enter RAW REPL mode
    expect(all).toContain(ttControl); // the bit-banging control script
    expect(all).toContain('read_rom()\x04');
  });

  test('parses firmware=/version= lines from the stream into the store', async () => {
    const transport = new FakeTransport();
    const dev = new TTBoardDevice(transport);
    await dev.start();
    transport.feed('firmware=tt-demo-rp2040\r\nversion=1.2.2\r\n');
    await tick();
    expect(dev.data.deviceName).toBe('tt-demo-rp2040');
    expect(dev.data.version).toBe('1.2.2');
  });

  test('selectDesign(n) sends select_design(n) with the RAW-REPL terminator', async () => {
    const transport = new FakeTransport();
    const dev = new TTBoardDevice(transport);
    await dev.start();
    await dev.selectDesign(5);
    expect(transport.written.join('')).toContain('select_design(5)\x04');
  });

  test('close() resolves and closes the carrier even when it is already dead', async () => {
    const transport = new FakeTransport();
    const dev = new TTBoardDevice(transport);
    await dev.start();
    transport.kill();
    await tick();
    await expect(dev.close()).resolves.toBeUndefined();
    expect(transport.state).toBe('closed');
  });
});

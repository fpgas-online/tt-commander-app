// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026, fpgas.online contributors

import { describe, expect, test, vi } from 'vitest';
import type { SerialTransport, TransportState } from '~/transport/SerialTransport';
import { TTBoardDevice } from './TTBoardDevice';

/**
 * A carrier whose `readable` becomes null after its stream errors — what the
 * Web Serial spec does to a `SerialPort` after a fatal error (buffer overrun,
 * device unplugged). `TTBoardDevice.run()` must not try to re-pipe that null.
 */
class NullAfterErrorTransport extends EventTarget implements SerialTransport {
  state: TransportState = 'open';
  readableReads = 0;
  writable = new WritableStream<Uint8Array>();
  private controller!: ReadableStreamDefaultController<Uint8Array>;
  private stream: ReadableStream<Uint8Array> | null = new ReadableStream<Uint8Array>({
    start: (c) => {
      this.controller = c;
    },
  });

  get readable(): ReadableStream<Uint8Array> {
    this.readableReads += 1;
    // Typed non-null by the interface; null is the real-world Web Serial state
    // this guard exists for.
    return this.stream as ReadableStream<Uint8Array>;
  }

  /** Fatal carrier error: the stream errors and the port loses its readable. */
  fail(error: Error) {
    this.controller.error(error);
    this.stream = null;
  }

  async close() {
    this.state = 'closed';
  }
}

/** run() is private; the loop under test is only reachable through it. */
function run(device: TTBoardDevice): Promise<void> {
  return (device as unknown as { run(): Promise<void> }).run();
}

describe('TTBoardDevice.run', () => {
  test('stops looping when the transport lost its readable after an error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const transport = new NullAfterErrorTransport();
    const device = new TTBoardDevice(transport);
    const closed = vi.fn();
    device.addEventListener('close', closed);

    const loop = run(device);
    // Let the pipe get going before the carrier dies under it.
    await new Promise((resolve) => setTimeout(resolve, 0));
    transport.fail(new Error('device lost'));

    await expect(loop).resolves.toBeUndefined();
    expect(closed).toHaveBeenCalledTimes(1);
    // Iteration 1: loop condition + pipe. Iteration 2: the condition that,
    // seeing null, ends the loop instead of re-piping.
    expect(transport.readableReads).toBe(3);
  });
});

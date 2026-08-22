// @vitest-environment jsdom
// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026, fpgas.online contributors

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mountCommander } from '~/embed';
import { FakeWebSocket } from '~/transport/testing/FakeWebSocket';

/** Let queued promise jobs run while fake timers are installed. */
async function flush(times = 8) {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

describe('mountCommander', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.reset();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test('mounts into the element, shows connecting state, and unmounts cleanly', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    // A URL nothing listens on: we only assert the initial render + teardown.
    const handle = mountCommander(el, {
      transport: { kind: 'websocket', url: 'ws://127.0.0.1:9/serial' },
      board: { slug: 'tt06', kind: 'asic', shuttle: 'tt06' },
    });
    expect(el.textContent).toMatch(/connecting/i);
    handle.unmount();
    expect(el.childElementCount).toBe(0);
    el.remove();
  });

  /** CSS rules injected into the document that would restyle the host page. */
  function globalRulesTargetingHost() {
    return [...document.querySelectorAll('style')]
      .flatMap((s) => (s.textContent ?? '').split('}'))
      .filter((rule) => /(^|,|\s)(html|body)\s*\{/.test(rule + '{'));
  }

  test('does not inject global styles for the host page', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    document.body.style.margin = '17px';
    const handle = mountCommander(el, {
      transport: { kind: 'websocket', url: 'ws://127.0.0.1:9/serial' },
      board: { slug: 'tt06', kind: 'asic' },
    });
    expect(globalRulesTargetingHost()).toEqual([]);
    expect(document.body.style.margin).toBe('17px');
    handle.unmount();
    document.body.style.margin = '';
    el.remove();
  });

  test('shows the close code and reconnects after the back-off', async () => {
    // Pin the jitter so the retry lands on exactly the nominal delay.
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const el = document.createElement('div');
    document.body.appendChild(el);
    const handle = mountCommander(el, {
      transport: {
        kind: 'websocket',
        url: 'ws://127.0.0.1:8765/serial',
        WebSocketImpl: FakeWebSocket.asImpl(),
      },
      board: { slug: 'tt06', kind: 'asic', shuttle: 'tt06' },
    });

    expect(FakeWebSocket.instances).toHaveLength(1);
    FakeWebSocket.last.serverOpen();
    await flush();
    // The Commander is up: its shuttle line replaced the "connecting" banner.
    expect(el.textContent).toMatch(/Shuttle:/);
    expect(el.textContent).not.toMatch(/connecting/i);

    FakeWebSocket.last.serverClose(1011, 'board disconnected');
    await flush();
    expect(el.textContent).toMatch(/1011 board disconnected/);

    // Nothing yet just before the first back-off delay elapses…
    await vi.advanceTimersByTimeAsync(900);
    expect(FakeWebSocket.instances).toHaveLength(1);
    // …and a fresh socket once it does.
    await vi.advanceTimersByTimeAsync(200);
    expect(FakeWebSocket.instances).toHaveLength(2);

    handle.unmount();
    el.remove();
  });
});

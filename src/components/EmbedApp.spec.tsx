// @vitest-environment jsdom
// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026, fpgas.online contributors

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mountCommander } from '~/embed';

describe('mountCommander', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
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
});

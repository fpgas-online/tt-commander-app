// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026, fpgas.online contributors
import { describe, expect, it } from 'vitest';

describe('tooling', () => {
  it('runs tests under jsdom', () => {
    expect(typeof document).toBe('object');
  });
});

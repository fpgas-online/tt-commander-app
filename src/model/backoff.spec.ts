// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026, fpgas.online contributors

import { describe, expect, test } from 'vitest';
import { backoffDelay } from './backoff';

const MIN = 1000;
const MAX = 30000;

describe('backoffDelay', () => {
  test.each([
    [1, 1000],
    [2, 2000],
    [3, 4000],
    [4, 8000],
    [5, 16000],
    [6, 30000], // 32000 exceeds the cap
  ])('attempt %i without jitter (random = 0.5) is %i ms', (attempt, expected) => {
    expect(backoffDelay(MIN, MAX, attempt, () => 0.5)).toBe(expected);
  });

  test('caps at maxDelayMs for large attempt counts', () => {
    expect(backoffDelay(MIN, MAX, 20, () => 0.5)).toBe(MAX);
    expect(backoffDelay(MIN, MAX, 1000, () => 0.5)).toBe(MAX);
  });

  test('applies -20 % jitter when random() is 0 and +20 % when it is 1', () => {
    expect(backoffDelay(MIN, MAX, 3, () => 0)).toBe(3200);
    expect(backoffDelay(MIN, MAX, 3, () => 1)).toBe(4800);
  });

  test('never returns more than maxDelayMs, even with the upper jitter bound', () => {
    expect(backoffDelay(MIN, MAX, 6, () => 1)).toBe(MAX);
    expect(backoffDelay(MIN, MAX, 6, () => 0)).toBe(24000);
  });

  test('attempt 0 or negative behaves like the first attempt', () => {
    expect(backoffDelay(MIN, MAX, 0, () => 0.5)).toBe(MIN);
    expect(backoffDelay(MIN, MAX, -5, () => 0.5)).toBe(MIN);
  });

  test('defaults to Math.random and stays within the jitter band', () => {
    for (let i = 0; i < 50; i++) {
      const d = backoffDelay(MIN, MAX, 2);
      expect(d).toBeGreaterThanOrEqual(1600);
      expect(d).toBeLessThanOrEqual(2400);
    }
  });
});

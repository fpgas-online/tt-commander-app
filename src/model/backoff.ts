// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026, fpgas.online contributors

/** How far the jitter may pull a delay away from the nominal back-off (±20 %). */
const JITTER = 0.2;

/**
 * Delay before reconnect attempt `attempt` (1 = the first retry): exponential
 * `minDelayMs * 2 ** (attempt - 1)`, capped at `maxDelayMs`, then spread by
 * ±20 % jitter so a fleet of viewers that lost the same daemon does not
 * stampede it when it comes back. `maxDelayMs` stays a hard ceiling: the upper
 * jitter bound is clamped to it rather than allowed to overshoot.
 *
 * `random` is injectable so tests can pin the jitter (0.5 = no jitter).
 */
export function backoffDelay(
  minDelayMs: number,
  maxDelayMs: number,
  attempt: number,
  random: () => number = Math.random,
): number {
  const nominal = Math.min(maxDelayMs, minDelayMs * 2 ** Math.max(0, attempt - 1));
  const jittered = nominal * (1 - JITTER + 2 * JITTER * random());
  return Math.min(maxDelayMs, Math.round(jittered));
}

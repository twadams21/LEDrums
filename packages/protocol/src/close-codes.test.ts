import { describe, expect, it } from 'vitest';
import {
  retryAfterSecondsFrom,
  throttledCloseReason,
  WS_CLOSE_INVALID_PIN,
  WS_CLOSE_PIN_THROTTLED,
} from './index';

describe('WS close codes', () => {
  it('keeps the two admission refusals distinct and inside the application-private range', () => {
    // A cooling peer is refused WITHOUT the PIN being compared, so telling it "Incorrect PIN"
    // would be a lie — the codes must not collapse into one.
    expect(WS_CLOSE_INVALID_PIN).toBe(4401);
    expect(WS_CLOSE_PIN_THROTTLED).toBe(4429);
    expect(WS_CLOSE_PIN_THROTTLED).not.toBe(WS_CLOSE_INVALID_PIN);
    for (const code of [WS_CLOSE_INVALID_PIN, WS_CLOSE_PIN_THROTTLED]) {
      expect(code).toBeGreaterThanOrEqual(4000);
      expect(code).toBeLessThanOrEqual(4999);
    }
  });
});

describe('throttled close reason', () => {
  it('rounds the wait UP to whole seconds, so acting on it is never premature', () => {
    expect(throttledCloseReason(1_000)).toBe('too many attempts; retry in 1s');
    expect(throttledCloseReason(1_001)).toBe('too many attempts; retry in 2s');
    expect(throttledCloseReason(29_500)).toBe('too many attempts; retry in 30s');
    expect(throttledCloseReason(60_000)).toBe('too many attempts; retry in 60s');
  });

  it('floors at 1s — "retry in 0s" reads as "retry now" while the peer is still refused', () => {
    expect(throttledCloseReason(0)).toBe('too many attempts; retry in 1s');
    expect(throttledCloseReason(1)).toBe('too many attempts; retry in 1s');
  });

  it('stays inside the 123-byte WS close-reason limit at the maximum cooldown', () => {
    expect(Buffer.byteLength(throttledCloseReason(60_000), 'utf8')).toBeLessThanOrEqual(123);
  });

  it('round-trips through the parser', () => {
    for (const ms of [1_000, 2_000, 4_000, 30_000, 60_000]) {
      expect(retryAfterSecondsFrom(throttledCloseReason(ms))).toBe(Math.ceil(ms / 1_000));
    }
  });

  it('is null for anything that is not a throttled reason — the reason is best-effort on the wire', () => {
    expect(retryAfterSecondsFrom(undefined)).toBeNull();
    expect(retryAfterSecondsFrom(null)).toBeNull();
    expect(retryAfterSecondsFrom('')).toBeNull();
    expect(retryAfterSecondsFrom('invalid pin')).toBeNull();
    expect(retryAfterSecondsFrom('too many attempts')).toBeNull();
    expect(retryAfterSecondsFrom('too many attempts; retry in soon')).toBeNull();
    expect(retryAfterSecondsFrom('prefix too many attempts; retry in 5s')).toBeNull();
    expect(retryAfterSecondsFrom('too many attempts; retry in 0s')).toBeNull();
  });
});

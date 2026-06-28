import { describe, expect, it } from 'vitest';
import { formatFps, formatMs } from './stat-format';

describe('formatFps', () => {
  it('rounds to a whole number', () => {
    expect(formatFps(59.94)).toBe('60');
    expect(formatFps(60)).toBe('60');
    expect(formatFps(119.6)).toBe('120');
    expect(formatFps(0.4)).toBe('0');
  });

  it('never renders a fraction (fixed width)', () => {
    expect(formatFps(59.94)).not.toContain('.');
    expect(formatFps(144.0001)).not.toContain('.');
  });

  it('collapses non-finite input to "0"', () => {
    expect(formatFps(NaN)).toBe('0');
    expect(formatFps(Infinity)).toBe('0');
  });
});

describe('formatMs', () => {
  it('always shows exactly one decimal', () => {
    expect(formatMs(12.3461)).toBe('12.3');
    expect(formatMs(8)).toBe('8.0');
    expect(formatMs(0)).toBe('0.0');
    expect(formatMs(123.45)).toBe('123.5');
  });

  it('collapses non-finite input to "0.0"', () => {
    expect(formatMs(NaN)).toBe('0.0');
    expect(formatMs(Infinity)).toBe('0.0');
  });
});

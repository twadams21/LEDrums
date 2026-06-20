import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParamSpec } from '@ledrums/core';
import { controlForParam, tapTempo, throttle } from './params';

describe('controlForParam', () => {
  it('maps each ParamType to the right control kind', () => {
    const num: ParamSpec = { key: 'speed', label: 'Speed', type: 'number', default: 1, min: 0, max: 4 };
    const col: ParamSpec = { key: 'hue', label: 'Color', type: 'color', default: '#ff0000' };
    const en: ParamSpec = { key: 'axis', label: 'Axis', type: 'enum', default: 'x', options: ['x', 'y', 'z'] };
    const bl: ParamSpec = { key: 'invert', label: 'Invert', type: 'bool', default: false };

    expect(controlForParam(num).kind).toBe('slider');
    expect(controlForParam(col).kind).toBe('swatch');
    expect(controlForParam(en).kind).toBe('select');
    expect(controlForParam(bl).kind).toBe('checkbox');
  });

  it('carries through min/max/options metadata', () => {
    const en: ParamSpec = { key: 'axis', label: 'Axis', type: 'enum', default: 'x', options: ['x', 'y'] };
    const d = controlForParam(en);
    expect(d.options).toEqual(['x', 'y']);
    expect(d.key).toBe('axis');
  });
});

describe('throttle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('dispatches the leading edge immediately', () => {
    const fn = vi.fn();
    const t = throttle(fn, 50);
    t('a');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenLastCalledWith('a');
  });

  it('coalesces a burst into a single trailing call with the latest args', () => {
    const fn = vi.fn();
    const t = throttle(fn, 50);
    t(1); // leading → fires
    t(2);
    t(3);
    t(4); // all within window → coalesced
    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith(4); // latest args win
  });

  it('cancel() drops the pending trailing call', () => {
    const fn = vi.fn();
    const t = throttle(fn, 50);
    t(1);
    t(2);
    t.cancel();
    vi.advanceTimersByTime(60);
    expect(fn).toHaveBeenCalledTimes(1); // only the leading edge fired
  });
});

describe('tapTempo', () => {
  it('returns null for fewer than two taps', () => {
    expect(tapTempo([])).toBeNull();
    expect(tapTempo([1000])).toBeNull();
  });

  it('computes 120 BPM from 500ms taps', () => {
    expect(tapTempo([0, 500, 1000, 1500])).toBe(120);
  });

  it('computes 60 BPM from 1000ms taps', () => {
    expect(tapTempo([0, 1000, 2000])).toBe(60);
  });

  it('averages uneven intervals', () => {
    // intervals 480, 520 → avg 500 → 120 BPM
    expect(tapTempo([0, 480, 1000])).toBe(120);
  });
});

import { describe, expect, it } from 'vitest';
import type { Clip } from '../model/project-schema';
import { ControlState } from './control-state';
import { applyCurve, lfoValue, resolveParams } from './modulation';
import type { TransportState } from './render-context';

const transport: TransportState = { timeMs: 0, beat: 0, bar: 0, beatInBar: 0, bpm: 120, beatsPerBar: 4, playing: true };

function clip(modulations: Clip['modulations'], params: Clip['params'] = {}): Clip {
  return { id: 'c', name: '', effectId: 'meter-eq', params, modulations };
}

describe('modulation', () => {
  it('maps velocity 0 -> min and 1 -> max (linear)', () => {
    const cs = new ControlState();
    const c = clip([{ source: { type: 'velocity', drum: 'd' }, param: 'level', min: 0.2, max: 0.9, curve: 'linear' }]);
    cs.setVelocity('d', 0);
    expect(resolveParams(c, cs, transport).level).toBeCloseTo(0.2, 6);
    cs.setVelocity('d', 1);
    expect(resolveParams(c, cs, transport).level).toBeCloseTo(0.9, 6);
  });

  it('leaves un-modulated base params untouched', () => {
    const cs = new ControlState();
    const c = clip([], { brightness: 0.7, level: 0.3 });
    const out = resolveParams(c, cs, transport);
    expect(out.brightness).toBe(0.7);
    expect(out.level).toBe(0.3);
  });

  it('exp curve is monotonic and within range', () => {
    const xs = [0, 0.25, 0.5, 0.75, 1];
    const ys = xs.map((x) => applyCurve('exp', x));
    for (let i = 1; i < ys.length; i++) expect(ys[i]!).toBeGreaterThanOrEqual(ys[i - 1]!);
    expect(ys[0]).toBe(0);
    expect(ys[ys.length - 1]).toBe(1);
  });

  it('invert curve flips the value', () => {
    expect(applyCurve('invert', 0.25)).toBeCloseTo(0.75, 6);
  });

  it('lfo stays within [0,1] across shapes', () => {
    for (const shape of ['sine', 'triangle', 'square', 'saw']) {
      for (let t = 0; t < 1000; t += 37) {
        const v = lfoValue(shape, t, 1.5);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

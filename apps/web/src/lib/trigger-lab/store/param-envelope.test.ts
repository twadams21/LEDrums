import { describe, expect, it } from 'vitest';
import { setEnvAdsr, setEnvAmount, setEnvKind, setEnvPoints, setParamValue } from './param-envelope';
import { defaultAdsr, defaultEnvelope, type EnvMap, type EnvPoint } from '../sim';

/* Pure param/envelope authoring math (the seed / clear / custom-mark edits the store applies
   onto live nodes). The store-level wiring is covered in store.modulation.test.ts; this locks
   the maths in isolation, free of runes. */

describe('setParamValue', () => {
  it('writes a node-local param without mutating the input', () => {
    const params = { size: 0.4 };
    const next = setParamValue(params, 'hue', 0.7);
    expect(next).toEqual({ size: 0.4, hue: 0.7 });
    expect(params).toEqual({ size: 0.4 }); // input untouched
  });
  it('overwrites an existing key', () => {
    expect(setParamValue({ size: 0.4 }, 'size', 0.9)).toEqual({ size: 0.9 });
  });
});

describe('setEnvKind', () => {
  it("seeds a preset curve for any kind other than 'none'", () => {
    const next = setEnvKind({}, 'size', 'decay');
    expect(next.size).toEqual(defaultEnvelope('decay'));
  });
  it("removes the envelope on 'none'", () => {
    const env: EnvMap = { size: defaultEnvelope('decay') };
    expect(setEnvKind(env, 'size', 'none')).toEqual({});
    expect(env.size).toBeDefined(); // input untouched
  });
});

describe('setEnvAmount', () => {
  it('sets amount on an existing envelope', () => {
    const env: EnvMap = { size: { ...defaultEnvelope('decay'), amount: 0.2 } };
    expect(setEnvAmount(env, 'size', 0.8).size!.amount).toBe(0.8);
    expect(env.size!.amount).toBe(0.2); // input untouched
  });
  it('returns the same map (no-op) when the param has no envelope', () => {
    const env: EnvMap = {};
    expect(setEnvAmount(env, 'size', 0.8)).toBe(env);
  });
});

describe('setEnvPoints', () => {
  it('replaces the breakpoints and marks the envelope custom', () => {
    const env: EnvMap = { size: defaultEnvelope('decay') };
    const points: EnvPoint[] = [
      { t: 0, v: 1 },
      { t: 1, v: 0 },
    ];
    const next = setEnvPoints(env, 'size', points);
    expect(next.size!.points).toBe(points);
    expect(next.size!.kind).toBe('custom');
  });
  it('returns the same map (no-op) when the param has no envelope', () => {
    const env: EnvMap = {};
    expect(setEnvPoints(env, 'size', [])).toBe(env);
  });
});

describe('setEnvAdsr', () => {
  it('sets the ADSR shape, regenerates the curve and marks it custom', () => {
    const shape = defaultAdsr();
    const next = setEnvAdsr({ size: defaultEnvelope('decay') }, 'size', shape);
    expect(next.size!.adsr).toEqual(shape);
    expect(next.size!.kind).toBe('custom');
    expect(next.size!.points.length).toBeGreaterThan(0);
  });
  it('seeds a blank custom envelope when the param has none yet', () => {
    const shape = defaultAdsr();
    const next = setEnvAdsr({}, 'size', shape);
    expect(next.size!.kind).toBe('custom');
    expect(next.size!.amount).toBe(1);
    expect(next.size!.adsr).toEqual(shape);
  });
});

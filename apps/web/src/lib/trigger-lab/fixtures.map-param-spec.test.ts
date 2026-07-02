import { describe, expect, it } from 'vitest';
import type { ParamSpec as CoreParamSpec } from '@ledrums/core';
import { mapParamSpec } from './fixtures';

/* S18 — mapParamSpec must be TOTAL over the four core ParamTypes so no spec is ever
   silently dropped (the pre-S18 bug: enum/color returned null and the generator was stuck
   at its own default, uneditable). One case per type + a sweep proving none is dropped. */

describe('mapParamSpec — total over all four ParamTypes (S18)', () => {
  it('number → number kind (envelope-able), preserving range/step/unit', () => {
    const out = mapParamSpec({ key: 'speed', label: 'Speed', type: 'number', default: 1.2, min: 0.1, max: 3, step: 0.1, unit: 'x' });
    expect(out.kind).toBe('number');
    expect(out.envable).toBe(true);
    expect(out).toMatchObject({ min: 0.1, max: 3, step: 0.1, unit: 'x', default: 1.2 });
  });

  it('bool → bool kind (not envelope-able)', () => {
    const out = mapParamSpec({ key: 'sync', label: 'Sync', type: 'bool', default: true });
    expect(out.kind).toBe('bool');
    expect(out.default).toBe(true);
    expect(out.envable).toBeUndefined();
  });

  it('enum → enum kind carrying its options + string default (not envelope-able)', () => {
    const out = mapParamSpec({ key: 'mode', label: 'Mode', type: 'enum', default: 'in', options: ['out', 'in', 'bounce'] });
    expect(out.kind).toBe('enum');
    expect(out.options).toEqual(['out', 'in', 'bounce']);
    expect(out.default).toBe('in');
    expect(out.envable).toBeUndefined();
  });

  it('enum with a non-string/absent default falls back to the first option', () => {
    // A malformed spec (numeric default on an enum) must still yield a valid option.
    const out = mapParamSpec({ key: 'mode', label: 'Mode', type: 'enum', default: 0, options: ['x', 'y'] });
    expect(out.default).toBe('x');
  });

  it('color → color kind with a hex-string default', () => {
    const out = mapParamSpec({ key: 'tint', label: 'Tint', type: 'color', default: '#ff8800' });
    expect(out.kind).toBe('color');
    expect(out.default).toBe('#ff8800');
    expect(out.envable).toBeUndefined();
  });

  it('never drops a type — every ParamType yields a control of the matching kind', () => {
    const specs: CoreParamSpec[] = [
      { key: 'n', label: 'N', type: 'number', default: 0 },
      { key: 'b', label: 'B', type: 'bool', default: false },
      { key: 'e', label: 'E', type: 'enum', default: 'a', options: ['a', 'b'] },
      { key: 'c', label: 'C', type: 'color', default: '#000000' },
    ];
    for (const spec of specs) {
      const out = mapParamSpec(spec);
      expect(out).not.toBeNull();
      expect(out.kind).toBe(spec.type);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { effectIds, getEffect, listEffects, tryGetEffect } from './registry';

describe('effect registry', () => {
  it('has unique effect ids', () => {
    const ids = effectIds();
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ships the full MVP catalog across every category', () => {
    const categories = new Set(listEffects().map((e) => e.category));
    expect(categories).toEqual(new Set(['base', 'trigger', 'wash', 'meter', 'utility']));
    for (const id of ['solid-base', 'chase', 'whole-drum', 'whole-kit', 'follow-hoop', 'radial-wash', 'wipe-3d', 'meter-eq', 'pixel-accum', 'colour-melody', 'strobe']) {
      expect(tryGetEffect(id), id).toBeDefined();
    }
  });

  it('paramSpec defaults sit within declared min/max', () => {
    for (const e of listEffects()) {
      for (const s of e.paramSpec) {
        if (s.type === 'number' && typeof s.default === 'number') {
          if (s.min !== undefined) expect(s.default, `${e.id}.${s.key}`).toBeGreaterThanOrEqual(s.min);
          if (s.max !== undefined) expect(s.default, `${e.id}.${s.key}`).toBeLessThanOrEqual(s.max);
        }
        if (s.type === 'enum') {
          expect(s.options).toBeDefined();
          expect(s.options).toContain(s.default);
        }
      }
    }
  });

  it('throws on an unknown effect id', () => {
    expect(() => getEffect('does-not-exist')).toThrow(/Unknown effect/);
  });
});

import { describe, expect, it } from 'vitest';
import { effectIds, getEffect, listEffects, tryGetEffect } from './registry';

describe('effect registry', () => {
  it('has unique effect ids', () => {
    const ids = effectIds();
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ships the full catalog across every category', () => {
    const categories = new Set(listEffects().map((e) => e.category));
    expect(categories).toEqual(new Set(['base', 'trigger', 'wash', 'meter', 'utility', 'texture', 'particle']));
    for (const id of [
      // original catalog
      'solid-base', 'chase', 'whole-drum', 'whole-kit', 'follow-hoop', 'radial-wash', 'wipe-3d', 'meter-eq', 'pixel-accum', 'colour-melody', 'strobe', 'synced-hoops', 'burst', 'swing', 'sidechain', 'sacred-hogs', 'collisions',
      // 2D UV textures
      'plasma', 'fire', 'ripple-pond', 'rainbow-flow', 'tunnel', 'checker-pulse', 'perlin-clouds', 'lava-lamp', 'interference', 'caustics', 'spiral', 'grid-glow',
      // particles / spatial / musical
      'starfield', 'comet-trails', 'lightning', 'confetti-burst', 'helix', 'orbit-rings', 'gravity-wells', 'breathing-kit', 'temp-sweep', 'velocity-flames', 'hue-rotate-kit', 'wave-collapse',
      // emission-based 3D batch
      'chase-bands', 'ripple-3d', 'spark-arc', 'rain-3d',
    ]) {
      expect(tryGetEffect(id), id).toBeDefined();
    }
    expect(listEffects().length).toBe(45);
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

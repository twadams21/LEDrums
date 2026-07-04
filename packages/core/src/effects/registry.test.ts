import { describe, expect, it } from 'vitest';
import { effectIds, getEffect, listEffects, tryGetEffect } from './registry';
import { COLLECTIONS, collectionOf, isEffectTag } from './vocabulary';

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

  it('every non-deprecated effect has a description and at least one valid tag (D1)', () => {
    for (const e of listEffects()) {
      if (e.deprecated) continue; // retired effects are exempt (hidden from the gallery)
      expect(e.description, `${e.id} description`).toBeTruthy();
      expect(e.description!.length, `${e.id} description length`).toBeGreaterThan(20);
      expect(e.tags?.length ?? 0, `${e.id} tags`).toBeGreaterThanOrEqual(1);
      for (const t of e.tags ?? []) {
        expect(isEffectTag(t), `${e.id} tag "${t}" in vocabulary`).toBe(true);
      }
    }
  });

  it('every effect maps to exactly one known collection (total taxonomy)', () => {
    const types = new Set(COLLECTIONS.map((c) => c.type));
    for (const e of listEffects()) {
      if (e.deprecated) continue;
      const type = collectionOf(e.tags);
      expect(types.has(type), `${e.id} → ${type}`).toBe(true);
    }
  });
});

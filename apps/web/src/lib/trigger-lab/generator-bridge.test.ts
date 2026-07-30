import { describe, expect, it } from 'vitest';
import { listEffects } from '@ledrums/core';
import { EFFECTS, GENERATOR_EFFECTS, PRESETS } from './fixtures';

/* The generator bridge's REGISTRY surface: every core generator is surfaced as a selectable,
   generator-backed EffectDef with a Default preset and valid param defaults.

   The "offline render parity" half of this file (nine cases that fired a generator through the
   browser-side sim and asserted lit pixels in a locally-composited frame) went with the sim in
   INIT-01 Decision 3 — the engine composites now, and core's own generator/render suites
   (effects conformance batch-a..e, voice/determinism, voice/render-plan) assert those pixels
   against the real render path. What survives here is the part that is genuinely web-side: the
   catalogue the effect gallery browses. */

describe('generator bridge — registry coverage', () => {
  it('surfaces every core generator as a selectable, generator-backed effect', () => {
    const gens = listEffects();
    expect(gens.length).toBe(49); // all core effects accounted for (45 + 4 U6 gap-fill natives)
    expect(GENERATOR_EFFECTS.length).toBe(gens.length);

    for (const gen of gens) {
      const def = EFFECTS.find((e) => e.generatorId === gen.id);
      expect(def, `EffectDef for ${gen.id}`).toBeTruthy();
      expect(def!.id).toBe(`gen:${gen.id}`);
      expect(def!.category).toBe(gen.category);
      // every generator-backed effect has a Default preset so play nodes resolve.
      expect(PRESETS.find((p) => p.id === `gen:${gen.id}:default`), `Default preset for ${gen.id}`).toBeTruthy();
      // surfaced number/bool param defaults are valid (color/enum are intentionally dropped).
      for (const sp of def!.params) {
        if (sp.kind === 'number') {
          expect(Number.isFinite(sp.default as number), `${gen.id}.${sp.key} default`).toBe(true);
        }
      }
    }
  });

  it('no generator effect id collides with a pattern effect id', () => {
    const ids = EFFECTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

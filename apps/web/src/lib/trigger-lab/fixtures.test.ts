import { describe, expect, it } from 'vitest';
import { DEFAULT_KIT, defaultProject, listEffects } from '@ledrums/core';
import { DRUMS, GENERATOR_EFFECTS, PADS } from './fixtures';
import { buildLabModel } from './kit';

describe('GENERATOR_EFFECTS — registry coverage', () => {
  it('surfaces every core generator as a generator-backed effect definition', () => {
    const gens = listEffects();
    expect(GENERATOR_EFFECTS.length).toBe(gens.length);
    for (const gen of gens) {
      const def = GENERATOR_EFFECTS.find((e) => e.generatorId === gen.id);
      expect(def, `EffectDef for ${gen.id}`).toBeTruthy();
      expect(def!.id).toBe(`gen:${gen.id}`);
      expect(def!.category).toBe(gen.category);
      for (const sp of def!.params) {
        if (sp.kind === 'number') expect(Number.isFinite(sp.default as number), `${gen.id}.${sp.key} default`).toBe(true);
      }
    }
  });

  it('no two definitions share an id', () => {
    const ids = GENERATOR_EFFECTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('fixture drum ids resolve against the kit', () => {
  it('the offline lab model is built from the canonical kit (no divergent copy)', () => {
    const labDrumIds = buildLabModel().model.drums.map((d) => d.id);
    expect(labDrumIds).toEqual(DEFAULT_KIT.drums.map((d) => d.id));
  });

  it('every fixture drum exists in the local lab kit (offline preview path)', () => {
    const labDrumIds = new Set(buildLabModel().model.drums.map((d) => d.id));
    for (const d of DRUMS) expect(labDrumIds.has(d.id)).toBe(true);
  });

  it('every fixture drum exists in the canonical engine kit (connected path)', () => {
    const kitDrumIds = new Set(defaultProject().kit.drums.map((d) => d.id));
    for (const d of DRUMS) expect(kitDrumIds.has(d.id)).toBe(true);
  });

  it('every pad names a drum of the canonical kit', () => {
    const kitDrumIds = new Set(DEFAULT_KIT.drums.map((d) => d.id));
    for (const pad of PADS) expect(kitDrumIds.has(pad.drumId)).toBe(true);
  });
});

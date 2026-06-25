import { describe, expect, it } from 'vitest';
import { listEffects } from '@ledrums/core';
import { BUSES, EFFECTS, GENERATOR_EFFECTS, PRESETS, play } from './fixtures';
import { Sim, treeToGraph, type TriggerCtx } from './sim';
import { buildLabModel } from './kit';
import { renderFrame } from './render';

function freshSim(): Sim {
  return new Sim(
    BUSES.map((b) => ({ ...b })),
    [...EFFECTS],
    [...PRESETS],
  );
}

function ctx(drumId = 'kick', velocity = 1): TriggerCtx {
  return { velocity, sectionIndex: 0, sectionCount: 0, beatPhase: 0, sourceDrumId: drumId };
}

/** Fire a generator effect through the sim + offline renderer; return the RGB buffer. */
function renderGen(effectId: string, mode: 'oneshot' | 'loop', drumId = 'kick'): { buf: Uint8Array; lab: ReturnType<typeof buildLabModel> } {
  const lab = buildLabModel();
  const sim = freshSim();
  sim.triggerGraph('test', treeToGraph(play(effectId, mode)), ctx(drumId));
  sim.tick(900); // age past the longest generator attack (800ms) so level is high
  const buf = new Uint8Array(lab.model.count * 3);
  renderFrame(buf, sim, lab);
  return { buf, lab };
}

function litPixelIds(buf: Uint8Array, count: number): number[] {
  const lit: number[] = [];
  for (let i = 0; i < count; i++) {
    const j = i * 3;
    if (buf[j]! > 0 || buf[j + 1]! > 0 || buf[j + 2]! > 0) lit.push(i);
  }
  return lit;
}

describe('generator bridge — registry coverage', () => {
  it('surfaces every core generator as a selectable, generator-backed effect', () => {
    const gens = listEffects();
    expect(gens.length).toBe(41); // all original effects accounted for
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

describe('generator bridge — offline render parity', () => {
  it('offline-renders a kit-wide field generator (plasma) to a lit RGB frame', () => {
    const { buf, lab } = renderGen('gen:plasma', 'loop');
    expect(litPixelIds(buf, lab.model.count).length).toBeGreaterThan(0);
  });

  it('a trigger generator (whole-drum) lights only the struck drum', () => {
    const { buf, lab } = renderGen('gen:whole-drum', 'oneshot', 'snare');
    const snare = lab.model.drums.find((d) => d.id === 'snare')!;
    const lit = litPixelIds(buf, lab.model.count);
    expect(lit.length).toBeGreaterThan(0);
    for (const id of lit) {
      expect(id).toBeGreaterThanOrEqual(snare.pixelStart);
      expect(id).toBeLessThan(snare.pixelStart + snare.pixelCount);
    }
  });

  it('renders every generator effect without throwing and stays within 0..255', () => {
    const lab = buildLabModel();
    for (const def of GENERATOR_EFFECTS) {
      const sim = freshSim();
      sim.triggerGraph('test', treeToGraph(play(def.id, 'loop')), ctx());
      sim.tick(120);
      sim.tick(120);
      const buf = new Uint8Array(lab.model.count * 3);
      expect(() => renderFrame(buf, sim, lab), def.id).not.toThrow();
      for (let i = 0; i < buf.length; i++) {
        const x = buf[i]!;
        expect(Number.isFinite(x) && x >= 0 && x <= 255, `${def.id} channel`).toBe(true);
      }
    }
  });

  it('offline render is deterministic (same inputs → identical buffer)', () => {
    const run = (): number[] => Array.from(renderGen('gen:starfield', 'loop').buf);
    expect(run()).toEqual(run());
  });
});

import { describe, expect, it } from 'vitest';
import { listEffects, type ResolvedModifier } from '@ledrums/core';
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
  return { velocity, sectionIndex: 0, sectionCount: 0, beatPhase: 0, sourceDrumId: drumId, bpm: 120 };
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
    expect(gens.length).toBe(45); // all core effects accounted for
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

describe('generator bridge — voice timebase / restart-on-trigger (S25)', () => {
  // The web offline bridge mirrors the core generator bridge: a `timebase:'voice'` generator
  // (chase) animates on a hit-relative clock, so it starts at its start position on the hit —
  // independent of where the absolute transport happens to be. This is the sim side of the
  // sim/engine parity criterion (the core engine asserts the same in compositor.test.ts).
  it('chase starts at hoop 0 on the hit regardless of the transport clock', () => {
    const lab = buildLabModel();
    const sim = freshSim();
    sim.tick(5000); // run the absolute transport far ahead (sim.beat ≈ 10) BEFORE firing
    sim.triggerGraph('test', treeToGraph(play('gen:chase', 'oneshot')), ctx('kick'));
    sim.tick(100); // chase voice age 100ms → voice-local beat 0.2 → step 0 → hoop 0
    const buf = new Uint8Array(lab.model.count * 3);
    renderFrame(buf, sim, lab);

    const lit = litPixelIds(buf, lab.model.count);
    expect(lit.length).toBeGreaterThan(0);
    // Voice timebase: the onset lands on hoop 0. Under the old absolute clock the same frame
    // would light a mid-cycle hoop (step from sim.beat ≈ 10), so this pins the conversion.
    for (const id of lit) {
      expect(lab.pm.pixels[id]!.hoopIndex, `pixel ${id} hoop`).toBe(0);
    }
  });
});

describe('generator bridge — modifier chain parity (S28)', () => {
  // The offline preview applies a voice's resolved modifier chain through the SAME core
  // `applyModifierChain` the engine compositor uses, on the same genScratch framebuffer the
  // parity harness already establishes — so the modifier behaviour mirrors the engine. These
  // pin the sim side of the parity criterion behaviourally (as S25/S26 do for timebase): a
  // Trail-modified generator voice smears across ticks; bypass is identity.
  const trailChain = (bypass?: boolean): ResolvedModifier[] => [
    { modifierId: 'trail', params: { decayMs: 800, mode: 'add' }, bypass },
  ];

  function totalRgb(buf: Uint8Array): number {
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i]!;
    return s;
  }

  /** Fire a generator, optionally inject a modifier chain on its voice, render across two
      frames (so a temporal modifier has history), and return the final RGB buffer. */
  function renderWithMods(effectId: string, mods: ResolvedModifier[] | undefined): Uint8Array {
    const lab = buildLabModel();
    const sim = freshSim();
    sim.triggerGraph('test', treeToGraph(play(effectId, 'loop')), ctx('kick'));
    sim.tick(120); // spawn + level up
    if (mods) for (const v of sim.voices) v.modifiers = mods;
    const buf = new Uint8Array(lab.model.count * 3);
    renderFrame(buf, sim, lab); // frame 1 — seeds the trail accumulator
    sim.tick(120); // advance dt/time
    renderFrame(buf, sim, lab); // frame 2 — trail adds its decayed history
    return buf;
  }

  it('a Trail-modified generator voice smears — brighter than the unmodified baseline', () => {
    const mod = renderWithMods('gen:plasma', trailChain());
    const base = renderWithMods('gen:plasma', undefined);
    // Additive trail only adds light and leaves a tail → a different, brighter frame.
    expect(Array.from(mod)).not.toEqual(Array.from(base));
    expect(totalRgb(mod)).toBeGreaterThan(totalRgb(base));
  });

  it('a bypassed modifier is identity (matches the unmodified render)', () => {
    const bypassed = renderWithMods('gen:plasma', trailChain(true));
    const base = renderWithMods('gen:plasma', undefined);
    expect(Array.from(bypassed)).toEqual(Array.from(base));
  });

  it('modified offline render is deterministic (same inputs → identical buffer)', () => {
    const run = (): number[] => Array.from(renderWithMods('gen:starfield', trailChain()));
    expect(run()).toEqual(run());
  });
});

describe('generator bridge — voice timebase conversion batch (S26)', () => {
  // The web bridge reads gen.timebase exactly like the core bridge (render.ts:221). A converted
  // clock-reading effect (temp-sweep, one of the S26 batch) must animate on the hit-relative
  // clock: the same voice age renders the same frame regardless of where the absolute transport
  // was when the hit fired. This is the sim side of the sim/engine parity criterion (the core
  // engine asserts birth-time dependence in compositor.test.ts).
  function tempSweepAtAge(warmupMs: number, ageMs: number): { buf: Uint8Array; count: number } {
    const lab = buildLabModel();
    const sim = freshSim();
    if (warmupMs > 0) sim.tick(warmupMs); // advance the absolute transport before firing
    sim.triggerGraph('test', treeToGraph(play('gen:temp-sweep', 'oneshot')), ctx('kick'));
    sim.tick(ageMs); // voice age = ageMs
    const buf = new Uint8Array(lab.model.count * 3);
    renderFrame(buf, sim, lab);
    return { buf, count: lab.model.count };
  }

  it('a converted effect (temp-sweep) reads the hit-relative clock, not the absolute transport', () => {
    const fresh = tempSweepAtAge(0, 200);
    const late = tempSweepAtAge(5000, 200); // transport 5s ahead, same voice age
    expect(litPixelIds(fresh.buf, fresh.count).length).toBeGreaterThan(0);
    // Same voice age (200ms) → identical frame despite a 5s-different transport at firing.
    // Under the old absolute clock these would differ (different wall-clock reads).
    expect(Array.from(late.buf)).toEqual(Array.from(fresh.buf));
  });
});

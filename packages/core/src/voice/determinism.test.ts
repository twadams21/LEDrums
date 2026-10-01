/* Phase-2 item 2 acceptance — ONE RENDER TRUTH at the compositor seam.

   - Replay determinism: two engines fed byte-identical (model, show, inputs, ticks)
     produce byte-identical frames — including RNG-backed generator effects (confetti),
     whose randomness is per-trigger SEEDED, never ambient.
   - Two identical Effects → identical contribution (frame with A+A doubles A, and
     A-only frames from two engines match).
   - Per-trigger seeding (item C): two successive confetti fires DIFFER from each other
     (decorrelated) yet each replays exactly across engines.
   - Retrigger overlap (item C): rapid retriggers spawn independent voices, each running
     its own envelope from its own t=0; the earlier voice finishes uninterrupted.
   - The same Effect on a different hoop of the same drum differs ONLY by geometry mapping. */
import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import type { TransportState } from '../engine/render-context';
import { createVoiceBusEngine, type InputEvent } from './engine';
import type { Show } from './types';
import { effectShowOf, sectionOf, zoneEffect } from './effect-test-fixtures';
import type { Effect } from '../effect-chain/types';

function testModel(): PixelModel {
  const kit = parseKit({
    global: { ledDensityPxPerM: 30, hoopCount: 2, defaultHoopSpacingMm: 50 },
    drums: [
      { id: 'kick', diameterIn: 12, hoopSpacingMm: 50, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
      { id: 'snare', diameterIn: 10, hoopSpacingMm: 50, origin: { x: 300, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
    ],
  });
  return buildPixelModel(kit);
}

/** A kick-zone, kit-target Effect: 10ms attack, 400ms long, 200ms release. */
function fx(id: string, generator: Parameters<typeof zoneEffect>[1], over: Record<string, unknown> = {}): Effect {
  return zoneEffect(id, generator, { amp: { attackMs: 10, length: { ms: 410 }, releaseMs: 200 }, target: { kind: 'kit' }, ...over });
}

const BREATHE = { kind: 'solid', style: 'breathe' } as const;
const CONFETTI = { kind: 'particles', style: 'confetti' } as const;

function showOf(...effects: Effect[]): Show {
  return effectShowOf(sectionOf('s', effects));
}

function transport(now: number, bpm = 120): TransportState {
  const beat = (now / 60000) * bpm;
  return { timeMs: now, beat, bar: Math.floor(beat / 4), beatInBar: beat % 4, bpm, beatsPerBar: 4, playing: true };
}

const hit = (timeMs: number, velocity = 1): InputEvent => ({ kind: 'noteOn', drumId: 'kick', zone: '', velocity, timeMs });

/** Run a scripted session and collect a frame snapshot after every tick. frame() is
    float RGBA (0..1) — snapshot as Float32Array so byte comparisons see real values. */
function run(show: Show, script: Array<{ t: number; hit?: boolean }>): Float32Array[] {
  const e = createVoiceBusEngine();
  e.setModel(testModel());
  e.setShow(show);
  const frames: Float32Array[] = [];
  let last = 0;
  for (const step of script) {
    if (step.hit) e.applyInput(hit(step.t));
    e.tick(step.t, step.t - last, transport(step.t));
    last = step.t;
    frames.push(Float32Array.from(e.frame()));
  }
  return frames;
}

const script = Array.from({ length: 30 }, (_, i) => ({ t: (i + 1) * 16, hit: i === 0 || i === 8 }));

const bytes = (f: Float32Array): Buffer => Buffer.from(f.buffer, f.byteOffset, f.byteLength);

describe('replay determinism at the compositor seam', () => {
  it('two engines fed identical (time, inputs, model) render byte-identical frames — pattern effect', () => {
    const s = (): Show => showOf(fx('fx', BREATHE));
    const a = run(s(), script);
    const b = run(s(), script);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) expect(bytes(a[i]!).equals(bytes(b[i]!))).toBe(true);
  });

  it('… and with a seeded-RNG generator effect (confetti-burst)', () => {
    const s = (): Show => showOf(fx('confetti', CONFETTI));
    const a = run(s(), script);
    const b = run(s(), script);
    // sanity: the session actually lights pixels (a zero session would pass vacuously)
    expect(a.some((f) => f.some((x) => x > 0))).toBe(true);
    for (let i = 0; i < a.length; i++) expect(bytes(a[i]!).equals(bytes(b[i]!))).toBe(true);
  });

  it('two Effects with identical settings contribute identically (A+A = 2×A, clamped additive)', () => {
    const dim = { ...BREATHE, params: { brightness: 0.25 } };
    const one = showOf(fx('a', dim));
    const two = showOf(fx('a', dim), fx('b', dim));
    const fa = run(one, script);
    const fb = run(two, script);
    for (let i = 0; i < fa.length; i++) {
      const a = fa[i]!;
      const b = fb[i]!;
      for (let j = 0; j < a.length; j++) {
        // additive compositor at low brightness: the doubled Effect is 2× (clamped at 1)
        expect(Math.abs(b[j]! - Math.min(1, a[j]! * 2))).toBeLessThanOrEqual(0.01);
      }
    }
  });
});

describe('per-trigger seeding (item C)', () => {
  it('two successive confetti fires differ from each other, yet the whole session replays exactly', () => {
    const s = (): Show => showOf(fx('confetti', CONFETTI));
    // hit at t=16 and t=160; compare each fire's first bright frame
    const twoFires = Array.from({ length: 40 }, (_, i) => ({ t: (i + 1) * 16, hit: i === 0 || i === 9 }));
    const a = run(s(), twoFires);
    const b = run(s(), twoFires);
    // replay: byte-identical
    for (let i = 0; i < a.length; i++) expect(bytes(a[i]!).equals(bytes(b[i]!))).toBe(true);
    // decorrelation: a lit frame of fire 1 vs the same-age frame of fire 2 differ.
    // (A fixed seed would scatter the same particle directions on every fire.)
    const lit = a.findIndex((f) => f.some((x) => x > 0));
    expect(lit).toBeGreaterThanOrEqual(0);
    expect(lit).toBeLessThan(9); // fire 1 lights before fire 2 lands
    expect(bytes(a[lit]!).equals(bytes(a[lit + 9]!))).toBe(false);
  });
});

describe('retrigger overlap (item C)', () => {
  it('rapid retriggers spawn independent overlapping voices, each enveloping from its own t=0', () => {
    const e = createVoiceBusEngine();
    e.setModel(testModel());
    e.setShow(showOf(fx('fx', BREATHE, { amp: { attackMs: 100, length: { ms: 400 }, releaseMs: 200 } })));
    e.applyInput(hit(0));
    e.tick(50, 50, transport(50)); // voice 1 mid-attack (level 0.5)
    e.applyInput(hit(50)); // retrigger while voice 1 is alive
    e.tick(100, 50, transport(100)); // voice 2 spawns this tick (born 100)
    e.tick(150, 50, transport(150)); // voice 2 mid-attack; voice 1 sustaining
    const { voices } = e.stats();
    expect(voices).toHaveLength(2); // both alive — no cutoff
    const levels = voices.map((v) => v.level).sort((x, y) => x - y);
    // voice 2 is 50ms into its 100ms attack (~0.5); voice 1 finished attack (1.0)
    expect(levels[0]!).toBeGreaterThan(0.4);
    expect(levels[0]!).toBeLessThan(0.6);
    expect(levels[1]!).toBeCloseTo(1, 1);
    // earlier voice keeps running to its own natural end
    e.tick(450, 350, transport(450)); // voice 1 past attack+sustain → releasing; voice 2 sustaining
    const after = e.stats().voices;
    expect(after.some((v) => v.releasing)).toBe(true);
    expect(after.some((v) => !v.releasing)).toBe(true);
  });
});

describe('hoop scope — geometry-only difference', () => {
  it('the same Effect on a different hoop of the same drum differs only by pixel range', () => {
    const mk = (hoop: number): Show =>
      showOf(fx('fx', BREATHE, { target: { kind: 'select', drums: [{ drumId: 'kick', hoops: [hoop] }] } }));
    const a = run(mk(1), script); // hoop 1 = first hoop (1-based, A1)
    const b = run(mk(2), script); // hoop 2 = second hoop
    const m = testModel();
    const kick = m.drums.find((d) => d.drumId === 'kick')!;
    const per = kick.pixelsPerHoop;
    const h0 = kick.pixelStart;
    const h1 = kick.pixelStart + per;
    for (let i = 0; i < a.length; i++) {
      const fa = a[i]!;
      const fb = b[i]!;
      // hoop-2 render is hoop-1's, shifted by one hoop range (breathing-kit is geometry-uniform)
      for (let p = 0; p < per; p++) {
        for (let c = 0; c < 4; c++) {
          expect(fb[(h1 + p) * 4 + c]).toBe(fa[(h0 + p) * 4 + c]);
        }
      }
      // and nothing outside its hoop lights
      for (let p = 0; p < per; p++) {
        for (let c = 0; c < 3; c++) expect(fb[(h0 + p) * 4 + c]).toBe(0);
      }
    }
  });
});

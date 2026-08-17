import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import { Framebuffer } from '../engine/framebuffer';
import type { RenderContext, TransportState, Trigger } from '../engine/render-context';
import { defaultParams, type EffectGenerator, type ResolvedParams } from './types';
import { lifeFade } from './life-fade';
import { getEffect } from './registry';

/* F5 — the authored envelope REPLACES the effect's Decay param instead of multiplying on top
   of it. These are frame-level: they render the real generators and read the pixels, because
   the bug this fixes was invisible to every unit test of the curve itself (a `snap` curve at
   gain 1.0 still faded, because the effect's own `1 − age/life` was still running underneath).

   `authoredDecay` on the RenderContext is the one signal, set by the generator bridge and the
   web sim for a voice that carries a curve. */

function model(): PixelModel {
  return buildPixelModel(
    parseKit({
      global: { ledDensityPxPerM: 40, hoopCount: 2, defaultHoopSpacingMm: 50, maxPixelsPerOutput: 100000 },
      drums: [
        { id: 'kick', diameterIn: 22, hoopSpacingMm: 50, pixelsPerHoop: 196, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
        { id: 'snare', diameterIn: 14, hoopSpacingMm: 50, pixelsPerHoop: 108, origin: { x: 600, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
      ],
    }),
  );
}

function transport(beat: number, timeMs: number): TransportState {
  return { timeMs, beat, bar: Math.floor(beat / 4), beatInBar: beat % 4, bpm: 120, beatsPerBar: 4, playing: true };
}

function trig(ageMs: number): Trigger {
  return { seq: 1, drumId: 'kick', note: 60, velocity: 1, ageMs, timeMs: 0 };
}

/** A voice-clock context at `ageMs`, exactly as the generator bridge builds one. */
function ctx(m: PixelModel, ageMs: number, authoredDecay: boolean): RenderContext {
  const beats = (ageMs / 60000) * 120;
  return { model: m, timeMs: ageMs, dt: 16, transport: transport(beats, ageMs), triggers: [trig(ageMs)], authoredDecay };
}

/** Total light in the frame — the one number that says "how bright is this hit right now". */
function energy(fb: Framebuffer): number {
  let sum = 0;
  for (let i = 0; i < fb.rgba.length; i += 4) sum += fb.rgba[i]! + fb.rgba[i + 1]! + fb.rgba[i + 2]!;
  return sum;
}

const FRAME_MS = 16;

/**
 * Render one generator forward to `ageMs` and return the last frame.
 *
 * Stepped rather than sampled: the emitter-backed effects age their emissions off `dt`, so a
 * single render at a jumped clock reads as a brand-new hit and the fade under test never runs.
 */
function renderAt<S>(id: string, m: PixelModel, ageMs: number, authoredDecay: boolean, params: ResolvedParams = {}): Framebuffer {
  const gen = getEffect(id) as EffectGenerator<S>;
  const p = { ...defaultParams(gen.paramSpec), ...params };
  const s = (gen.createState ? gen.createState(m, 123) : undefined) as S;
  let fb = new Framebuffer(m.pixelCount);
  for (let t = 0; t < ageMs; t += FRAME_MS) {
    fb = new Framebuffer(m.pixelCount);
    gen.render(ctx(m, t, authoredDecay), p, fb, s);
  }
  fb = new Framebuffer(m.pixelCount);
  gen.render(ctx(m, ageMs, authoredDecay), p, fb, s);
  return fb;
}

describe('lifeFade — the seam itself', () => {
  it('passes the effect’s own decay straight through when nothing is authored', () => {
    expect(lifeFade({}, 0.37)).toBe(0.37);
    expect(lifeFade({ authoredDecay: false }, 0.37)).toBe(0.37);
  });

  it('suppresses it to 1 — not to 0 — when the voice carries a curve', () => {
    // 1 is the identity for a multiply: the term leaves the product without darkening it, so
    // the only thing shaping the voice is the envelope applied at the voice level.
    expect(lifeFade({ authoredDecay: true }, 0.37)).toBe(1);
    expect(lifeFade({ authoredDecay: true }, 0)).toBe(1);
  });
});

describe('an authored envelope owns the decay', () => {
  const m = model();

  // Both fade shapes the library uses, on both hosting styles: emitter-backed effects that
  // fade on a hard `1 − age/life` (segments, chase-bands) and trigger-backed ones that fade on
  // `exp(−age/τ)` (whole-drum, whole-kit). Effects whose light TRAVELS (radial-wash, sonar)
  // are deliberately not probed by total energy — theirs leaves the kit for spatial reasons
  // that have nothing to do with the decay term, so the measurement would prove nothing.
  for (const [id, params, earlyMs, lateMs] of [
    ['segments', { lifeBeats: 3, fire: 'all' }, 100, 1200],
    ['chase-bands', { lifeBeats: 4 }, 100, 1600],
    ['whole-drum', { decayMs: 220 }, 16, 400],
    ['whole-kit', { decayMs: 260 }, 16, 400],
  ] as const) {
    it(`${id}: fades on its own, holds flat once the curve is authored`, () => {
      const early = energy(renderAt(id, m, earlyMs, false, params));
      const late = energy(renderAt(id, m, lateMs, false, params));
      expect(late).toBeLessThan(early * 0.9); // it really does fade on its own…

      const heldEarly = energy(renderAt(id, m, earlyMs, true, params));
      const heldLate = energy(renderAt(id, m, lateMs, true, params));
      // …and with a curve authored, the effect stops fading itself. The envelope multiplies
      // this frame at the voice level (envelope-tick), so anything the generator takes off
      // here would be a second fade under the drawn one.
      expect(heldLate).toBeGreaterThan(heldEarly * 0.9);
      expect(heldLate).toBeGreaterThan(late);
    });
  }

  it('leaves an effect that declares no decay completely alone', () => {
    // `breathing-kit` has no `voiceLife`, so no envelope is offered for it and the flag can
    // never be set — but the flag must be inert even if a host set it anyway.
    const off = energy(renderAt('breathing-kit', m, 800, false));
    const on = energy(renderAt('breathing-kit', m, 800, true));
    expect(on).toBeCloseTo(off, 10);
  });
});

describe('max brightness scales the output, not the drawn shape', () => {
  const m = model();

  for (const [id, params] of [
    ['whole-drum', { decayMs: 220 }],
    ['segments', { lifeBeats: 3, fire: 'all' }],
  ] as const) {
    it(`${id}: halving brightness halves the light at the same point on the curve`, () => {
      // The envelope's y axis reads 100% at the top and the real output is `shape × max`
      // (Trent, 2026-08-17). `max` is the effect's OWN brightness param — the multiply already
      // inside every generator — so this is the whole of "reduced behind the scenes".
      const full = energy(renderAt(id, m, 60, true, { ...params, brightness: 1 }));
      const half = energy(renderAt(id, m, 60, true, { ...params, brightness: 0.5 }));
      expect(half).toBeGreaterThan(0);
      expect(half).toBeCloseTo(full * 0.5, 1);
    });
  }
});

/* Shared test harness for the core effect suites (batch-a..e, effects.test,
   u6-gap-fill). PURE module: no vitest import may enter packages/core/src —
   the finite check ships as `finite01Failures`, asserted empty at call sites.
   `drums` is REQUIRED on `model` because the historical per-file defaults
   disagreed (2 vs 1); an explicit argument at every call site is the guard. */
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import { Framebuffer } from '../engine/framebuffer';
import type { RenderContext, TransportState, Trigger } from '../engine/render-context';
import { defaultParams, type EffectGenerator, type ResolvedParams } from '../effects/types';

export function model(drums: number, hoopCount = 4): PixelModel {
  const drumDefs = [];
  for (let i = 0; i < drums; i++) {
    drumDefs.push({
      id: `d${i}`,
      diameterIn: 8,
      hoopSpacingMm: 50,
      origin: { x: i * 600, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    });
  }
  return buildPixelModel(
    parseKit({
      global: { ledDensityPxPerM: 40, hoopCount, defaultHoopSpacingMm: 50, maxPixelsPerOutput: 100000 },
      drums: drumDefs,
    }),
  );
}

export function transport(beat = 0, timeMs = 0): TransportState {
  return { timeMs, beat, bar: Math.floor(beat / 4), beatInBar: beat % 4, bpm: 120, beatsPerBar: 4, playing: true };
}

export function ctx(m: PixelModel, opts: Partial<RenderContext> = {}): RenderContext {
  return {
    model: m,
    timeMs: opts.timeMs ?? 0,
    dt: opts.dt ?? 16,
    transport: opts.transport ?? transport(0, opts.timeMs ?? 0),
    triggers: opts.triggers ?? [],
  };
}

export function trig(seq: number, drumId: string, note: number, velocity: number, ageMs: number): Trigger {
  return { seq, drumId, note, velocity, ageMs, timeMs: 0 };
}

/* `seed` is passed through to `effect.createState(m, seed)`; since types.ts
   declares `createState?(model, seed?)`, an undefined seed is indistinguishable
   from omitting it — only u6-gap-fill passes 123. */
export function render<S>(
  effect: EffectGenerator<S>,
  m: PixelModel,
  c: RenderContext,
  params?: ResolvedParams,
  state?: S,
  seed?: number,
): Framebuffer {
  const fb = new Framebuffer(m.pixelCount);
  const p = { ...defaultParams(effect.paramSpec), ...params };
  const s = state ?? (effect.createState ? effect.createState(m, seed) : (undefined as S));
  effect.render(c, p, fb, s);
  return fb;
}

export function litCount(fb: Framebuffer): number {
  let n = 0;
  for (let i = 0; i < fb.pixelCount; i++) {
    const j = i * 4;
    if (fb.rgba[j]! > 0.004 || fb.rgba[j + 1]! > 0.004 || fb.rgba[j + 2]! > 0.004) n++;
  }
  return n;
}

export function litIds(fb: Framebuffer): number[] {
  const out: number[] = [];
  for (let i = 0; i < fb.pixelCount; i++) {
    const j = i * 4;
    if (fb.rgba[j]! > 0.004 || fb.rgba[j + 1]! > 0.004 || fb.rgba[j + 2]! > 0.004) out.push(i);
  }
  return out;
}

/** Every channel must be a finite number within [0,1]. */
export function allFinite01(fb: Framebuffer): boolean {
  for (let i = 0; i < fb.rgba.length; i++) {
    const v = fb.rgba[i]!;
    if (!Number.isFinite(v) || v < 0 || v > 1) return false;
  }
  return true;
}

/** Per-channel finite/[0,1] check; returns the offending channel diagnostics
    (empty when clean). Callers assert `expect(finite01Failures(fb, id)).toEqual([])`. */
export function finite01Failures(fb: Framebuffer, id: string): string[] {
  const failures: string[] = [];
  for (let i = 0; i < fb.rgba.length; i++) {
    const v = fb.rgba[i]!;
    if (!Number.isFinite(v)) failures.push(`${id} channel ${i}`);
    else if (v < 0 || v > 1) failures.push(`${id} channel ${i} = ${v}`);
  }
  return failures;
}

/* Renders a single frame of a generator-backed effect into the thumbnail grid
   (26×13 pixels). Used by EffectThumb.svelte to display live previews of generator
   effects, mirroring the approach used in render.ts for full voice rendering.

   Uses a small synthetic PixelModel (`buildThumbPixelModel`) so generator output
   maps cleanly onto the 26×13 canvas — pixel index i ↔ grid cell i, no remapping.
   Returns actual per-pixel RGB read straight from the Framebuffer so colours are
   faithful (no rgbToHue round-trip). */

import {
  Framebuffer,
  defaultParams as genDefaultParams,
  tryGetEffect,
  type RenderContext,
  type ResolvedParams,
  type Trigger,
} from '@ledrums/core';
import type { ParamValues } from './sim';
import { buildThumbPixelModel } from './kit';

/**
 * The thumbnail replays ONE synthetic hit forever. The trigger age sawtooths over
 * this window (0 → LOOP → 0), so hit-relative effects (whole-drum, burst, radial-wash…)
 * visibly fire → decay → repeat instead of freezing at their age-0 frame. At 120bpm
 * this is 3.2 beats — enough for beat-indexed voice effects (chase) to travel and reset.
 */
export const THUMB_LOOP_MS = 1600;

// ---- Generator caching -------------------------------------------------------
const genCache = new Map<string, Framebuffer>();
const genDefaults = new Map<string, ResolvedParams>();
// One synthetic trigger, mutated per render — the thumbnail's own originating hit.
// `drumId: 'thumb'` matches buildThumbPixelModel's single drum so drum-keyed effects
// (whole-drum, burst, radial-wash) actually find their drum and light up.
const genTrigger: Trigger = { seq: 1, drumId: 'thumb', note: 0, velocity: 1, timeMs: 0, ageMs: 0 };
const genTriggers: Trigger[] = [genTrigger];

/**
 * Render one frame of a generator effect onto the thumbnail grid (26×13 = 338 pixels).
 *
 * Returns per-pixel [r, g, b] in 0..1 in row-major grid order so that
 * `pixels[r * 26 + c]` is the RGB for grid cell (column c, row r).
 * Returns null if the generator is not registered.
 *
 * Timebase-aware, mirroring the two render bridges (generator-bridge.ts / render.ts):
 * the synthetic trigger's age loops over {@link THUMB_LOOP_MS} so hit-relative effects
 * fire → decay → repeat. A `timebase: 'voice'` generator animates on that hit-relative
 * age (its own onset, restarting each loop); a `timebase: 'absolute'` generator keeps
 * free-running on the wall-clock `tMs`. Read the flag exactly as the bridges do:
 * `(gen.timebase ?? 'absolute') === 'voice'`.
 *
 * @param generatorId  The generator's registered ID (e.g. "plasma", "fire")
 * @param params       Voice parameters (numeric/bool only; color/enum fall back to defaults)
 * @param tMs          Wall-clock time in milliseconds (e.g. performance.now()); the
 *                     hit-relative loop age is derived as `tMs % THUMB_LOOP_MS`
 * @param state        Generator state; caller should create with `gen.createState(buildThumbPixelModel())`
 */
export function renderGeneratorThumbFrame(
  generatorId: string,
  params: ParamValues,
  tMs: number,
  state?: unknown,
): [number, number, number][] | null {
  const gen = tryGetEffect(generatorId);
  if (!gen) return null;

  const pm = buildThumbPixelModel();
  const pixelCount = pm.pixelCount; // 26 × 13 = 338

  // Reuse or create Framebuffer for this generator.
  let buf = genCache.get(generatorId);
  if (!buf || buf.pixelCount !== pixelCount) {
    buf = new Framebuffer(pixelCount);
    genCache.set(generatorId, buf);
  }

  // Resolve params: generator defaults overlaid with voice numeric/bool params.
  let defs = genDefaults.get(generatorId);
  if (!defs) {
    defs = genDefaultParams(gen.paramSpec);
    genDefaults.set(generatorId, defs);
  }
  const resolvedParams: ResolvedParams = { ...defs };
  for (const k in params) {
    const val = params[k];
    if (val !== undefined) resolvedParams[k] = val;
  }

  // Looping hit age: the thumbnail's synthetic hit, replayed forever. Drives
  // trig.ageMs so effects that decay off the trigger age (whole-drum, burst, …)
  // fire → decay → repeat. Modulo keeps a monotonic wall-clock `tMs` bounded to
  // [0, THUMB_LOOP_MS); the extra `+ LOOP) % LOOP` guards a negative input.
  const ageMs = ((tMs % THUMB_LOOP_MS) + THUMB_LOOP_MS) % THUMB_LOOP_MS;
  genTrigger.ageMs = ageMs;
  genTrigger.timeMs = tMs - ageMs; // notional birth so timeMs = born + age stays coherent

  // Timebase decides the clock the generator's ctx reads — same switch as the bridges.
  //   'voice'    → hit-relative age: animate from the onset, restart each loop.
  //   'absolute' → engine wall-clock: free-running base/ambient loops keep phasing.
  const isVoice = (gen.timebase ?? 'absolute') === 'voice';
  const clockMs = isVoice ? ageMs : tMs;

  // Advance the transport beat from that same clock (beat = clock × bpm / 60000), the
  // formula both bridges use, so beat-indexed effects (chase) step instead of freezing.
  const BPM = 120;
  const BEATS_PER_BAR = 4;
  const beat = (clockMs / 60000) * BPM;
  const bar = Math.floor(beat / BEATS_PER_BAR);

  const ctx: RenderContext = {
    model: pm,
    timeMs: clockMs,
    dt: 16.67, // ~60fps nominal
    transport: {
      timeMs: clockMs,
      beat,
      bar,
      beatInBar: beat - bar * BEATS_PER_BAR,
      bpm: BPM,
      beatsPerBar: BEATS_PER_BAR,
      playing: true,
    },
    triggers: genTriggers,
  };

  // Render into the Framebuffer.
  buf.clear();
  gen.render(ctx, resolvedParams, buf, state);

  // Read back raw RGB — the generator owns its colours; no hue conversion.
  const src = buf.rgba;
  const result: [number, number, number][] = [];
  for (let i = 0; i < pixelCount; i++) {
    const j4 = i * 4;
    result.push([src[j4]!, src[j4 + 1]!, src[j4 + 2]!]);
  }
  return result;
}

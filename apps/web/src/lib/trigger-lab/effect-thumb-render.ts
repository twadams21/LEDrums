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

// ---- Generator caching -------------------------------------------------------
const genCache = new Map<string, Framebuffer>();
const genDefaults = new Map<string, ResolvedParams>();
const genTrigger: Trigger = { seq: 1, drumId: '', note: 0, velocity: 1, timeMs: 0, ageMs: 0 };
const genTriggers: Trigger[] = [genTrigger];

/**
 * Render one frame of a generator effect onto the thumbnail grid (26×13 = 338 pixels).
 *
 * Returns per-pixel [r, g, b] in 0..1 in row-major grid order so that
 * `pixels[r * 26 + c]` is the RGB for grid cell (column c, row r).
 * Returns null if the generator is not registered.
 *
 * @param generatorId  The generator's registered ID (e.g. "plasma", "fire")
 * @param params       Voice parameters (numeric/bool only; color/enum fall back to defaults)
 * @param tMs          Absolute time in milliseconds
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

  // Build a minimal synthetic RenderContext (BPM 120, no beat sync needed for thumbnail).
  const ctx: RenderContext = {
    model: pm,
    timeMs: tMs,
    dt: 16.67, // ~60fps nominal
    transport: {
      timeMs: tMs,
      beat: 0,
      bar: 0,
      beatInBar: 0,
      bpm: 120,
      beatsPerBar: 4,
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

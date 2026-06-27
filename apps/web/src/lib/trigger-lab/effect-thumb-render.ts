/* Renders a single frame of a generator-backed effect into a small thumbnail grid
   (26×13 pixels). Used by EffectThumb.svelte to display live previews of generator
   effects, mirroring the approach used in render.ts for full voice rendering.

   Caches Framebuffer and default params per generator to minimize allocations. */

import {
  Framebuffer,
  defaultParams as genDefaultParams,
  tryGetEffect,
  type PixelModel,
  type RenderContext,
  type ResolvedParams,
  type Trigger,
} from '@ledrums/core';
import type { ParamValues } from './sim';

const num = (v: number | boolean | undefined, d: number) => (typeof v === 'number' ? v : d);

// ---- Generator caching and state -------------------------------------------
const genCache = new Map<string, Framebuffer>();
const genDefaults = new Map<string, ResolvedParams>();
const genTrigger: Trigger = { seq: 1, drumId: '', note: 0, velocity: 1, timeMs: 0, ageMs: 0 };
const genTriggers: Trigger[] = [genTrigger];

/**
 * Render one frame of a generator effect onto a thumbnail grid.
 *
 * @param generatorId - The generator's registered ID (e.g. "plasma", "fire")
 * @param params - Voice parameters (number/bool only; color/enum fallback to generator defaults)
 * @param tMs - Absolute time in milliseconds
 * @param pm - The underlying PixelModel (provides pixelCount and geometry for the generator)
 * @param state - Generator state object; caller should initialize via `gen.createState(pm)` and maintain across frames
 * @returns Per-pixel [intensity 0..1, hueOffset deg] tuple, or null if generator not found
 */
export function renderGeneratorThumbFrame(
  generatorId: string,
  params: ParamValues,
  tMs: number,
  pm: PixelModel,
  state?: any,
): [number, number][] | null {
  const gen = tryGetEffect(generatorId);
  if (!gen) return null;

  // Reuse or create Framebuffer for this generator.
  let buf = genCache.get(generatorId);
  if (!buf || buf.pixelCount !== pm.pixelCount) {
    buf = new Framebuffer(pm.pixelCount);
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

  // Read back RGBA as [intensity, hueOffset] per pixel.
  const src = buf.rgba;
  const result: [number, number][] = [];
  for (let i = 0; i < pm.pixelCount; i++) {
    const j4 = i * 4;
    const r = src[j4]!;
    const g = src[j4 + 1]!;
    const b = src[j4 + 2]!;
    // Compute intensity as max(r, g, b) and hue from RGB.
    const intensity = Math.max(r, g, b);
    const hue = rgbToHue(r, g, b);
    result.push([intensity, hue]);
  }
  return result;
}

/**
 * Convert RGB (0..1) to hue in degrees (0..360).
 * Returns 0 if the color is achromatic (gray).
 */
function rgbToHue(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  if (delta < 0.001) return 0; // achromatic

  let hue = 0;
  if (max === r) {
    hue = (60 * (((g - b) / delta) % 6)) % 360;
  } else if (max === g) {
    hue = (60 * ((b - r) / delta + 2)) % 360;
  } else {
    hue = (60 * ((r - g) / delta + 4)) % 360;
  }

  return hue < 0 ? hue + 360 : hue;
}

/* Per-pixel pattern renderer for the lab's 3D kit preview. Each effect samples a
   procedural pattern over time + pixel position, shaped by its PARAMETERS (hue,
   speed, bands, angle, width, density, tempo-sync) and per-param ENVELOPES that
   sweep a value over the voice's life. Throwaway — stand-in for packages/core. */

import { sampleEnvelope, type ParamValues, type Pattern, type Sim, type Voice } from './sim';
import type { LabModel, PixelAttrs } from './kit';
import { hueToRgb } from './kit';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const num = (v: number | boolean | undefined, d: number) => (typeof v === 'number' ? v : d);

function hash(n: number): number {
  const s = Math.sin(n) * 43758.5453;
  return s - Math.floor(s);
}

/** Resolve a voice's params for this frame: apply envelopes + tempo sync. */
function effectiveParams(v: Voice, sim: Sim): ParamValues {
  const out: ParamValues = { ...v.params };
  const eff = sim.effect(v.effectId);
  const phase = sim.voicePhase(v);
  for (const key of Object.keys(v.env)) {
    const env = v.env[key];
    if (!env || env.kind === 'none') continue;
    const spec = eff?.params.find((s) => s.key === key);
    if (!spec || spec.kind !== 'number') continue;
    const lo = spec.min ?? 0;
    const hi = spec.max ?? 1;
    const base = num(v.params[key], lo);
    const target = lo + sampleEnvelope(env, phase) * (hi - lo);
    out[key] = base + (target - base) * env.amount; // amount = sweep depth
  }
  if (out.tempoSync === true) out.speed = num(out.speed, 1) * (sim.bpm / 120);
  return out;
}

/** Returns [intensity 0..1, hueOffset deg] for a pixel given pattern + params. */
function sample(pattern: Pattern, t: number, i: number, a: PixelAttrs, p: ParamValues): [number, number] {
  const tt = t * num(p.speed, 1);
  const ang = a.angle01[i]!;
  const n = a.norm01[i]!;
  const x = a.nx[i]!;
  const y = a.ny[i]!;
  const z = a.nz[i]!;
  switch (pattern) {
    case 'flash':
      return [1, 0];
    case 'strobe':
      return [(tt * 11) % 1 < 0.5 ? 1 : 0.04, 0];
    case 'chase': {
      const width = num(p.width, 0.13);
      const phase = (tt * 0.9) % 1;
      let d = Math.abs(ang - phase);
      d = Math.min(d, 1 - d);
      return [clamp01(1 - d / width), 0];
    }
    case 'sparkle': {
      const density = num(p.density, 0.3);
      const h = hash(i * 1.37 + Math.floor(tt * 9) * 53.7);
      return [h > 1 - density ? 0.35 + 0.65 * h : 0.03, 0];
    }
    case 'ripple': {
      const bands = num(p.bands, 4);
      return [clamp01(0.15 + 0.85 * Math.max(0, Math.sin(n * bands * 3 - tt * 7.5))), 0];
    }
    case 'swirl': {
      const bands = num(p.bands, 2);
      const angle = num(p.angle, 0);
      return [0.4 + 0.6 * (0.5 + 0.5 * Math.sin(ang * TAU * bands + tt * 1.6 + angle * DEG)), (ang * 70) % 360];
    }
    case 'aurora':
      return [0.35 + 0.65 * (0.5 + 0.5 * Math.sin(y * 4 + tt * 0.8 + x * 1.6)), (y * 90) % 360];
    case 'drift':
      return [0.35 + 0.65 * (0.5 + 0.5 * Math.sin(x * 3 - tt * 0.7 + z)), 0];
    case 'radial': {
      const r = Math.sqrt((x - 0.5) ** 2 + (y - 0.5) ** 2 + (z - 0.5) ** 2);
      return [0.2 + 0.8 * (0.5 + 0.5 * Math.sin(r * 9 - tt * 4.5)), 0];
    }
    case 'haze':
      return [0.45 + 0.25 * Math.sin(tt * 1.2) + 0.18 * Math.sin(y * 3 + tt * 0.5), 0];
  }
}

/** Sample a pattern with explicit params (for the static thumbnails). */
export function sampleWith(pattern: Pattern, t: number, i: number, a: PixelAttrs, p: ParamValues): [number, number] {
  return sample(pattern, t, i, a, p);
}

/** Composite every live voice into `buf` (RGB triples), additive over black. */
export function renderFrame(buf: Uint8Array, sim: Sim, lab: LabModel): void {
  buf.fill(0);
  const { model, attrs } = lab;
  const t = sim.timeMs / 1000;

  for (const v of sim.voices) {
    const level = sim.voiceLevel(v);
    if (level <= 0.003) continue;
    const p = effectiveParams(v, sim);
    const hue = num(p.hue, 0);
    const amp = level * num(p.brightness, 1);
    if (amp <= 0.003) continue;

    let start = 0;
    let end = model.count;
    if (v.scope === 'drum' && v.sourceDrumId != null) {
      const d = model.drums.find((dd) => dd.id === v.sourceDrumId);
      if (!d) continue;
      start = d.pixelStart;
      end = d.pixelStart + d.pixelCount;
    }

    for (let i = start; i < end; i++) {
      const [si, hueOff] = sample(v.pattern, t, i, attrs, p);
      const inten = si * amp;
      if (inten <= 0.004) continue;
      const [r, g, b] = hueToRgb(hue + hueOff, inten);
      const j = i * 3;
      buf[j] = Math.min(255, buf[j]! + r);
      buf[j + 1] = Math.min(255, buf[j + 1]! + g);
      buf[j + 2] = Math.min(255, buf[j + 2]! + b);
    }
  }
}

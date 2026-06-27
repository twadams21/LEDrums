/**
 * Pattern voice fast path — the per-pixel procedural sampler (ported from the throwaway
 * `trigger-lab/render.ts` `sample()` renderer) plus the masked accumulation loop that
 * writes a pattern voice into the destination {@link Framebuffer}. This is the inner
 * hotspot: zero-alloc (two small scratch vectors reused across all voices in a frame),
 * deterministic (sparkle uses a position/time hash, never `Math.random`).
 *
 * Geometry the sampler reads is precomputed ONCE at model build into the SoA Float32
 * {@link PixelAttrs} buffers — the hot path never recomputes geometry.
 */
import type { Framebuffer } from '../engine/framebuffer';
import type { PixelModel } from '../geometry/pixel-model';
import type { ParamValues, Pattern, Voice } from './types';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const num = (v: number | boolean | undefined, d: number): number => (typeof v === 'number' ? v : d);

/**
 * Per-pixel attributes the pattern renderer samples, precomputed ONCE at model build
 * as Structure-of-Arrays Float32 buffers (parallel to the frame). The compositor
 * reads these; it never recomputes geometry on the hot path.
 */
export interface PixelAttrs {
  /** 0..1 around the hoop. */
  angle01: Float32Array;
  /** 0..1 along the hoops, head → shell. */
  norm01: Float32Array;
  /** normalized world position within kit bounds, per axis 0..1. */
  nx: Float32Array;
  ny: Float32Array;
  nz: Float32Array;
}

/** Build the SoA per-pixel attribute buffers from a pixel model (cold path). */
export function buildPixelAttrs(model: PixelModel): PixelAttrs {
  const count = model.pixelCount;
  const angle01 = new Float32Array(count);
  const norm01 = new Float32Array(count);
  const nx = new Float32Array(count);
  const ny = new Float32Array(count);
  const nz = new Float32Array(count);
  const { min, max } = model.bounds;
  const rx = max.x - min.x || 1;
  const ry = max.y - min.y || 1;
  const rz = max.z - min.z || 1;
  let i = 0;
  for (const p of model.pixels) {
    angle01[i] = ((((p.angleDeg % 360) + 360) % 360) / 360);
    norm01[i] = p.normHoop;
    nx[i] = (p.world.x - min.x) / rx;
    ny[i] = (p.world.y - min.y) / ry;
    nz[i] = (p.world.z - min.z) / rz;
    i++;
  }
  return { angle01, norm01, nx, ny, nz };
}

/** Deterministic hash 0..1 (no `Math.random`) — drives the sparkle pattern. */
function hash(n: number): number {
  const s = Math.sin(n) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * HSL-ish hue (deg) → linear RGB, brightness scaled by `level`. Writes into `out`
 * (3 floats 0..1) to avoid per-pixel array allocation. Ported from `kit.ts`
 * `hueToRgb`, but emits 0..1 floats (the Framebuffer is float RGBA) instead of 0..255.
 */
function hueToRgb(hue: number, level: number, out: Float32Array): void {
  const s = 0.85;
  const l = 0.55;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((((hue % 360) + 360) % 360) / 60);
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) {
    r = c;
    g = x;
  } else if (hp < 2) {
    r = x;
    g = c;
  } else if (hp < 3) {
    g = c;
    b = x;
  } else if (hp < 4) {
    g = x;
    b = c;
  } else if (hp < 5) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const m = l - c / 2;
  const k = clamp01(level);
  out[0] = (r + m) * k;
  out[1] = (g + m) * k;
  out[2] = (b + m) * k;
}

/**
 * Sample a pattern at pixel `i`: writes [intensity 0..1, hueOffset deg] into `out`.
 * Ported verbatim from `render.ts` `sample()`. Zero-alloc (out reused).
 */
function sample(pattern: Pattern, t: number, i: number, a: PixelAttrs, p: ParamValues, out: Float32Array): void {
  const tt = t * num(p.speed, 1);
  const ang = a.angle01[i]!;
  const n = a.norm01[i]!;
  const x = a.nx[i]!;
  const y = a.ny[i]!;
  const z = a.nz[i]!;
  switch (pattern) {
    case 'flash':
      out[0] = 1;
      out[1] = 0;
      return;
    case 'strobe':
      out[0] = (tt * 11) % 1 < 0.5 ? 1 : 0.04;
      out[1] = 0;
      return;
    case 'chase': {
      const width = num(p.width, 0.13);
      const phase = (tt * 0.9) % 1;
      let d = Math.abs(ang - phase);
      d = Math.min(d, 1 - d);
      out[0] = clamp01(1 - d / width);
      out[1] = 0;
      return;
    }
    case 'sparkle': {
      const density = num(p.density, 0.3);
      const h = hash(i * 1.37 + Math.floor(tt * 9) * 53.7);
      out[0] = h > 1 - density ? 0.35 + 0.65 * h : 0.03;
      out[1] = 0;
      return;
    }
    case 'ripple': {
      const bands = num(p.bands, 4);
      out[0] = clamp01(0.15 + 0.85 * Math.max(0, Math.sin(n * bands * 3 - tt * 7.5)));
      out[1] = 0;
      return;
    }
    case 'swirl': {
      const bands = num(p.bands, 2);
      const angle = num(p.angle, 0);
      out[0] = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(ang * TAU * bands + tt * 1.6 + angle * DEG));
      out[1] = (ang * 70) % 360;
      return;
    }
    case 'aurora':
      out[0] = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(y * 4 + tt * 0.8 + x * 1.6));
      out[1] = (y * 90) % 360;
      return;
    case 'drift':
      out[0] = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(x * 3 - tt * 0.7 + z));
      out[1] = 0;
      return;
    case 'radial': {
      const r = Math.sqrt((x - 0.5) ** 2 + (y - 0.5) ** 2 + (z - 0.5) ** 2);
      out[0] = 0.2 + 0.8 * (0.5 + 0.5 * Math.sin(r * 9 - tt * 4.5));
      out[1] = 0;
      return;
    }
    case 'haze':
      out[0] = 0.45 + 0.25 * Math.sin(tt * 1.2) + 0.18 * Math.sin(y * 3 + tt * 0.5);
      out[1] = 0;
      return;
  }
}

/** Voices → pixels via the procedural pattern fast path. Owns the reused per-pixel
    scratch so the hot loop never allocates. */
export interface PatternRenderer {
  /**
   * Accumulate one pattern voice into `dst` over pixel range `[start, end)`, scaled by
   * `level` (voice envelope × deck gain) and the voice's `brightness` param. `t` is the
   * frame time in seconds.
   */
  renderVoice(
    v: Voice,
    t: number,
    level: number,
    start: number,
    end: number,
    attrs: PixelAttrs,
    dst: Framebuffer,
  ): void;
}

export function createPatternRenderer(): PatternRenderer {
  const sampleOut = new Float32Array(2); // [intensity, hueOffset]
  const rgb = new Float32Array(3);

  return {
    renderVoice(v, t, level, start, end, attrs, dst): void {
      const p = v.liveParams;
      const hue = num(p.hue, 0);
      const amp = level * num(p.brightness, 1);
      if (amp <= 0.003) return;

      for (let i = start; i < end; i++) {
        sample(v.pattern, t, i, attrs, p, sampleOut);
        const inten = sampleOut[0]! * amp;
        if (inten <= 0.004) continue;
        hueToRgb(hue + sampleOut[1]!, inten, rgb);
        dst.add(i, rgb[0]!, rgb[1]!, rgb[2]!, inten);
      }
    },
  };
}

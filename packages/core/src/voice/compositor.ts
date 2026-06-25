/**
 * Inner seam — the voices → pixels hotspot. {@link Compositor.render} accumulates each
 * live voice into the destination {@link Framebuffer}. A voice renders one of two ways:
 *
 * - **Pattern voice** (fast path): samples a lightweight procedural {@link Pattern}
 *   per pixel (ported from the throwaway `trigger-lab/render.ts` `sample()` renderer).
 * - **Generator voice** (bridge): hosts a legacy {@link import('../effects/types').EffectGenerator}
 *   from `effects/registry` — the compositor builds a {@link RenderContext}, keeps the
 *   voice's per-instance generator state, renders the whole-frame generator into a
 *   reused scratch framebuffer, then composites it into `dst` scaled by the voice
 *   envelope and masked to the drum range for `scope==='drum'`. This is how all 41
 *   original effects reach real output without being rewritten as per-pixel patterns.
 *
 * Deterministic: no IO, no wall-clock, no `Math.random` (sparkle uses a position/time
 * hash; legacy generators carry seeded RNG in their state). The voice model has no live
 * trigger stream, so a generator voice is fed ONE synthetic trigger representing its own
 * originating hit (age grows with the voice; seq is stable so accumulators fire once).
 *
 * This is the perf hotspot the design wants swappable — keep the interface narrow so
 * a SIMD-ish / batched / WASM variant can drop in without touching voices or host.
 */
import { Framebuffer } from '../engine/framebuffer';
import type { PixelModel } from '../geometry/pixel-model';
import type { RenderContext, TransportState, Trigger } from '../engine/render-context';
import { defaultParams, type ResolvedParams } from '../effects/types';
import { tryGetEffect } from '../effects/registry';
import { sampleEnvelope } from './envelope';
import type { ParamSpec, ParamValues, Pattern, Voice } from './types';

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
 * 0..1 progress through a voice's life — drives param envelopes. Ported from
 * `Sim.voicePhase`: one-shots run across their full A+S+R; sustained voices loop a
 * fixed 1.5s window.
 */
export function voicePhase(v: Voice, timeMs: number): number {
  const age = timeMs - v.bornAtMs;
  if (v.mode === 'oneshot') {
    const life = Math.max(1, v.attackMs + v.sustainMs + v.releaseMs);
    return Math.min(1, age / life);
  }
  return (age / 1500) % 1;
}

/**
 * Resolve a voice's live params for this frame: apply envelopes over its life phase,
 * then tempo-sync. Ported from `render.ts` `effectiveParams`. Writes into the voice's
 * reused `liveParams` scratch (zero-alloc on the hot path) and returns it.
 *
 * `bpm` is supplied by the engine (which owns transport); the compositor reads the
 * already-resolved `liveParams`, keeping its `render` signature narrow.
 */
export function applyEffectiveParams(v: Voice, timeMs: number, bpm: number): ParamValues {
  const out = v.liveParams;
  // Refill the scratch from the spawn snapshot.
  for (const k of Object.keys(out)) delete out[k];
  for (const k of Object.keys(v.params)) out[k] = v.params[k]!;
  const phase = voicePhase(v, timeMs);
  for (const key of Object.keys(v.env)) {
    const env = v.env[key];
    if (!env || env.kind === 'none') continue;
    const spec = specFor(v.specs, key);
    if (!spec || spec.kind !== 'number') continue;
    const lo = spec.min ?? 0;
    const hi = spec.max ?? 1;
    const base = num(v.params[key], lo);
    const target = lo + sampleEnvelope(env, phase) * (hi - lo);
    out[key] = base + (target - base) * env.amount; // amount = sweep depth
  }
  if (out.tempoSync === true) out.speed = num(out.speed, 1) * (bpm / 120);
  return out;
}

function specFor(specs: ParamSpec[], key: string): ParamSpec | undefined {
  for (const s of specs) if (s.key === key) return s;
  return undefined;
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

/**
 * Per-frame context the host supplies to {@link Compositor.render}. `timeMs` drives the
 * pattern fast path; `dt` + `transport` additionally feed hosted generators (transport
 * beat for tempo-locked effects, dt for stateful accumulators / particles).
 */
export interface CompositorFrame {
  timeMs: number;
  dt: number;
  transport: TransportState;
}

/** Voices → pixels. The inner seam. */
export interface Compositor {
  render(
    voices: readonly Voice[],
    model: PixelModel,
    attrs: PixelAttrs,
    frame: CompositorFrame,
    dst: Framebuffer,
  ): void;
}

/**
 * The default compositor: additive accumulation of every live voice into `dst`.
 * Drum-scoped voices touch only their drum's pixel range. Assumes each voice's
 * `liveParams` was refreshed (by the engine) for this frame.
 *
 * Zero-alloc on the pattern fast path (reuses two small scratch vectors). The
 * hosted-generator path reuses one scratch {@link Framebuffer}, one {@link RenderContext},
 * and one {@link Trigger} across all voices in the frame; the only per-generator-voice
 * allocation is the merged params object (generator defaults overlaid with live params)
 * — see the perf note in the report. Generators run far fewer voices (mono buses, level
 * gating) than the per-pixel pattern path, so this stays well within budget in practice.
 */
export function createDefaultCompositor(): Compositor {
  const sampleOut = new Float32Array(2); // [intensity, hueOffset]
  const rgb = new Float32Array(3);

  // --- hosted-generator bridge scratch (lazily sized; reused across voices) ---
  let genScratch: Framebuffer | null = null;
  /** Cached default param record per generator id (incl. enum/colour string defaults). */
  const genDefaults = new Map<string, ResolvedParams>();
  /** One synthetic trigger, mutated per generator voice (the voice's own hit). */
  const genTrigger: Trigger = { seq: 1, drumId: '', note: 0, velocity: 1, timeMs: 0, ageMs: 0 };
  const genTriggers: Trigger[] = [genTrigger];
  /** Reused RenderContext (rebuilt only when the model identity changes). */
  let genCtx: RenderContext | null = null;

  return {
    render(voices, model, attrs, frame, dst): void {
      dst.clear();
      const timeMs = frame.timeMs;
      const t = timeMs / 1000;

      // Refresh the reusable hosted-generator RenderContext for this frame. The
      // triggers array reference is stable; its single element is mutated per voice.
      if (!genCtx || genCtx.model !== model) {
        genCtx = { model, timeMs, dt: frame.dt, transport: frame.transport, triggers: genTriggers };
      } else {
        genCtx.timeMs = timeMs;
        genCtx.dt = frame.dt;
        genCtx.transport = frame.transport;
      }

      for (const v of voices) {
        if (!v.active) continue;
        const level = v.level * v.deckGain;
        if (level <= 0.003) continue;

        let start = 0;
        let end = model.pixelCount;
        if (v.scope === 'drum' && v.sourceDrumId != null) {
          const d = model.drumById.get(v.sourceDrumId);
          if (!d) continue;
          start = d.pixelStart;
          end = d.pixelStart + d.pixelCount;
        }

        // --- hosted legacy-generator voice -----------------------------------
        if (v.generatorId) {
          const gen = tryGetEffect(v.generatorId);
          if (!gen) continue; // unknown id → render nothing (don't fall through to pattern)
          if (!genScratch || genScratch.pixelCount !== model.pixelCount) {
            genScratch = new Framebuffer(model.pixelCount);
          }
          // Build per-voice state lazily and persist it for the voice's life.
          if (v.genState == null && gen.createState) v.genState = gen.createState(model);

          // Resolved params: generator defaults (incl. enum/colour) overlaid with the
          // voice's live numeric/bool params (envelopes already applied by the engine).
          let defs = genDefaults.get(gen.id);
          if (!defs) {
            defs = defaultParams(gen.paramSpec);
            genDefaults.set(gen.id, defs);
          }
          const params: ResolvedParams = { ...defs };
          const lp = v.liveParams;
          for (const k in lp) {
            const val = lp[k];
            if (val !== undefined) params[k] = val;
          }

          // Synthetic single trigger = this voice's originating hit. The voice model
          // has no live trigger stream: age grows with the voice (so age-driven
          // generators — washes, decays, cascades — animate), and seq is stable across
          // frames (so accumulators / particle spawns fire exactly once per voice).
          const seq = Number(v.id.slice(1));
          genTrigger.seq = Number.isFinite(seq) && seq > 0 ? seq : 1;
          genTrigger.drumId = v.sourceDrumId ?? '';
          genTrigger.velocity = v.velocity;
          genTrigger.note = Math.round(v.velocity * 127);
          genTrigger.timeMs = v.bornAtMs;
          const age = timeMs - v.bornAtMs;
          genTrigger.ageMs = age > 0 ? age : 0;

          genScratch.clear();
          gen.render(genCtx, params, genScratch, v.genState);

          // Composite scratch → dst, scaled by the voice envelope (brightness is
          // applied inside the generator), masked to [start, end). dst.add clamps.
          const src = genScratch.rgba;
          for (let i = start; i < end; i++) {
            const j = i * 4;
            const r = src[j]!;
            const g = src[j + 1]!;
            const b = src[j + 2]!;
            const a = src[j + 3]!;
            if (r <= 0 && g <= 0 && b <= 0 && a <= 0) continue;
            dst.add(i, r * level, g * level, b * level, a * level);
          }
          continue;
        }

        // --- pattern voice (fast path) ---------------------------------------
        const p = v.liveParams;
        const hue = num(p.hue, 0);
        const amp = level * num(p.brightness, 1);
        if (amp <= 0.003) continue;

        for (let i = start; i < end; i++) {
          sample(v.pattern, t, i, attrs, p, sampleOut);
          const inten = sampleOut[0]! * amp;
          if (inten <= 0.004) continue;
          hueToRgb(hue + sampleOut[1]!, inten, rgb);
          dst.add(i, rgb[0]!, rgb[1]!, rgb[2]!, inten);
        }
      }
    },
  };
}

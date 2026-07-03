/* Per-pixel pattern renderer for the lab's 3D kit preview. Each effect samples a
   procedural pattern over time + pixel position, shaped by its PARAMETERS (hue,
   speed, bands, angle, width, density, tempo-sync) and per-param ENVELOPES that
   sweep a value over the voice's life. Throwaway — stand-in for packages/core. */

import {
  Framebuffer,
  applyModifierChain,
  defaultParams as genDefaultParams,
  tryGetEffect,
  type RenderContext,
  type ResolvedModifier,
  type ResolvedParams,
  type Trigger,
} from '@ledrums/core';
import {
  applyModulations,
  sampleEnvelope,
  type ModSampleCtx,
  type ParamValues,
  type Pattern,
  type Sim,
  type Voice,
} from './sim';
import type { LabModel, PixelAttrs } from './kit';
import { hueToRgb } from './kit';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const num = (v: number | boolean | string | undefined, d: number) => (typeof v === 'number' ? v : d);

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
  // Modulation mappings (doc 10, S34-wired) — mirror of the core compositor sweep: summed +
  // clamped contributions over the spawn-snapshot base. Envelopes sample the same voice phase.
  const mods = v.modulations;
  if (mods && mods.length && eff) {
    applyModulations(v.params, out, mods, eff.params, { phase, timeMs: sim.timeMs, bpm: sim.bpm, cc: sim.ccTable }); // cc: S37
  }
  if (out.tempoSync === true) out.speed = num(out.speed, 1) * (sim.bpm / 120);
  return out;
}

/** Per-frame modulation-sample context for a voice — mirror of the core compositor's
    `modCtxFor`: life phase (envelope restart per hit) + absolute clock/tempo for continuous
    sources (S36/S37). Shared by the play-param sweep and the modifier chain. */
function modCtxFor(v: Voice, sim: Sim): ModSampleCtx {
  return { phase: sim.voicePhase(v), timeMs: sim.timeMs, bpm: sim.bpm, cc: sim.ccTable }; // cc: S37
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

    // Pixel range: scoped voices touch only their drum's / hoop's range.
    let start = 0;
    let end = model.count;
    if (v.scope === 'drum') {
      // Resolve target drum: from targetId if set, else sourceDrumId (auto).
      const drumId = v.targetId ?? v.sourceDrumId;
      if (drumId == null) continue;
      const d = lab.pm.drumById.get(drumId);
      if (!d) continue; // dangling targetId → render nothing
      start = d.pixelStart;
      end = d.pixelStart + d.pixelCount;
    } else if (v.scope === 'hoop') {
      // Parse targetId as "<drumId>#<hoopIndex>"; absent or no '#' → source drum hoop 0.
      let drumId: string | null = null;
      let hoopIndex = 0;
      if (v.targetId && v.targetId.includes('#')) {
        const sep = v.targetId.indexOf('#');
        drumId = v.targetId.slice(0, sep);
        hoopIndex = parseInt(v.targetId.slice(sep + 1), 10);
        if (!Number.isFinite(hoopIndex) || hoopIndex < 0) hoopIndex = 0;
      } else {
        drumId = v.sourceDrumId;
      }
      if (drumId == null) continue;
      const d = lab.pm.drumById.get(drumId);
      if (!d || hoopIndex < 0 || hoopIndex >= d.hoopCount) continue; // dangling → render nothing
      start = d.pixelStart + hoopIndex * d.pixelsPerHoop;
      end = start + d.pixelsPerHoop;
    }
    // scope === 'kit': start=0, end=model.count (whole kit, targetId ignored)

    // Generator-backed voice: delegate to the SAME core EffectGenerator the server
    // renders, so the offline preview matches real output (no silent divergence).
    if (v.generatorId) {
      renderGeneratorVoice(buf, v, level, sim, lab, start, end);
      continue;
    }

    // Pattern voice (per-pixel fast path).
    const p = effectiveParams(v, sim);
    const hue = num(p.hue, 0);
    const amp = level * num(p.brightness, 1);
    if (amp <= 0.003) continue;

    // Modified pattern voice: render into a float scratch (0..1, like core), apply the
    // modifier chain in the same 0..1 space the core compositor uses, then blit to buf.
    // Unmodified voices keep the direct 0..255 fast path below (mirrors core's gating).
    const mods = v.modifiers;
    if (mods && mods.length) {
      renderModifiedPatternVoice(buf, v, p, hue, amp, sim, lab, start, end, attrs, mods);
      continue;
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

// ---- modifier chain (media effects) — offline preview mirror ----------------
// Mirrors the core compositor's modifier hook: a MODIFIED voice's rendered pixels are
// transformed by its resolved chain (in 0..1 float space, shared core `applyModifierChain`)
// between render and blend. The generator path applies it on `genScratch`; the pattern path
// routes through this dedicated float scratch. Modifiers inherit the host voice's local
// clock (age) — never re-derived here.

let patScratch: Framebuffer | null = null;

function renderModifiedPatternVoice(
  buf: Uint8Array,
  v: Voice,
  p: ParamValues,
  hue: number,
  amp: number,
  sim: Sim,
  lab: LabModel,
  start: number,
  end: number,
  attrs: PixelAttrs,
  mods: readonly ResolvedModifier[],
): void {
  const pm = lab.pm;
  const t = sim.timeMs / 1000;
  if (!patScratch || patScratch.pixelCount !== pm.pixelCount) patScratch = new Framebuffer(pm.pixelCount);
  patScratch.clear();
  for (let i = start; i < end; i++) {
    const [si, hueOff] = sample(v.pattern, t, i, attrs, p);
    const inten = si * amp;
    if (inten <= 0.004) continue;
    const [r, g, b] = hueToRgb(hue + hueOff, inten); // 0..255
    patScratch.add(i, r / 255, g / 255, b / 255, inten);
  }
  if (!v.modState) v.modState = [];
  const age = sim.timeMs - v.bornAtMs;
  applyModifierChain(mods, v.modState, patScratch, { start, end }, pm, age > 0 ? age : 0, sim.lastDt, modCtxFor(v, sim));
  const src = patScratch.rgba;
  for (let i = start; i < end; i++) {
    const j4 = i * 4;
    const r = src[j4]!;
    const g = src[j4 + 1]!;
    const b = src[j4 + 2]!;
    if (r <= 0 && g <= 0 && b <= 0) continue;
    const j3 = i * 3;
    buf[j3] = Math.min(255, buf[j3]! + Math.round(r * 255));
    buf[j3 + 1] = Math.min(255, buf[j3 + 1]! + Math.round(g * 255));
    buf[j3 + 2] = Math.min(255, buf[j3 + 2]! + Math.round(b * 255));
  }
}

// ---- hosted core EffectGenerator bridge (offline preview parity) ------------
// Mirrors the core compositor's generator path: render the legacy whole-frame
// EffectGenerator into a reused core Framebuffer, then blit it into `buf` scaled by
// the voice envelope. Shared scratch/cache across voices — the offline previewer runs
// one Sim, single-threaded.

let genScratch: Framebuffer | null = null;
const genDefaults = new Map<string, ResolvedParams>();
const genTrigger: Trigger = { seq: 1, drumId: '', note: 0, velocity: 1, timeMs: 0, ageMs: 0 };
const genTriggers: Trigger[] = [genTrigger];

function renderGeneratorVoice(
  buf: Uint8Array,
  v: Voice,
  level: number,
  sim: Sim,
  lab: LabModel,
  start: number,
  end: number,
): void {
  const gen = tryGetEffect(v.generatorId!);
  if (!gen) return;
  const pm = lab.pm;
  if (!genScratch || genScratch.pixelCount !== pm.pixelCount) genScratch = new Framebuffer(pm.pixelCount);
  if (v.genState == null && gen.createState) v.genState = gen.createState(pm);

  // Resolved params: generator defaults (incl. enum/colour) overlaid with the voice's
  // live numeric/bool params (envelopes applied via effectiveParams).
  let defs = genDefaults.get(gen.id);
  if (!defs) {
    defs = genDefaultParams(gen.paramSpec);
    genDefaults.set(gen.id, defs);
  }
  const params: ResolvedParams = { ...defs };
  const lp = effectiveParams(v, sim);
  for (const k in lp) {
    const val = lp[k];
    if (val !== undefined) params[k] = val;
  }

  // Synthetic single trigger = this voice's originating hit (same model as core).
  const seq = Number(v.id.slice(1));
  genTrigger.seq = Number.isFinite(seq) && seq > 0 ? seq : 1;
  genTrigger.drumId = v.sourceDrumId ?? '';
  genTrigger.velocity = v.velocity;
  genTrigger.note = Math.round(v.velocity * 127);
  genTrigger.timeMs = v.bornAtMs;
  const age = sim.timeMs - v.bornAtMs;
  genTrigger.ageMs = age > 0 ? age : 0;

  // Timebase parity with the core generator bridge (generator-bridge.ts): a 'voice'
  // generator animates on a hit-relative clock (ctx.timeMs = age, transport.beat = age×bpm)
  // so it restarts on each trigger; an 'absolute' generator (default) free-runs on the
  // sim's wall-clock + transport. Keeping the formula identical to core keeps sim/engine
  // output in step.
  const voiceClock = (gen.timebase ?? 'absolute') === 'voice';
  const clockMs = voiceClock ? genTrigger.ageMs : sim.timeMs;
  const beat = voiceClock ? (genTrigger.ageMs / 60000) * sim.bpm : sim.beat;
  const bar = Math.floor(beat / sim.beatsPerBar);
  const ctx: RenderContext = {
    model: pm,
    timeMs: clockMs,
    dt: sim.lastDt,
    transport: {
      timeMs: clockMs,
      beat,
      bar,
      beatInBar: beat - bar * sim.beatsPerBar,
      bpm: sim.bpm,
      beatsPerBar: sim.beatsPerBar,
      playing: true,
    },
    triggers: genTriggers,
  };

  genScratch.clear();
  gen.render(ctx, params, genScratch, v.genState);

  // Modifier chain (media effects) — mirror of the core generator bridge: pure transforms
  // over the voice's rendered pixels, between render and blend, on the host voice's local
  // clock (age). Only modified voices pay this; unmodified voices blit straight through.
  const mods = v.modifiers;
  if (mods && mods.length) {
    if (!v.modState) v.modState = [];
    applyModifierChain(mods, v.modState, genScratch, { start, end }, pm, genTrigger.ageMs, sim.lastDt, modCtxFor(v, sim));
  }

  // Blit scratch (float RGBA) → buf (0..255 RGB), scaled by the voice envelope.
  const src = genScratch.rgba;
  for (let i = start; i < end; i++) {
    const j4 = i * 4;
    const r = src[j4]!;
    const g = src[j4 + 1]!;
    const b = src[j4 + 2]!;
    if (r <= 0 && g <= 0 && b <= 0) continue;
    const j3 = i * 3;
    buf[j3] = Math.min(255, buf[j3]! + Math.round(r * level * 255));
    buf[j3 + 1] = Math.min(255, buf[j3 + 1]! + Math.round(g * level * 255));
    buf[j3 + 2] = Math.min(255, buf[j3 + 2]! + Math.round(b * level * 255));
  }
}

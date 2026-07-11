/* Offline renderer for the lab's 3D kit preview: every voice hosts a core
   `EffectGenerator` (the legacy per-pixel pattern path was retired in Effects Library
   v2, U3), so `renderFrame` delegates to the SAME generators the server engine runs —
   the preview can never silently diverge from real output. Throwaway stand-in for
   packages/core's engine. */

import {
  Framebuffer,
  applyModifierChain,
  compositeInto,
  defaultParams as genDefaultParams,
  tryGetEffect,
  voice,
  type RenderContext,
  type ResolvedParams,
  type Trigger,
} from '@ledrums/core';
import {
  applyModulations,
  type ModSampleCtx,
  type ParamValues,
  type Sim,
  type Voice,
} from './sim';
import type { LabModel } from './kit';

const num = (v: number | boolean | string | undefined, d: number) => (typeof v === 'number' ? v : d);

function parseHoopTarget(targetId: string | undefined, sourceDrumId: string | null): { drumId: string | null; hoopIndices: number[] } {
  return voice.parseHoopTarget(targetId, sourceDrumId, { sourceDrumOnNoHash: true, emptyFallback: 'zero', sort: false });
}

/** Resolve a voice's params for this frame: apply modulation mappings + tempo sync. */
function effectiveParams(v: Voice, sim: Sim): ParamValues {
  const out: ParamValues = { ...v.params };
  const eff = sim.effect(v.effectId);
  // Modulation mappings (doc 10) — mirror of the core compositor sweep: summed + clamped
  // contributions over the spawn-snapshot base. Envelope sources sample the voice life phase
  // (restart per hit). The legacy per-param env sweep folded into these mappings in S35.
  const mods = v.modulations;
  if (mods && mods.length && eff) {
    const phase = sim.voicePhase(v);
    applyModulations(v.params, out, mods, eff.params, { phase, timeMs: sim.timeMs, bpm: sim.bpm, cc: sim.ccTable, osc: sim.oscTable, notes: sim.noteTable });
  }
  if (out.tempoSync === true) out.speed = num(out.speed, 1) * (sim.bpm / 120);
  return out;
}

/** Per-frame modulation-sample context for a voice — mirror of the core compositor's
    `modCtxFor`: life phase (envelope restart per hit) + absolute clock/tempo for continuous
    sources (S36/S37). Shared by the play-param sweep and the modifier chain. */
function modCtxFor(v: Voice, sim: Sim): ModSampleCtx {
  return { phase: sim.voicePhase(v), timeMs: sim.timeMs, bpm: sim.bpm, cc: sim.ccTable, osc: sim.oscTable, notes: sim.noteTable };
}

function pixelRangesFor(v: Voice, lab: LabModel): Array<{ start: number; end: number }> {
  const { model } = lab;
  if (v.scope === 'drum') {
    const drumId = v.targetId ?? v.sourceDrumId;
    const d = drumId ? lab.pm.drumById.get(drumId) : undefined;
    return d ? [{ start: d.pixelStart, end: d.pixelStart + d.pixelCount }] : [];
  }
  if (v.scope === 'hoop') {
    const { drumId, hoopIndices } = parseHoopTarget(v.targetId, v.sourceDrumId);
    const d = drumId ? lab.pm.drumById.get(drumId) : undefined;
    if (!d) return [];
    return hoopIndices
      .filter((hoopIndex) => hoopIndex >= 0 && hoopIndex < d.hoopCount)
      .map((hoopIndex) => {
        const start = d.pixelStart + hoopIndex * d.pixelsPerHoop;
        return { start, end: start + d.pixelsPerHoop };
      });
  }
  return [{ start: 0, end: model.count }];
}

function mixInputVoice(input: voice.MixInput, host: Voice): Voice {
  return {
    ...host,
    id: `${host.id}m${input.seed}`,
    scope: input.scope,
    targetId: input.targetId,
    sourceDrumId: input.sourceDrumId,
    velocity: input.velocity,
    seed: input.seed,
    generatorId: input.generatorId,
    genState: input.genState,
    mixInputs: undefined,
    modifiers: input.modifiers,
    modState: input.modState,
    modulations: input.modulations,
    params: input.params,
  };
}

function syncMixInputState(input: voice.MixInput, rendered: Voice): void {
  input.genState = rendered.genState;
  input.modState = rendered.modState;
}

let mixScratch: Framebuffer | null = null;
let mixInputBytes: Uint8Array | null = null;

/** Composite every live voice into `buf` (RGB triples), additive over black. */
export function renderFrame(buf: Uint8Array, sim: Sim, lab: LabModel): void {
  buf.fill(0);
  const { model } = lab;

  for (const v of sim.voices) {
    const level = sim.voiceLevel(v);
    if (level <= 0.003) continue;

    if (v.mixInputs?.length) {
      if (!mixScratch || mixScratch.pixelCount !== lab.pm.pixelCount) mixScratch = new Framebuffer(lab.pm.pixelCount);
      if (!mixInputBytes || mixInputBytes.length !== model.count * 3) mixInputBytes = new Uint8Array(model.count * 3);
      mixScratch.clear();
      for (const input of v.mixInputs) {
        mixInputBytes.fill(0);
        const branchVoice = mixInputVoice(input, v);
        for (const range of pixelRangesFor(branchVoice, lab)) renderGeneratorVoice(mixInputBytes, branchVoice, 1, sim, lab, range.start, range.end);
        syncMixInputState(input, branchVoice);
        for (let pixel = 0; pixel < model.count; pixel++) {
          const j3 = pixel * 3;
          const r = mixInputBytes[j3]! / 255;
          const g = mixInputBytes[j3 + 1]! / 255;
          const b = mixInputBytes[j3 + 2]! / 255;
          if (r <= 0 && g <= 0 && b <= 0) continue;
          compositeInto(mixScratch.rgba, pixel * 4, r, g, b, 1, v.mixBlendMode ?? 'normal', input.opacity);
        }
      }
      for (const range of pixelRangesFor(v, lab)) {
        for (let i = range.start; i < range.end; i++) {
          const j4 = i * 4;
          const r = mixScratch.rgba[j4]!;
          const g = mixScratch.rgba[j4 + 1]!;
          const b = mixScratch.rgba[j4 + 2]!;
          if (r <= 0 && g <= 0 && b <= 0) continue;
          const j3 = i * 3;
          buf[j3] = Math.min(255, buf[j3]! + Math.round(r * level * 255));
          buf[j3 + 1] = Math.min(255, buf[j3 + 1]! + Math.round(g * level * 255));
          buf[j3 + 2] = Math.min(255, buf[j3 + 2]! + Math.round(b * level * 255));
        }
      }
      continue;
    }

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
      // Parse targetId as "<drumId>#<hoopIndex>[,<hoopIndex>]"; absent → source drum hoop 0.
      const { drumId, hoopIndices } = parseHoopTarget(v.targetId, v.sourceDrumId);
      if (drumId == null) continue;
      const d = lab.pm.drumById.get(drumId);
      if (!d) continue;
      for (const hoopIndex of hoopIndices) {
        if (hoopIndex < 0 || hoopIndex >= d.hoopCount) continue;
        start = d.pixelStart + hoopIndex * d.pixelsPerHoop;
        end = start + d.pixelsPerHoop;
        if (v.generatorId) renderGeneratorVoice(buf, v, level, sim, lab, start, end);
      }
      continue;
    }
    // scope === 'kit': start=0, end=model.count (whole kit, targetId ignored)

    // Every voice is generator-backed (U3): delegate to the SAME core EffectGenerator the
    // server renders, so the offline preview matches real output (no silent divergence).
    if (v.generatorId) renderGeneratorVoice(buf, v, level, sim, lab, start, end);
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
  // per-voice state seeded from the trigger (item C) — mirrors the core generator bridge
  if (v.genState == null && gen.createState) v.genState = gen.createState(pm, v.seed);

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

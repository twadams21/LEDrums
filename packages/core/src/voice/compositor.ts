/**
 * Inner seam — the voices → pixels hotspot. {@link Compositor.render} accumulates each
 * live voice into the destination {@link Framebuffer}. Every voice is **generator-backed**:
 * it hosts an `EffectGenerator` from `effects/registry` through the bridge (see
 * `generator-bridge.ts`). (The legacy per-pixel pattern fast path was retired in Effects
 * Library v2, U3 — the compositor no longer has a second render path or the SoA pixel-attr
 * buffers it sampled.)
 *
 * This module owns the shared per-frame orchestration: clearing `dst`, the per-voice
 * level gate, the drum-scope pixel mask, and dispatching each voice to the generator
 * bridge. It also resolves a voice's live params (envelope + tempo-sync) — the engine
 * calls {@link applyEffectiveParams} before `render`, so the inner loop reads only
 * already-resolved `liveParams`.
 *
 * Deterministic: no IO, no wall-clock, no `Math.random`. Generators run few voices (mono
 * buses, level gating), so the bridge's per-voice merged-params object stays well within
 * budget.
 */
import { getHoopPixelRange, type PixelModel } from '../geometry/pixel-model';
import { Framebuffer } from '../engine/framebuffer';
import type { TransportState } from '../engine/render-context';
import { applyModulations, type CcTable, type ModSampleCtx, type NoteTable, type OscTable } from './modulation';
import { createGeneratorBridge } from './generator-bridge';
import { applyModifierChain } from '../modifiers/chain';
import { compositeInto } from '../color/blend';
import type { PixelRange } from '../modifiers/types';
import { parseHoopTarget as parseScopeTarget, type HoopTarget } from './scope';
import type { MixInput, ParamValues, Voice } from './types';

const num = (v: number | boolean | string | undefined, d: number): number => (typeof v === 'number' ? v : d);

/** Never render nothing: a hash-less id falls back to the source drum's hoop 0, and a
    `#`-qualified id with no valid indices falls back to `[0]`. Indices keep authoring order. */
function parseHoopTarget(targetId: string | undefined, sourceDrumId: string | null): HoopTarget {
  return parseScopeTarget(targetId, sourceDrumId, { sourceDrumOnNoHash: true, emptyFallback: 'zero', sort: false });
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
export function applyEffectiveParams(v: Voice, timeMs: number, bpm: number, cc?: CcTable, osc?: OscTable, notes?: NoteTable): ParamValues {
  const out = v.liveParams;
  // Refill the scratch from the spawn snapshot.
  for (const k of Object.keys(out)) delete out[k];
  for (const k of Object.keys(v.params)) out[k] = v.params[k]!;
  // Modulation mappings (doc 10): summed-and-clamped contributions over the spawn-snapshot base.
  // Envelope sources sample the voice-life `phase` (restart per hit); continuous sources read the
  // absolute clock + tempo (LFO) or a live table (CC / OSC). The legacy env sweep folded in S35.
  const mods = v.modulations;
  if (mods && mods.length) {
    applyModulations(v.params, out, mods, v.specs, { phase: voicePhase(v, timeMs), timeMs, bpm, cc, osc, notes });
  }
  if (out.tempoSync === true) out.speed = num(out.speed, 1) * (bpm / 120);
  return out;
}

/** The frame-wide slice of a {@link ModSampleCtx}: the absolute clock + tempo and the live
    CC/OSC/note tables, all identical for every voice this frame. Built once per render and
    stamped with each voice's own `phase` by {@link modCtxFor}. */
type FrameModCtx = Omit<ModSampleCtx, 'phase'>;

/** Build the per-frame modulation-sample context for a voice — its life phase (envelope
    sources restart per hit) over the shared frame context (absolute clock + tempo continuous
    sources, S36/S37). Shared by the play-param sweep and the modifier chain so both restart
    together. */
function modCtxFor(v: Voice, frame: FrameModCtx): ModSampleCtx {
  return { phase: voicePhase(v, frame.timeMs), ...frame };
}

function mixInputVoice(input: MixInput, host: Voice): Voice {
  return {
    active: true,
    id: `${host.id}m${input.seed}`,
    effectId: host.effectId,
    playType: host.playType,
    canvasScene: host.canvasScene,
    busId: host.busId,
    mode: host.mode,
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
    mixBlendMode: undefined,
    liveParams: input.liveParams,
    specs: input.specs,
    attackMs: host.attackMs,
    sustainMs: host.sustainMs,
    releaseMs: host.releaseMs,
    phase: host.phase,
    level: 1,
    bornAtMs: host.bornAtMs,
    releaseAtMs: host.releaseAtMs,
    releaseFromLevel: host.releaseFromLevel,
    via: host.via,
    deckGain: 1,
  };
}

function syncMixInputState(input: MixInput, rendered: Voice): void {
  input.genState = rendered.genState;
  input.modState = rendered.modState;
}

function pixelRangesFor(v: Voice, model: PixelModel): PixelRange[] {
  if (v.scope === 'drum') {
    const drumId = v.targetId ?? v.sourceDrumId;
    const d = drumId ? model.drumById.get(drumId) : undefined;
    return d ? [{ start: d.pixelStart, end: d.pixelStart + d.pixelCount }] : [];
  }
  if (v.scope === 'hoop') {
    const { drumId, hoopIndices } = parseHoopTarget(v.targetId, v.sourceDrumId);
    if (drumId == null) return [];
    return hoopIndices.flatMap((hoopIndex) => {
      const range = getHoopPixelRange(model, drumId, hoopIndex);
      return range ? [{ start: range.start, end: range.end }] : [];
    });
  }
  return [{ start: 0, end: model.pixelCount }];
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
  /** Live CC value table (S37) — threaded to the per-voice modulation sweep so `cc` sources
      read the engine's current controller values this frame. Absent → no CC contribution. */
  cc?: CcTable; // S37
  /** Live OSC value table — threaded alongside {@link cc} so `osc` modulation sources read the
      engine's current per-address values this frame. Absent → no OSC contribution. */
  osc?: OscTable;
  notes?: NoteTable;
}

/** Voices → pixels. The inner seam. */
export interface Compositor {
  render(
    voices: readonly Voice[],
    model: PixelModel,
    frame: CompositorFrame,
    dst: Framebuffer,
  ): void;
}

/**
 * The default compositor: additive accumulation of every live voice into `dst`.
 * Drum-scoped voices touch only their drum's pixel range. Assumes each voice's
 * `liveParams` was refreshed (by the engine) for this frame.
 *
 * Owns one generator bridge for its lifetime; it keeps its own reused scratch, so the only
 * per-voice allocation is the bridge's merged params object (see `generator-bridge.ts`).
 * Generators run few voices (mono buses, level gating), so this stays well within budget.
 */
export function createDefaultCompositor(): Compositor {
  const generators = createGeneratorBridge();
  let mixScratch: Framebuffer | null = null;
  let mixInputScratch: Framebuffer | null = null;

  return {
    render(voices, model, frame, dst): void {
      dst.clear();
      const timeMs = frame.timeMs;
      const frameCtx: FrameModCtx = {
        timeMs,
        bpm: frame.transport.bpm,
        cc: frame.cc,
        osc: frame.osc,
        notes: frame.notes,
      };

      // Refresh the reusable hosted-generator RenderContext for this frame.
      generators.beginFrame(model, timeMs, frame.dt, frame.transport);

      const ensureScratch = (): { mix: Framebuffer; input: Framebuffer } => {
        if (!mixScratch || mixScratch.pixelCount !== model.pixelCount) mixScratch = new Framebuffer(model.pixelCount);
        if (!mixInputScratch || mixInputScratch.pixelCount !== model.pixelCount) mixInputScratch = new Framebuffer(model.pixelCount);
        return { mix: mixScratch, input: mixInputScratch };
      };

      for (const v of voices) {
        if (!v.active) continue;
        const level = v.level * v.deckGain;
        if (level <= 0.003) continue;

        if (v.mixInputs?.length) {
          const { mix, input } = ensureScratch();
          mix.clear();
          for (const branch of v.mixInputs) {
            input.clear();
            for (const key of Object.keys(branch.liveParams)) delete branch.liveParams[key];
            for (const key of Object.keys(branch.params)) branch.liveParams[key] = branch.params[key]!;
            if (branch.modulations?.length) {
              applyModulations(branch.params, branch.liveParams, branch.modulations, branch.specs, modCtxFor(v, frameCtx));
            }
            const branchVoice = mixInputVoice(branch, v);
            const branchCtx = modCtxFor(branchVoice, frameCtx);
            for (const range of pixelRangesFor(branchVoice, model)) {
              generators.renderVoice(branchVoice, model, timeMs, 1, range.start, range.end, input, branchCtx);
            }
            syncMixInputState(branch, branchVoice);
            const src = input.rgba;
            for (let i = 0; i < src.length; i += 4) {
              compositeInto(mix.rgba, i, src[i]!, src[i + 1]!, src[i + 2]!, src[i + 3]!, v.mixBlendMode ?? 'normal', branch.opacity);
            }
          }

          const ranges = pixelRangesFor(v, model);
          const mods = v.modifiers;
          if (mods && mods.length) {
            if (!v.modState) v.modState = [];
            const modCtx = modCtxFor(v, frameCtx);
            for (const range of ranges) applyModifierChain(mods, v.modState, mix, range, model, timeMs - v.bornAtMs, frame.dt, modCtx);
          }
          for (const range of ranges) {
            for (let i = range.start; i < range.end; i++) {
              const j = i * 4;
              const r = mix.rgba[j]!;
              const g = mix.rgba[j + 1]!;
              const b = mix.rgba[j + 2]!;
              const a = mix.rgba[j + 3]!;
              if (r <= 0 && g <= 0 && b <= 0 && a <= 0) continue;
              dst.add(i, r * level, g * level, b * level, a * level);
            }
          }
          continue;
        }

        if (!v.generatorId) continue; // every selectable effect is generator-backed (U3)

        let start = 0;
        let end = model.pixelCount;
        if (v.scope === 'drum') {
          // Resolve target drum: from targetId if set, else sourceDrumId (auto).
          const drumId = v.targetId ?? v.sourceDrumId;
          if (drumId == null) continue;
          const d = model.drumById.get(drumId);
          if (!d) continue; // dangling targetId → render nothing
          start = d.pixelStart;
          end = d.pixelStart + d.pixelCount;
        } else if (v.scope === 'hoop') {
          // Parse targetId as "<drumId>#<hoopIndex>[,<hoopIndex>]"; absent → source drum hoop 0.
          const { drumId, hoopIndices } = parseHoopTarget(v.targetId, v.sourceDrumId);
          if (drumId == null) continue;
          const modCtx = modCtxFor(v, frameCtx);
          for (const hoopIndex of hoopIndices) {
            const range = getHoopPixelRange(model, drumId, hoopIndex);
            if (range) generators.renderVoice(v, model, timeMs, level, range.start, range.end, dst, modCtx);
          }
          continue;
        }
        // scope === 'kit': start=0, end=model.pixelCount (whole kit, targetId ignored)

        // Hosted generator voice — the bridge applies the modifier chain internally.
        const modCtx = modCtxFor(v, frameCtx);
        generators.renderVoice(v, model, timeMs, level, start, end, dst, modCtx);
      }
    },
  };
}

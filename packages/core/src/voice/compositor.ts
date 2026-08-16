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
import {
  chasePixelShift,
  chaseStaggerShift,
  chaseStepOffset,
  computeSpliceBands,
  forEachPartitionUnit,
  forEachSpliceBand,
  spliceOrderIndex,
  spliceTintColour,
  unitMotionAge,
  tintPixel,
  type SpliceBand,
} from './splice';
import type { MixInput, ParamValues, SpliceConfig, Voice } from './types';

const num = (v: number | boolean | string | undefined, d: number): number => (typeof v === 'number' ? v : d);

/** Never render nothing: a hash-less id falls back to the source drum's hoop 1, and a
    `#`-qualified id with no valid indices falls back to `[1]` (hoops are 1-based, A1).
    Indices keep authoring order. */
function parseHoopTarget(targetId: string | undefined, sourceDrumId: string | null): HoopTarget {
  return parseScopeTarget(targetId, sourceDrumId, { sourceDrumOnNoHash: true, emptyFallback: 'first', sort: false });
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

/**
 * Identity of a splice voice's band LAYOUT — everything {@link computeSpliceBands} and
 * {@link forEachPartitionUnit} read, but nothing that moves. The chase is deliberately
 * excluded: it shifts which band shows what, never where the bands are cut, so a chasing
 * splice reuses one cached layout for the whole voice instead of re-cutting 60×/second.
 */
function spliceLayoutKey(cfg: SpliceConfig, model: PixelModel, ranges: readonly PixelRange[]): string {
  let key = `${cfg.count}|${cfg.jitter}|${cfg.seed}|${cfg.partition}|${cfg.order}|${model.pixelCount}`;
  for (const range of ranges) key += `|${range.start}-${range.end}`;
  return key;
}

/** One partition unit's absolute pixel run, how it is cut, and where it sits in the
    cascade (0 = starts with the hit; higher = one offset later). */
interface SpliceUnit {
  start: number;
  end: number;
  bands: SpliceBand[];
  orderIndex: number;
}

/**
 * Cut every partition unit of a splice voice. Jitter is decorrelated per unit (each hoop
 * gets its own seeded pattern) so "random splice lengths" reads as genuinely irregular
 * around the kit rather than the same stencil repeated on every ring.
 */
function buildSpliceUnits(cfg: SpliceConfig, model: PixelModel, ranges: readonly PixelRange[]): SpliceUnit[] {
  const units: SpliceUnit[] = [];
  forEachPartitionUnit(model, ranges, cfg.partition, (start, end, unitIndex, ordinal, ordinalCount) => {
    const seed = cfg.jitter > 0 ? (cfg.seed + unitIndex * 0x9e3779b1) >>> 0 : cfg.seed;
    units.push({
      start,
      end,
      bands: computeSpliceBands(end - start, cfg.count, cfg.jitter, seed),
      orderIndex: spliceOrderIndex(ordinal, ordinalCount, cfg.order, cfg.seed),
    });
  });
  return units;
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
  /** One buffer per splice member, grown on demand and reused across voices + frames. */
  let spliceBuffers: Framebuffer[] = [];
  /** Band layouts by {@link spliceLayoutKey} — bounded, cleared wholesale when it fills
      (layouts are cheap to rebuild; an unbounded cache would leak across shows). */
  const spliceLayouts = new Map<string, SpliceUnit[]>();
  const SPLICE_LAYOUT_CACHE_CAP = 64;

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

      const ensureSpliceBuffers = (n: number): Framebuffer[] => {
        if (spliceBuffers.length && spliceBuffers[0]!.pixelCount !== model.pixelCount) spliceBuffers = [];
        while (spliceBuffers.length < n) spliceBuffers.push(new Framebuffer(model.pixelCount));
        return spliceBuffers;
      };

      for (const v of voices) {
        if (!v.active) continue;
        const level = v.level * v.deckGain;
        if (level <= 0.003) continue;

        // Splice: several members rendered whole, then shown through moving bands. Kept ahead
        // of the Mix branch because the two are mutually exclusive — a splice voice's content
        // is its own splices, never upstream branches.
        if (v.spliceInputs?.length && v.splice) {
          const cfg = v.splice;
          const ranges = pixelRangesFor(v, model);
          if (!ranges.length) continue;
          const buffers = ensureSpliceBuffers(v.spliceInputs.length);

          // 1. Render each member ONCE over the voice's whole range. Bands are windows onto
          //    these renders, so an effect keeps its real geometry (a comet still travels the
          //    hoop) and is merely revealed inside the splices showing it.
          for (let i = 0; i < v.spliceInputs.length; i++) {
            const member = v.spliceInputs[i]!;
            const buf = buffers[i]!;
            buf.clear();
            for (const key of Object.keys(member.liveParams)) delete member.liveParams[key];
            for (const key of Object.keys(member.params)) member.liveParams[key] = member.params[key]!;
            if (member.modulations?.length) {
              applyModulations(member.params, member.liveParams, member.modulations, member.specs, modCtxFor(v, frameCtx));
            }
            const memberVoice = mixInputVoice(member, v);
            const memberCtx = modCtxFor(memberVoice, frameCtx);
            for (const range of ranges) {
              generators.renderVoice(memberVoice, model, timeMs, 1, range.start, range.end, buffers[i]!, memberCtx);
            }
            syncMixInputState(member, memberVoice);
          }

          // 2. Cut the bands (cached — the cut never moves; only what shows in it does).
          const layoutKey = spliceLayoutKey(cfg, model, ranges);
          let units = spliceLayouts.get(layoutKey);
          if (!units) {
            if (spliceLayouts.size >= SPLICE_LAYOUT_CACHE_CAP) spliceLayouts.clear();
            units = buildSpliceUnits(cfg, model, ranges);
            spliceLayouts.set(layoutKey, units);
          }

          // 3. Reveal each band from its member's buffer, tinted by that splice's colour.
          const { mix } = ensureScratch();
          mix.clear();
          const age = timeMs - v.bornAtMs;
          // Motion clock: `restart` runs off the voice's own age, so each hit starts the
          // movement over; `continuous` runs off the engine clock every voice shares, so a
          // hit picks up exactly where the last one left off. Only the MOTION reads this —
          // the envelope and the modifier chain stay voice-relative either way.
          const motionClock =
            cfg.motionMode === 'continuous'
              ? timeMs
              : cfg.motionMode === 'latched'
                ? (v.spliceMotionMs ?? 0) // only ran while lit — see `advanceLatchedSpliceMotion`
                : age;
          const dstRgba = mix.rgba;
          for (const unit of units) {
            const len = unit.end - unit.start;
            // Each unit runs on its own clock, so an offset cascade starts hoop after hoop.
            // With no offset every unit gets `age` and this is the previous behaviour exactly.
            const unitAge = unitMotionAge(motionClock, unit.orderIndex, cfg.offsetMs);
            const stepOffset = cfg.chase === 'step' ? chaseStepOffset(unitAge, cfg.chaseMs, cfg.direction) : 0;
            const shift =
              cfg.chase === 'smooth'
                ? chasePixelShift(unitAge, cfg.chaseMs, cfg.direction, len)
                : cfg.chase === 'stagger'
                  ? chaseStaggerShift(unitAge, cfg.chaseMs, cfg.direction, cfg.incrementPx)
                  : 0;
            forEachSpliceBand(unit.bands, len, shift, stepOffset, (slot, bandStart, bandEnd) => {
              const inputIndex = cfg.inputBySlot[slot] ?? -1;
              if (inputIndex < 0) return; // a blank splice shows nothing
              const src = buffers[inputIndex]!.rgba;
              const colour = spliceTintColour(cfg.colors[slot]);
              for (let p = unit.start + bandStart; p < unit.start + bandEnd; p++) {
                const j = p * 4;
                const r = src[j]!;
                const g = src[j + 1]!;
                const b = src[j + 2]!;
                const a = src[j + 3]!;
                if (r <= 0 && g <= 0 && b <= 0 && a <= 0) continue;
                if (colour) {
                  const t = tintPixel(r, g, b, colour, cfg.tint);
                  dstRgba[j] = t.r;
                  dstRgba[j + 1] = t.g;
                  dstRgba[j + 2] = t.b;
                } else {
                  dstRgba[j] = r;
                  dstRgba[j + 1] = g;
                  dstRgba[j + 2] = b;
                }
                dstRgba[j + 3] = a;
              }
            });
          }

          // 4. Downstream modifiers see the assembled splice frame, then it lands in `dst`
          //    scaled by the voice envelope — the same tail as the Mix branch.
          const spliceMods = v.modifiers;
          if (spliceMods && spliceMods.length) {
            if (!v.modState) v.modState = [];
            const modCtx = modCtxFor(v, frameCtx);
            for (const range of ranges) applyModifierChain(spliceMods, v.modState, mix, range, model, age, frame.dt, modCtx);
          }
          for (const range of ranges) {
            for (let i = range.start; i < range.end; i++) {
              const j = i * 4;
              const r = dstRgba[j]!;
              const g = dstRgba[j + 1]!;
              const b = dstRgba[j + 2]!;
              const a = dstRgba[j + 3]!;
              if (r <= 0 && g <= 0 && b <= 0 && a <= 0) continue;
              dst.add(i, r * level, g * level, b * level, a * level);
            }
          }
          continue;
        }

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
          // Parse targetId as "<drumId>#<hoopIndex>[,<hoopIndex>]" (1-based); absent → source drum hoop 1.
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

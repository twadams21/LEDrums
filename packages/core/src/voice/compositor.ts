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
import { ensureGeometryState } from './geometry-state';
import { createRenderCheckpoint } from './render-checkpoint';
import { createGeneratorBridge } from './generator-bridge';
import { applyScopedModifierChain } from '../modifiers/chain';
import { compositeInto } from '../color/blend';
import type { PixelRange } from '../modifiers/types';
import { parseHoopTarget as parseScopeTarget, type HoopTarget } from './scope';
import {
  chasePixelShift,
  chaseStaggerShift,
  chaseStepOffset,
  colorCascadeDelayMs,
  computeSpliceBands,
  forEachPartitionUnit,
  forEachSpliceSegment,
  firstUnitWithMaterial,
  spliceFeatherPx,
  maxCascadeDelayMs,
  spliceOrderIndex,
  splicePulseCycleMs,
  spliceRotationPx,
  spliceSourceOffset,
  spliceTintColour,
  unitCascadeDelayMs,
  unitEnvelopeLevel,
  unitFadeInLevel,
  unitMotionAge,
  tintPixel,
  type SpliceBand,
} from './splice';
import type { MixInput, ParamValues, SpliceConfig, SpliceMaterialCoverage, Voice } from './types';

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
export function voicePhase(v: Pick<Voice, 'bornAtMs' | 'mode' | 'attackMs' | 'sustainMs' | 'releaseMs'>, timeMs: number): number {
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
    CC/OSC/note tables, all identical for every voice this frame. Reused by the compositor and
    stamped with each voice's own `phase` by {@link writeModCtx}. */
type FrameModCtx = Omit<ModSampleCtx, 'phase'>;

/** Build the per-frame modulation-sample context for a voice — its life phase (envelope
    sources restart per hit) over the shared frame context (absolute clock + tempo continuous
    sources, S36/S37). Shared by the play-param sweep and the modifier chain so both restart
    together. */
function writeModCtx(out: ModSampleCtx, v: Voice, frame: FrameModCtx): ModSampleCtx {
  out.phase = voicePhase(v, frame.timeMs);
  out.timeMs = frame.timeMs;
  out.bpm = frame.bpm;
  out.cc = frame.cc;
  out.osc = frame.osc;
  out.notes = frame.notes;
  return out;
}

function createMixInputVoice(): Voice {
  return {
    active: true, id: 'v1', effectId: '', playType: undefined, canvasScene: undefined, busId: '',
    mode: 'loop', scope: 'kit', targetId: undefined, sourceDrumId: null, velocity: 1, seed: 0,
    generatorId: null, genState: null, materialCycleMs: undefined, materialCycle: undefined,
    renderModel: undefined, renderGenerator: undefined, mixInputs: undefined, spliceInputs: undefined,
    splice: undefined, spliceMotionMs: undefined, spliceCoverage: undefined, modifiers: undefined,
    modState: undefined, modulations: undefined, params: {}, mixBlendMode: undefined, liveParams: {},
    specs: [], attackMs: 0, attackEase: undefined, sustainMs: 0, releaseMs: 0, lifeEnvelope: null,
    lifeSpanMs: 0, phase: 'attack', level: 1, bornAtMs: 0, releaseAtMs: null, releaseFromLevel: 1,
    via: '', deckGain: 1,
  };
}

/** Fill the one synchronous member shell used by both composite paths. */
function fillMixInputVoice(out: Voice, input: MixInput, host: Voice, cycleOwned: boolean): void {
  out.active = true;
  // The old derived member id parsed as sequence 1; keep that deterministic sequence without
  // allocating a template string every frame.
  out.id = 'v1';
  out.effectId = host.effectId;
  out.playType = host.playType;
  out.canvasScene = host.canvasScene;
  out.busId = host.busId;
  out.mode = host.mode;
  out.scope = input.scope;
  out.targetId = input.targetId;
  out.sourceDrumId = input.sourceDrumId;
  out.velocity = input.velocity;
  out.seed = input.seed;
  out.generatorId = input.generatorId;
  out.genState = input.genState;
  out.materialCycleMs = cycleOwned ? input.materialCycleMs : undefined;
  out.materialCycle = cycleOwned ? input.materialCycle : undefined;
  out.renderModel = input.renderModel;
  out.renderGenerator = input.renderGenerator;
  out.mixInputs = undefined;
  out.spliceInputs = undefined;
  out.splice = undefined;
  out.spliceMotionMs = undefined;
  out.spliceCoverage = undefined;
  out.modifiers = input.modifiers;
  out.modState = input.modState;
  out.modulations = input.modulations;
  out.params = input.params;
  out.mixBlendMode = undefined;
  out.liveParams = input.liveParams;
  out.specs = input.specs;
  out.attackMs = host.attackMs;
  out.attackEase = host.attackEase;
  out.sustainMs = host.sustainMs;
  out.releaseMs = host.releaseMs;
  out.phase = host.phase;
  out.level = 1;
  out.lifeEnvelope = host.lifeEnvelope;
  out.lifeSpanMs = host.lifeSpanMs;
  out.bornAtMs = host.bornAtMs;
  out.releaseAtMs = host.releaseAtMs;
  out.releaseFromLevel = host.releaseFromLevel;
  out.via = host.via;
  out.deckGain = 1;
}

function syncMixInputState(input: MixInput, rendered: Voice, cycleOwned: boolean): void {
  input.genState = rendered.genState;
  if (cycleOwned) input.materialCycle = rendered.materialCycle;
  input.renderGenerator = rendered.renderGenerator;
  input.modState = rendered.modState;
}

/**
 * Identity of a splice voice's band LAYOUT — everything {@link computeSpliceBands} and
 * {@link forEachPartitionUnit} read, but nothing that moves. The chase is deliberately
 * excluded: it shifts which band shows what, never where the bands are cut, so a chasing
 * splice reuses one cached layout for the whole voice instead of re-cutting 60×/second.
 */
function spliceLayoutKey(cfg: SpliceConfig, model: PixelModel, ranges: readonly PixelRange[]): string {
  let key = `${cfg.count}|${cfg.jitter}|${cfg.seed}|${cfg.partition}|${cfg.order}|${cfg.drumOrder}|${cfg.smudge}|${model.pixelCount}`;
  for (const range of ranges) key += `|${range.start}-${range.end}`;
  return key;
}

/** One partition unit's absolute pixel run, how it is cut, and where it sits in the
    cascade (0 = starts with the hit; higher = one offset later). */
interface SpliceUnit {
  start: number;
  end: number;
  bands: SpliceBand[];
  /** Place on the hoop axis and on the drum axis — both structural, so they stay cacheable
      while the offsets that scale them are read fresh each frame. */
  orderIndex: number;
  drumOrderIndex: number;
}

/**
 * Cut every partition unit of a splice voice. Jitter is decorrelated per unit (each hoop
 * gets its own seeded pattern) so "random splice lengths" reads as genuinely irregular
 * around the kit rather than the same stencil repeated on every ring.
 */
function buildSpliceUnits(cfg: SpliceConfig, model: PixelModel, ranges: readonly PixelRange[]): SpliceUnit[] {
  const units: SpliceUnit[] = [];
  forEachPartitionUnit(model, ranges, cfg.partition, (unit) => {
    const seed = cfg.jitter > 0 ? (cfg.seed + unit.index * 0x9e3779b1) >>> 0 : cfg.seed;
    units.push({
      start: unit.start,
      end: unit.end,
      bands: computeSpliceBands(unit.end - unit.start, cfg.count, cfg.jitter, seed),
      orderIndex: spliceOrderIndex(unit.ordinal, unit.ordinalCount, cfg.order, cfg.seed),
      drumOrderIndex: spliceOrderIndex(unit.drumOrdinal, unit.drumCount, cfg.drumOrder, cfg.seed),
    });
  });
  return units;
}

function ensureSpliceCoverage(v: Voice, memberCount: number, unitCount: number): SpliceMaterialCoverage {
  const cells = memberCount * unitCount;
  const current = v.spliceCoverage;
  if (!current || current.materialUnits.length < cells || current.sourceUnitByMember.length < memberCount) {
    const materialUnits = new Uint8Array(Math.max(cells, current?.materialUnits.length ?? 0));
    const sourceUnitByMember = new Int32Array(Math.max(memberCount, current?.sourceUnitByMember.length ?? 0));
    v.spliceCoverage = { memberCount, unitCount, materialUnits, sourceUnitByMember };
  } else {
    current.memberCount = memberCount;
    current.unitCount = unitCount;
  }
  const coverage = v.spliceCoverage!;
  coverage.materialUnits.fill(0, 0, cells);
  coverage.sourceUnitByMember.fill(-1, 0, memberCount);
  return coverage;
}

/** Scan each member buffer once across the selected units. This is O(members × selectedPixels),
 * not a full pixel scan nested inside every member/unit pair. The first lit unit is the stable
 * sparse fallback source, matching partition order and never retaining a previous frame's choice. */
function scanSpliceCoverage(
  coverage: SpliceMaterialCoverage,
  memberIndex: number,
  rgba: Float32Array,
  units: readonly SpliceUnit[],
): void {
  const row = memberIndex * coverage.unitCount;
  for (let unitIndex = 0; unitIndex < units.length; unitIndex++) {
    const unit = units[unitIndex]!;
    let hasMaterial = false;
    for (let pixel = unit.start; pixel < unit.end; pixel++) {
      const j = pixel * 4;
      if (rgba[j]! > 0 || rgba[j + 1]! > 0 || rgba[j + 2]! > 0 || rgba[j + 3]! > 0) {
        hasMaterial = true;
        break;
      }
    }
    if (hasMaterial) {
      coverage.materialUnits[row + unitIndex] = 1;
    }
  }
  coverage.sourceUnitByMember[memberIndex] = firstUnitWithMaterial(coverage.materialUnits, row, units.length);
}

function pixelRangesFor(v: Voice, model: PixelModel): PixelRange[] {
  const ranges = rawPixelRangesFor(v, model).sort((a, b) => a.start - b.start);
  const out: PixelRange[] = [];
  for (const range of ranges) {
    const last = out[out.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else out.push(range);
  }
  return out;
}

function rawPixelRangesFor(v: Voice, model: PixelModel): PixelRange[] {
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

/** Offline presentation wrapper. Ordinary render callers pay no checkpoint cost. */
export interface PresentationCompositor extends Compositor {
  /** Non-rendering lifetime boundary. Drop retired generations/checkpoints and old model
   * references even while local painting is suspended; null detaches the model entirely.
   * Unchanged live baselines are preserved. Call after reaping/spawn and on model changes. */
  prunePresentation(voices: readonly Voice[], model: PixelModel | null): void;
  renderPresentation(voices: readonly Voice[], model: PixelModel, frame: CompositorFrame, dst: Framebuffer, tick: number): void;
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
export function createDefaultCompositor(): PresentationCompositor {
  const generators = createGeneratorBridge();
  const checkpoint = createRenderCheckpoint();
  let mixScratch: Framebuffer | null = null;
  let mixInputScratch: Framebuffer | null = null;
  /** One synchronous member shell; state is copied back to its owning MixInput after render. */
  const compositeVoiceScratch = createMixInputVoice();
  /** One buffer per splice member, grown on demand and reused across voices + frames. */
  let spliceBuffers: Framebuffer[] = [];
  /** Band layouts by {@link spliceLayoutKey} — bounded, cleared wholesale when it fills
      (layouts are cheap to rebuild; an unbounded cache would leak across shows). */
  const spliceLayouts = new Map<string, SpliceUnit[]>();
  let spliceLayoutModel: PixelModel | null = null;
  const SPLICE_LAYOUT_CACHE_CAP = 64;
  const frameCtx: FrameModCtx = { timeMs: 0, bpm: 120 };
  const modCtxScratch: ModSampleCtx = { phase: 0, timeMs: 0, bpm: 120 };

  const bindModel = (model: PixelModel | null): void => {
    if (spliceLayoutModel === model) return;
    spliceLayouts.clear();
    spliceLayoutModel = model;
    generators.reset();
    mixScratch = mixInputScratch = null;
    spliceBuffers = [];
  };

  return {
    prunePresentation(voices, model): void {
      // Prune BEFORE binding voice geometry: a reset slab's undefined renderModel is
      // an ownership fence even if its public id/seed/birth have been reused.
      checkpoint.prune(voices, model);
      bindModel(model);
      for (const v of voices) if (v.active) ensureGeometryState(v, model);
    },
    renderPresentation(voices, model, frame, dst, tick): void {
      checkpoint(voices, model, tick);
      this.render(voices, model, frame, dst);
    },
    render(voices, model, frame, dst): void {
      dst.clear();
      // Equal pixel totals/ranges can hide changed hoop or drum boundaries.
      bindModel(model);
      const timeMs = frame.timeMs;
      frameCtx.timeMs = timeMs;
      frameCtx.bpm = frame.transport.bpm;
      frameCtx.cc = frame.cc;
      frameCtx.osc = frame.osc;
      frameCtx.notes = frame.notes;

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
        ensureGeometryState(v, model);
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
          // The cascade span is a frame/member invariant. Resolve it once and reuse it for
          // both the regeneration gate and looping pulse duration; the helper scans the model.
          const cascadeDelayMs = maxCascadeDelayMs(model, cfg);
          const materialRegeneration = cascadeDelayMs > 0;

          // 1. Render each member ONCE over the voice's whole range. Bands reveal these renders,
          //    so an effect keeps its real geometry (a comet still travels the hoop).
          for (let i = 0; i < v.spliceInputs.length; i++) {
            const member = v.spliceInputs[i]!;
            const buf = buffers[i]!;
            buf.clear();
            for (const key in member.liveParams) delete member.liveParams[key];
            for (const key in member.params) member.liveParams[key] = member.params[key]!;
            if (member.modulations?.length) {
              applyModulations(member.params, member.liveParams, member.modulations, member.specs, writeModCtx(modCtxScratch, v, frameCtx));
            }
            fillMixInputVoice(compositeVoiceScratch, member, v, true);
            const memberVoice = compositeVoiceScratch;
            const memberCtx = writeModCtx(modCtxScratch, memberVoice, frameCtx);
            // A splice may carry a hit-driven effect farther than that effect's own visible
            // life. The bridge owns the bounded fresh-state cycle and renders at most one extra
            // generation during its short boundary crossfade; the splice still receives one
            // reusable material buffer per member.
            // Life is an authored material property, so modulation of a live numeric value must
            // not resize or reset the member's lifecycle mid-voice. This mirrors the spawn-time
            // voice-life resolution and keeps cycle boundaries deterministic.
            memberVoice.materialCycleMs = materialRegeneration ? member.materialCycleMs : undefined;
            if (!materialRegeneration) memberVoice.materialCycle = undefined;
            generators.renderVoice(memberVoice, model, timeMs, 1, ranges, buf, memberCtx);
            syncMixInputState(member, memberVoice, true);
          }

          // 2. Cut the bands (cached — the cut never moves; only what shows in it does).
          const layoutKey = spliceLayoutKey(cfg, model, ranges);
          let units = spliceLayouts.get(layoutKey);
          if (!units) {
            if (spliceLayouts.size >= SPLICE_LAYOUT_CACHE_CAP) spliceLayouts.clear();
            units = buildSpliceUnits(cfg, model, ranges);
            spliceLayouts.set(layoutKey, units);
          }

          // 3. Record which partition units contain current material. Empty units borrow the
          // first material-bearing unit for that member, while a member empty everywhere stays
          // empty. The scratch belongs to the pooled voice and survives ordinary frames.
          const coverage = ensureSpliceCoverage(v, v.spliceInputs.length, units.length);
          for (let memberIndex = 0; memberIndex < v.spliceInputs.length; memberIndex++) {
            scanSpliceCoverage(coverage, memberIndex, buffers[memberIndex]!.rgba, units);
          }

          // 4. Reveal each band from its member's buffer, tinted by that splice's colour.
          const { mix } = ensureScratch();
          mix.clear();
          const age = timeMs - v.bornAtMs;
          // Motion clock: `restart` runs off the voice's own age, so each hit starts the
          // movement over; `continuous` runs off the engine clock every voice shares, so a
          // hit picks up exactly where the last one left off. Only the MOTION reads this —
          // the envelope and the modifier chain stay voice-relative either way.
          // A `pulse` on a looping/held voice repeats: without this it fires once and the kit
          // stays dark for the voice's whole life. The cycle spans the cascade + one envelope,
          // so every unit restarts together and the travelling shape is preserved.
          const pulseCycleMs =
            cfg.waitMode === 'pulse' && v.mode !== 'oneshot'
              ? splicePulseCycleMs(cascadeDelayMs, cfg.envelope)
              : 0;
          const motionClock =
            cfg.motionMode === 'continuous'
              ? timeMs
              : cfg.motionMode === 'latched'
                ? (v.spliceMotionMs ?? 0) // only ran while lit — see `advanceLatchedSpliceMotion`
                : age;
          const dstRgba = mix.rgba;
          for (let unitIndex = 0; unitIndex < units.length; unitIndex++) {
            const unit = units[unitIndex]!;
            const len = unit.end - unit.start;
            // Each unit runs on its own clock, so an offset cascade starts hoop after hoop —
            // and, on a kit-wide splice, drum after drum. With no offsets every unit gets the
            // shared clock and this is the previous behaviour exactly.
            const delay = unitCascadeDelayMs(unit.orderIndex, unit.drumOrderIndex, cfg);
            // `dark` holds a unit black until its turn, so the LIGHT travels across the kit
            // rather than the movement travelling through already-lit hoops. Measured against
            // the voice's own age, not the motion clock — `continuous` has no zero to count a
            // delay from, and a hit should always cascade from the moment it was struck.

            const unitAge = unitMotionAge(motionClock, delay);
            const stepOffset = cfg.chase === 'step' ? chaseStepOffset(unitAge, cfg.chaseMs, cfg.direction) : 0;
            // Rotation is a STATIC phase on the cut, so it rides the same shift the chase uses.
            const shift =
              spliceRotationPx(cfg.rotationDeg, len) +
              (cfg.chase === 'smooth'
                ? chasePixelShift(unitAge, cfg.chaseMs, cfg.direction, len)
                : cfg.chase === 'stagger'
                  ? chaseStaggerShift(unitAge, cfg.chaseMs, cfg.direction, cfg.incrementPx)
                  : 0);
            const feather = spliceFeatherPx(cfg.smudge, unit.bands, len);
            forEachSpliceSegment(unit.bands, len, shift, stepOffset, feather, (slot, bandStart, bandEnd, w0, w1, bandIndex, bandOffset) => {
              const inputIndex = cfg.inputBySlot[slot] ?? -1;
              if (inputIndex < 0) return; // a blank splice shows nothing
              // The reveal is per SPLICE, not just per unit: a colour offset staggers when each
              // colour arrives on top of when its hoop's turn came. The MOTION clock deliberately
              // ignores it — the colours arrive in order, they do not each chase at a different phase.
              const reveal = delay + colorCascadeDelayMs(slot, cfg);
              if (cfg.waitMode !== 'lit' && reveal > 0 && age < reveal) return;
              // `pulse` runs the AUTHORED envelope from this splice's own arrival, so the light
              // travels as a pulse instead of a leading edge. The voice's level still multiplies
              // in below, and the voice was extended at spawn to outlive the whole cascade.
              // Past its first turn a repeating pulse wraps into the next cycle.
              const ownAge = pulseCycleMs > 0 ? (age - reveal) % pulseCycleMs : age - reveal;
              const unitLevel =
                cfg.waitMode === 'pulse'
                  ? unitEnvelopeLevel(ownAge, cfg.envelope.attackMs, cfg.envelope.sustainMs, cfg.envelope.releaseMs, cfg.attackEase)
                  : cfg.waitMode === 'fade'
                    ? unitFadeInLevel(age - reveal, cfg.envelope.attackMs, cfg.attackEase)
                    : 1;
              if (unitLevel <= 0) return;
              const materialRow = inputIndex * coverage.unitCount;
              const sourceUnitIndex = coverage.materialUnits[materialRow + unitIndex] === 1
                ? unitIndex
                : coverage.sourceUnitByMember[inputIndex]!;
              const from = units[sourceUnitIndex];
              if (!from) return; // this member rendered nothing anywhere this frame
              const destinationBand = unit.bands[bandIndex];
              const sourceBand = from.bands[slot];
              if (!destinationBand || !sourceBand) return;
              const src = buffers[inputIndex]!.rgba;
              const colour = spliceTintColour(cfg.colors[slot]);
              const span = bandEnd - bandStart;
              for (let i = 0; i < span; i++) {
                const p = unit.start + bandStart + i;
                const j = p * 4;
                // Material follows its selected source band. Stretching is proportional when
                // source and destination runs differ, and edge-clamping keeps smudge ramps from
                // bleeding into a neighbouring source band.
                const sourceOffset = spliceSourceOffset(bandOffset + i, destinationBand.width, sourceBand);
                if (sourceOffset < 0) continue;
                const sj = (from.start + sourceOffset) * 4;
                const r = src[sj]!;
                const g = src[sj + 1]!;
                const b = src[sj + 2]!;
                const a = src[sj + 3]!;
                if (r <= 0 && g <= 0 && b <= 0 && a <= 0) continue;
                // Accumulate, never assign: across a smudge two neighbouring splices write the
                // same pixel with complementary weights that sum to 1. With no smudge the
                // weights are 1 and the bands never overlap, so this is still a plain copy.
                const w = (span <= 1 ? w0 : w0 + (w1 - w0) * (i / span)) * unitLevel;
                if (w <= 0) continue;
                if (colour) {
                  const t = tintPixel(r, g, b, colour, cfg.tint);
                  dstRgba[j] = dstRgba[j]! + t.r * w;
                  dstRgba[j + 1] = dstRgba[j + 1]! + t.g * w;
                  dstRgba[j + 2] = dstRgba[j + 2]! + t.b * w;
                } else {
                  dstRgba[j] = dstRgba[j]! + r * w;
                  dstRgba[j + 1] = dstRgba[j + 1]! + g * w;
                  dstRgba[j + 2] = dstRgba[j + 2]! + b * w;
                }
                dstRgba[j + 3] = dstRgba[j + 3]! + a * w;
              }
            });
          }

          // 5. Downstream modifiers see the assembled splice frame, then it lands in `dst`
          //    scaled by the voice envelope — the same tail as the Mix branch.
          const spliceMods = v.modifiers;
          if (spliceMods && spliceMods.length) {
            if (!v.modState) v.modState = [];
            const modCtx = writeModCtx(modCtxScratch, v, frameCtx);
            applyScopedModifierChain(spliceMods, v.modState, mix, ranges, model, age, frame.dt, modCtx);
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
            for (const key in branch.liveParams) delete branch.liveParams[key];
            for (const key in branch.params) branch.liveParams[key] = branch.params[key]!;
            if (branch.modulations?.length) {
              applyModulations(branch.params, branch.liveParams, branch.modulations, branch.specs, writeModCtx(modCtxScratch, v, frameCtx));
            }
            fillMixInputVoice(compositeVoiceScratch, branch, v, false);
            const branchVoice = compositeVoiceScratch;
            const branchCtx = writeModCtx(modCtxScratch, branchVoice, frameCtx);
            generators.renderVoice(branchVoice, model, timeMs, 1, pixelRangesFor(branchVoice, model), input, branchCtx);
            syncMixInputState(branch, branchVoice, false);
            const src = input.rgba;
            for (let i = 0; i < src.length; i += 4) {
              compositeInto(mix.rgba, i, src[i]!, src[i + 1]!, src[i + 2]!, src[i + 3]!, v.mixBlendMode ?? 'normal', branch.opacity);
            }
          }

          const ranges = pixelRangesFor(v, model);
          const mods = v.modifiers;
          if (mods && mods.length) {
            if (!v.modState) v.modState = [];
            const modCtx = writeModCtx(modCtxScratch, v, frameCtx);
            applyScopedModifierChain(mods, v.modState, mix, ranges, model, timeMs - v.bornAtMs, frame.dt, modCtx);
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

        // One generation/temporal advance, followed by the canonical multi-range mask.
        const modCtx = writeModCtx(modCtxScratch, v, frameCtx);
        generators.renderVoice(v, model, timeMs, level, pixelRangesFor(v, model), dst, modCtx);
      }
    },
  };
}

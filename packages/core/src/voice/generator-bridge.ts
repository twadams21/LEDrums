/**
 * Hosted-generator bridge — renders a voice backed by a legacy
 * {@link import('../effects/types').EffectGenerator} from `effects/registry`. The
 * compositor builds a {@link RenderContext}, keeps the voice's per-instance generator
 * state, renders the whole-frame generator into a reused scratch framebuffer, then
 * composites it into `dst` scaled by the voice envelope and masked to the voice's pixel
 * range. This is how all 41 original effects reach real output without being rewritten
 * as per-pixel patterns.
 *
 * Deterministic: no IO, no wall-clock, no `Math.random` (legacy generators carry seeded
 * RNG in their state). The voice model has no live trigger stream, so a generator voice
 * is fed ONE synthetic trigger representing its own originating hit (age grows with the
 * voice; seq is stable so accumulators fire once).
 *
 * Per-frame scratch — one {@link Framebuffer}, one {@link RenderContext}, one {@link Trigger},
 * and the per-generator default-param cache —
 * is owned by the bridge instance and reused across every voice in the frame. Ordinary voices
 * and ordinary splice frames still use one generator render. An adjacent life boundary blends
 * one fresh render with a frozen previous output retained by that member's cycle state.
 */
import { Framebuffer } from '../engine/framebuffer';
import type { PixelModel } from '../geometry/pixel-model';
import type { RenderContext, TransportState, Trigger } from '../engine/render-context';
import { defaultParams, type EffectGenerator, type ResolvedParams } from '../effects/types';
import { tryGetEffect } from '../effects/registry';
import { applyScopedModifierChain } from '../modifiers/chain';
import type { PixelRange } from '../modifiers/types';
import type { ModSampleCtx } from './modulation';
import { deriveSeed } from './prng';
import type { MaterialCycleState } from './geometry-state';
import type { Voice } from './types';

/** Renders hosted-generator voices into a destination framebuffer. Call {@link
    GeneratorBridge.beginFrame} once per frame before rendering any voice. */
export interface GeneratorBridge {
  /** Drop the previous model/context without running a generator (presentation may stop). */
  reset(): void;
  /** Refresh the reusable {@link RenderContext} for this frame (rebuilt only when the
      model identity changes; otherwise the existing context's fields are updated). */
  beginFrame(model: PixelModel, timeMs: number, dt: number, transport: TransportState): void;
  /**
   * Generate once, then mask into `dst` over canonical pixel `ranges`, scaled by
   * `level` (voice envelope × deck gain). Unknown generator ids render nothing (the
   * voice never falls through to the pattern path). `modCtx` (built by the compositor from
   * the voice's life phase + transport) lets a modified generator's chain modulate its
   * modifier params (doc 10); it is inert for an unmodified / unmodulated voice.
   */
  renderVoice(
    v: Voice,
    model: PixelModel,
    timeMs: number,
    level: number,
    ranges: readonly PixelRange[],
    dst: Framebuffer,
    modCtx: ModSampleCtx,
  ): void;
}

/** A material cycle is intentionally short-lived: only the outgoing framebuffer survives
 * long enough to crossfade into its fresh successor. Every frame renders one generation. */
const MATERIAL_CROSSFADE_MS = 100;
const MATERIAL_SEED_SALT = 0x51ce1e;
const MATERIAL_SEQ_SALT = 0x6c9e3779;

function positiveAge(timeMs: number, bornAtMs: number): number {
  const age = timeMs - bornAtMs;
  return age > 0 ? age : 0;
}

function cycleSeed(base: number, cycleIndex: number): number {
  return cycleIndex === 0 ? base : deriveSeed(base, (cycleIndex + MATERIAL_SEED_SALT) | 0);
}

function cycleSeq(base: number, cycleIndex: number): number {
  if (cycleIndex === 0) {
    const seq = Number(base);
    return Number.isFinite(seq) && seq > 0 ? seq : 1;
  }
  return deriveSeed(base, (cycleIndex + MATERIAL_SEQ_SALT) | 0) || 1;
}

function voiceSeq(id: string): number {
  const seq = Number(id.slice(1));
  return Number.isFinite(seq) && seq > 0 ? seq : 1;
}

function materialCycleFor(
  v: Voice,
  model: PixelModel,
  timeMs: number,
  cycleMs: number,
): { cycle: MaterialCycleState; ageMs: number; cycleAgeMs: number; fadeMs: number } {
  const ageMs = positiveAge(timeMs, v.bornAtMs);
  const cycleIndex = Math.floor(ageMs / cycleMs);
  const cycleAgeMs = ageMs - cycleIndex * cycleMs;
  const fadeMs = Math.min(MATERIAL_CROSSFADE_MS, cycleMs * 0.25);
  const baseSeq = voiceSeq(v.id);
  let cycle = v.materialCycle;

  if (!cycle || cycle.cycleIndex !== cycleIndex) {
    const prior = cycle;
    const oldCycleIndex = cycle?.cycleIndex ?? cycleIndex - 1;
    const adjacent = prior != null && cycleIndex === prior.cycleIndex + 1;
    // Only the immediately preceding cycle may crossfade. A jump over one cycle starts
    // without any stale outgoing material.
    const outgoing = adjacent ? prior.currentFrame : null;
    // Recycle the old outgoing buffer after its bounded crossfade. This keeps the carriers
    // bounded to one current and one previous framebuffer per member.
    const reusable = prior?.previous?.framebuffer;
    const currentSeed = cycleSeed(v.seed, cycleIndex);
    cycle = {
      cycleIndex,
      currentSeed,
      currentSeq: cycleSeq(baseSeq, cycleIndex),
      currentRendered: false,
      currentFrame: reusable ?? new Framebuffer(model.pixelCount),
      previous: outgoing ? {
        cycleIndex: oldCycleIndex,
        seed: prior!.currentSeed,
        seq: prior!.currentSeq,
        framebuffer: outgoing,
      } : null,
    };
    // No previous generation exists on a voice's first material render. A long first tick
    // still starts directly at its deterministic cycle rather than crossfading from null.
    if (!prior || cycleIndex < oldCycleIndex || oldCycleIndex < 0) cycle.previous = null;
    v.materialCycle = cycle;
    v.genState = null;
  }

  // The outgoing framebuffer is useful only during its boundary window. Release it before the
  // next cycle so a particle/emitter state cannot accumulate one retained generation per
  // cycle. The checkpoint captures this ownership transition like any other render state.
  if (cycle.previous && cycleAgeMs >= fadeMs) cycle.previous = null;
  return { cycle, ageMs, cycleAgeMs, fadeMs };
}

export function createGeneratorBridge(resolveEffect: (id: string) => EffectGenerator | undefined = tryGetEffect): GeneratorBridge {
  let genScratch: Framebuffer | null = null;
  /** Defaults belong to the registry adapter, not its id (live upserts can replace it). */
  const genDefaults = new WeakMap<object, ResolvedParams>();
  /** Reused overlay for the synchronous generator call; never retained by generators. */
  const genParams: ResolvedParams = {};
  /** One synthetic trigger, mutated per generator voice (the voice's own hit). */
  const genTrigger: Trigger = { seq: 1, drumId: '', note: 0, velocity: 1, timeMs: 0, ageMs: 0 };
  const genTriggers: Trigger[] = [genTrigger];
  /** Reused RenderContext (rebuilt only when the model identity changes). */
  let genCtx: RenderContext | null = null;
  /** This frame's absolute transport, copied behind the generator context boundary. */
  let frameTransport: TransportState | null = null;
  /** Bridge-owned voice-local transport, refilled per voice-timebase voice so we never
      touch the shared frame transport (a `timebase:'voice'` generator reads this). */
  const voiceTransport: TransportState = {
    timeMs: 0, beat: 0, bar: 0, beatInBar: 0, bpm: 120, beatsPerBar: 4, playing: true,
  };

  return {
    reset(): void {
      genCtx = null;
      frameTransport = null;
      genScratch = null;
    },
    beginFrame(model, timeMs, dt, transport): void {
      if (!frameTransport) frameTransport = { ...transport };
      else Object.assign(frameTransport, transport);
      // The triggers array reference is stable; its single element is mutated per voice.
      if (!genCtx || genCtx.model !== model) {
        genCtx = { model, timeMs, dt, transport: frameTransport, triggers: genTriggers };
      } else {
        genCtx.timeMs = timeMs;
        genCtx.dt = dt;
        genCtx.transport = frameTransport;
      }
    },

    renderVoice(v, model, timeMs, level, ranges, dst, modCtx): void {
      if (!ranges.length) return;
      const gen = resolveEffect(v.generatorId!);
      if (!gen) return; // unknown id → render nothing (don't fall through to pattern)
      if (!genCtx || !frameTransport) return; // beginFrame not called this frame (never happens in practice)
      if (!genScratch || genScratch.pixelCount !== model.pixelCount) {
        genScratch = new Framebuffer(model.pixelCount);
      }
      if (v.renderGenerator !== gen) {
        v.genState = null;
        v.materialCycle = undefined;
        v.renderGenerator = gen;
      }

      // Resolved params: generator defaults (incl. enum/colour) overlaid with the
      // voice's live numeric/bool params (envelopes already applied by the engine).
      let defs = genDefaults.get(gen);
      if (!defs) {
        defs = defaultParams(gen.paramSpec);
        genDefaults.set(gen, defs);
      }
      for (const key in genParams) delete genParams[key];
      for (const key in defs) genParams[key] = defs[key]!;
      const lp = v.liveParams;
      for (const k in lp) {
        const val = lp[k];
        if (val !== undefined) genParams[k] = val;
      }

      const normalAge = positiveAge(timeMs, v.bornAtMs);
      const cycleMs = v.materialCycleMs ?? 0;
      const material = cycleMs > 0 ? materialCycleFor(v, model, timeMs, cycleMs) : null;
      if (material && v.genState == null && gen.createState) v.genState = gen.createState(model, material.cycle.currentSeed);
      const frameDt = genCtx.dt;
      const mods = v.modifiers;

      const renderGeneration = (
        state: unknown,
        clockAgeMs: number,
        seq: number,
        cycleIndex: number,
        out: Framebuffer,
        dt: number,
      ): void => {
        // RenderContext is a shared adapter object. Snapshot every mutable carrier before
        // handing it to legacy generator code, and restore in finally so a throw cannot leak
        // a cycle clock, trigger, transport, or authored-decay flag into the next render.
        const priorModel = genCtx!.model;
        const priorTimeMs = genCtx!.timeMs;
        const priorDt = genCtx!.dt;
        const priorTransport = genCtx!.transport;
        const priorTriggers = genCtx!.triggers;
        const priorAuthoredDecay = genCtx!.authoredDecay;
        const priorTriggerSeq = genTrigger.seq;
        const priorTriggerDrumId = genTrigger.drumId;
        const priorTriggerNote = genTrigger.note;
        const priorTriggerVelocity = genTrigger.velocity;
        const priorTriggerTimeMs = genTrigger.timeMs;
        const priorTriggerAgeMs = genTrigger.ageMs;
        const priorFrameTimeMs = frameTransport!.timeMs;
        const priorFrameBeat = frameTransport!.beat;
        const priorFrameBar = frameTransport!.bar;
        const priorFrameBeatInBar = frameTransport!.beatInBar;
        const priorFrameBpm = frameTransport!.bpm;
        const priorFrameBeatsPerBar = frameTransport!.beatsPerBar;
        const priorFramePlaying = frameTransport!.playing;
        const priorVoiceTimeMs = voiceTransport.timeMs;
        const priorVoiceBeat = voiceTransport.beat;
        const priorVoiceBar = voiceTransport.bar;
        const priorVoiceBeatInBar = voiceTransport.beatInBar;
        const priorVoiceBpm = voiceTransport.bpm;
        const priorVoiceBeatsPerBar = voiceTransport.beatsPerBar;
        const priorVoicePlaying = voiceTransport.playing;
        // Synthetic trigger = this voice's originating hit, or this cycle's deterministic
        // retrigger. The clock and transport are derived from the same cycle age, so a
        // generator cannot observe a wrapped time with an unwrapped beat/age companion.
        genTrigger.seq = seq;
        genTrigger.drumId = v.sourceDrumId ?? '';
        genTrigger.velocity = v.velocity;
        genTrigger.note = Math.round(v.velocity * 127);
        genTrigger.timeMs = v.bornAtMs + (material ? cycleIndex * cycleMs : 0);
        genTrigger.ageMs = clockAgeMs;
        genCtx!.dt = dt;
        genCtx!.authoredDecay = v.lifeEnvelope != null;
        const ft = frameTransport!;
        const beats = (clockAgeMs / 60000) * ft.bpm;
        voiceTransport.timeMs = clockAgeMs;
        voiceTransport.beat = beats;
        voiceTransport.bar = Math.floor(beats / ft.beatsPerBar);
        voiceTransport.beatInBar = beats - voiceTransport.bar * ft.beatsPerBar;
        voiceTransport.bpm = ft.bpm;
        voiceTransport.beatsPerBar = ft.beatsPerBar;
        voiceTransport.playing = ft.playing;
        // A splice material cycle is a deliberate fresh clock for both hosting styles. The
        // ordinary path below preserves absolute effects' free-running transport exactly.
        const cycleClock = material !== null;
        const voiceClock = cycleClock || (gen.timebase ?? 'absolute') === 'voice';
        genCtx!.timeMs = voiceClock ? clockAgeMs : timeMs;
        genCtx!.transport = voiceClock ? voiceTransport : ft;
        try {
          out.clear();
          gen.render(genCtx!, genParams, out, state as never);
        } finally {
          genCtx!.model = priorModel;
          genCtx!.timeMs = priorTimeMs;
          genCtx!.dt = priorDt;
          genCtx!.transport = priorTransport;
          genCtx!.triggers = priorTriggers;
          genCtx!.authoredDecay = priorAuthoredDecay;
          genTrigger.seq = priorTriggerSeq;
          genTrigger.drumId = priorTriggerDrumId;
          genTrigger.note = priorTriggerNote;
          genTrigger.velocity = priorTriggerVelocity;
          genTrigger.timeMs = priorTriggerTimeMs;
          genTrigger.ageMs = priorTriggerAgeMs;
          genTriggers.length = 1;
          genTriggers[0] = genTrigger;
          frameTransport!.timeMs = priorFrameTimeMs;
          frameTransport!.beat = priorFrameBeat;
          frameTransport!.bar = priorFrameBar;
          frameTransport!.beatInBar = priorFrameBeatInBar;
          frameTransport!.bpm = priorFrameBpm;
          frameTransport!.beatsPerBar = priorFrameBeatsPerBar;
          frameTransport!.playing = priorFramePlaying;
          voiceTransport.timeMs = priorVoiceTimeMs;
          voiceTransport.beat = priorVoiceBeat;
          voiceTransport.bar = priorVoiceBar;
          voiceTransport.beatInBar = priorVoiceBeatInBar;
          voiceTransport.bpm = priorVoiceBpm;
          voiceTransport.beatsPerBar = priorVoiceBeatsPerBar;
          voiceTransport.playing = priorVoicePlaying;
        }
      };

      if (!material) {
        if (v.genState == null && gen.createState) v.genState = gen.createState(model, v.seed);
        renderGeneration(v.genState, normalAge, voiceSeq(v.id), 0, genScratch, frameDt);
      } else {
        const output = mods?.length ? genScratch : material.cycle.currentFrame;
        renderGeneration(v.genState, material.cycleAgeMs, material.cycle.currentSeq, material.cycle.cycleIndex, output, material.cycle.currentRendered ? frameDt : material.cycleAgeMs);
        material.cycle.currentRendered = true;
        const previous = material.cycle.previous;
        const weight = previous && material.cycleAgeMs < material.fadeMs
          ? 1 - material.cycleAgeMs / material.fadeMs
          : 0;
        if (mods?.length) {
          // Preserve the raw current output. It is the only frame allowed to become the
          // next cycle's frozen outgoing material; the crossfade is an assembled-frame step.
          material.cycle.currentFrame.rgba.set(genScratch.rgba);
        }
        if (previous && weight > 0 && mods?.length) {
          const current = genScratch.rgba;
          const old = previous.framebuffer.rgba;
          for (let i = 0; i < current.length; i++) current[i] = current[i]! * (1 - weight) + old[i]! * weight;
        }
      }

      // Modifier chain (media effects) runs once over the assembled material. A crossfade
      // must not advance a stateful modifier twice or make its output depend on the frame's
      // position inside the regeneration window.
      if (mods && mods.length) {
        if (!v.modState) v.modState = [];
        applyScopedModifierChain(mods, v.modState, genScratch, ranges, model, normalAge, frameDt, modCtx);
      }

      // Composite scratch → dst, scaled by the voice envelope (brightness is
      // applied inside the generator), masked to the selected pixel set. dst.add clamps.
      const src = material && !mods?.length ? material.cycle.currentFrame.rgba : genScratch.rgba;
      const frozen = material && !mods?.length && material.cycle.previous &&
        material.cycleAgeMs < material.fadeMs
        ? material.cycle.previous.framebuffer.rgba
        : null;
      const frozenWeight = frozen ? 1 - material!.cycleAgeMs / material!.fadeMs : 0;
      for (const range of ranges) for (let i = range.start; i < range.end; i++) {
        const j = i * 4;
        const r = frozen ? src[j]! * (1 - frozenWeight) + frozen[j]! * frozenWeight : src[j]!;
        const g = frozen ? src[j + 1]! * (1 - frozenWeight) + frozen[j + 1]! * frozenWeight : src[j + 1]!;
        const b = frozen ? src[j + 2]! * (1 - frozenWeight) + frozen[j + 2]! * frozenWeight : src[j + 2]!;
        const a = frozen ? src[j + 3]! * (1 - frozenWeight) + frozen[j + 3]! * frozenWeight : src[j + 3]!;
        if (r <= 0 && g <= 0 && b <= 0 && a <= 0) continue;
        dst.add(i, r * level, g * level, b * level, a * level);
      }
    },
  };
}

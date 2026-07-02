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
 * Per-frame scratch — one {@link Framebuffer}, one {@link RenderContext}, one
 * {@link Trigger}, and the per-generator default-param cache — is owned by the bridge
 * instance and reused across every voice in the frame; the only per-generator-voice
 * allocation is the merged params object (generator defaults overlaid with live params).
 */
import { Framebuffer } from '../engine/framebuffer';
import type { PixelModel } from '../geometry/pixel-model';
import type { RenderContext, TransportState, Trigger } from '../engine/render-context';
import { defaultParams, type ResolvedParams } from '../effects/types';
import { tryGetEffect } from '../effects/registry';
import type { Voice } from './types';

/** Renders hosted-generator voices into a destination framebuffer. Call {@link
    GeneratorBridge.beginFrame} once per frame before rendering any voice. */
export interface GeneratorBridge {
  /** Refresh the reusable {@link RenderContext} for this frame (rebuilt only when the
      model identity changes; otherwise the existing context's fields are updated). */
  beginFrame(model: PixelModel, timeMs: number, dt: number, transport: TransportState): void;
  /**
   * Render one generator voice into `dst` over pixel range `[start, end)`, scaled by
   * `level` (voice envelope × deck gain). Unknown generator ids render nothing (the
   * voice never falls through to the pattern path).
   */
  renderVoice(v: Voice, model: PixelModel, timeMs: number, level: number, start: number, end: number, dst: Framebuffer): void;
}

export function createGeneratorBridge(): GeneratorBridge {
  let genScratch: Framebuffer | null = null;
  /** Cached default param record per generator id (incl. enum/colour string defaults). */
  const genDefaults = new Map<string, ResolvedParams>();
  /** One synthetic trigger, mutated per generator voice (the voice's own hit). */
  const genTrigger: Trigger = { seq: 1, drumId: '', note: 0, velocity: 1, timeMs: 0, ageMs: 0 };
  const genTriggers: Trigger[] = [genTrigger];
  /** Reused RenderContext (rebuilt only when the model identity changes). */
  let genCtx: RenderContext | null = null;
  /** This frame's absolute transport (engine's, held by reference — never mutated). */
  let frameTransport: TransportState | null = null;
  /** Bridge-owned voice-local transport, refilled per voice-timebase voice so we never
      touch the shared frame transport (a `timebase:'voice'` generator reads this). */
  const voiceTransport: TransportState = {
    timeMs: 0, beat: 0, bar: 0, beatInBar: 0, bpm: 120, beatsPerBar: 4, playing: true,
  };

  return {
    beginFrame(model, timeMs, dt, transport): void {
      frameTransport = transport;
      // The triggers array reference is stable; its single element is mutated per voice.
      if (!genCtx || genCtx.model !== model) {
        genCtx = { model, timeMs, dt, transport, triggers: genTriggers };
      } else {
        genCtx.timeMs = timeMs;
        genCtx.dt = dt;
        genCtx.transport = transport;
      }
    },

    renderVoice(v, model, timeMs, level, start, end, dst): void {
      const gen = tryGetEffect(v.generatorId!);
      if (!gen) return; // unknown id → render nothing (don't fall through to pattern)
      if (!genCtx || !frameTransport) return; // beginFrame not called this frame (never happens in practice)
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

      // Timebase: swap the clock the generator reads, without changing its signature.
      // 'absolute' (default) — the engine's wall-clock + transport, exactly as before, so
      //   free-running base/ambient effects are byte-for-byte unchanged.
      // 'voice' — a hit-relative clock: ctx.timeMs = trig.ageMs and a voice-local transport
      //   whose beat is derived from age×bpm (so beat-indexed effects like chase start at
      //   their start position on the hit and restart on retrigger, since a retrigger is a
      //   new voice whose age is 0).
      if ((gen.timebase ?? 'absolute') === 'voice') {
        const ft = frameTransport;
        const beats = (genTrigger.ageMs / 60000) * ft.bpm; // age×bpm; matches transport.beat's accumulation
        voiceTransport.timeMs = genTrigger.ageMs;
        voiceTransport.beat = beats;
        voiceTransport.bar = Math.floor(beats / ft.beatsPerBar);
        voiceTransport.beatInBar = beats - voiceTransport.bar * ft.beatsPerBar;
        voiceTransport.bpm = ft.bpm;
        voiceTransport.beatsPerBar = ft.beatsPerBar;
        voiceTransport.playing = ft.playing;
        genCtx.timeMs = genTrigger.ageMs;
        genCtx.transport = voiceTransport;
      } else {
        genCtx.timeMs = timeMs;
        genCtx.transport = frameTransport;
      }

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
    },
  };
}

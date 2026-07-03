/**
 * Inner seam — the voices → pixels hotspot. {@link Compositor.render} accumulates each
 * live voice into the destination {@link Framebuffer}. A voice renders one of two ways,
 * each behind its own module so the perf hotspot stays swappable:
 *
 * - **Pattern voice** (fast path): samples a lightweight procedural pattern per pixel —
 *   see `pattern-renderer.ts`.
 * - **Generator voice** (bridge): hosts a legacy `EffectGenerator` from `effects/registry`
 *   — see `generator-bridge.ts`.
 *
 * This module owns the shared per-frame orchestration: clearing `dst`, the per-voice
 * level gate, the drum-scope pixel mask, and dispatching each voice to the right
 * renderer. It also resolves a voice's live params (envelope + tempo-sync) — the engine
 * calls {@link applyEffectiveParams} before `render`, so the inner loop reads only
 * already-resolved `liveParams`.
 *
 * Deterministic: no IO, no wall-clock, no `Math.random`. Zero-alloc on the pattern fast
 * path; generators run far fewer voices (mono buses, level gating), so the bridge's
 * per-voice merged-params object stays well within budget — see the perf note below.
 */
import { Framebuffer } from '../engine/framebuffer';
import { getHoopPixelRange, type PixelModel } from '../geometry/pixel-model';
import type { TransportState } from '../engine/render-context';
import { applyModifierChain } from '../modifiers/chain';
import type { PixelRange } from '../modifiers/types';
import { applyModulations, type ModSampleCtx } from './modulation';
import { buildPixelAttrs, createPatternRenderer, type PixelAttrs } from './pattern-renderer';
import { createGeneratorBridge } from './generator-bridge';
import type { ParamValues, Voice } from './types';

// `buildPixelAttrs` / `PixelAttrs` live with the pattern renderer (which samples them);
// re-exported here so the `./compositor` import surface — consumed by the engine and the
// voice barrel — is unchanged.
export { buildPixelAttrs, type PixelAttrs };

const num = (v: number | boolean | string | undefined, d: number): number => (typeof v === 'number' ? v : d);

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
  // Modulation mappings (doc 10): summed-and-clamped contributions over the spawn-snapshot base.
  // Envelope sources sample the voice-life `phase` (restart per hit); continuous sources read the
  // absolute clock + tempo. The legacy per-param env sweep folded into these mappings in S35.
  const mods = v.modulations;
  if (mods && mods.length) {
    applyModulations(v.params, out, mods, v.specs, { phase: voicePhase(v, timeMs), timeMs, bpm });
  }
  if (out.tempoSync === true) out.speed = num(out.speed, 1) * (bpm / 120);
  return out;
}

/** Build the per-frame modulation-sample context for a voice — its life phase (envelope
    sources restart per hit) plus the absolute clock + tempo continuous sources (S36/S37)
    read. Shared by the play-param sweep and the modifier chain so both restart together. */
function modCtxFor(v: Voice, timeMs: number, bpm: number): ModSampleCtx {
  return { phase: voicePhase(v, timeMs), timeMs, bpm };
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
 * Owns one pattern renderer and one generator bridge for its lifetime; both keep their
 * own reused scratch, so the only per-generator-voice allocation is the bridge's merged
 * params object (see `generator-bridge.ts`). Generators run far fewer voices (mono
 * buses, level gating) than the per-pixel pattern path, so this stays well within budget.
 */
export function createDefaultCompositor(): Compositor {
  const patterns = createPatternRenderer();
  const generators = createGeneratorBridge();
  /** Scratch framebuffer for MODIFIED pattern voices only — an unmodified pattern voice
      writes straight to `dst` (zero-alloc hot path). Lazily sized to the model. */
  let patScratch: Framebuffer | null = null;
  const modRange: PixelRange = { start: 0, end: 0 };

  return {
    render(voices, model, attrs, frame, dst): void {
      dst.clear();
      const timeMs = frame.timeMs;
      const t = timeMs / 1000;

      // Refresh the reusable hosted-generator RenderContext for this frame.
      generators.beginFrame(model, timeMs, frame.dt, frame.transport);

      for (const v of voices) {
        if (!v.active) continue;
        const level = v.level * v.deckGain;
        if (level <= 0.003) continue;

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
          const range = getHoopPixelRange(model, drumId, hoopIndex);
          if (!range) continue; // dangling → render nothing
          start = range.start;
          end = range.end;
        }
        // scope === 'kit': start=0, end=model.pixelCount (whole kit, targetId ignored)

        if (v.generatorId) {
          // Hosted legacy-generator voice — never falls through to the pattern path.
          const modCtx = modCtxFor(v, timeMs, frame.transport.bpm);
          generators.renderVoice(v, model, timeMs, level, start, end, dst, modCtx);
          continue;
        }

        // Pattern voice. Modified voices route through a scratch so the chain can transform
        // the rendered pixels before they blend into `dst`; unmodified voices write directly
        // (the zero-alloc fast path is untouched).
        const mods = v.modifiers;
        if (mods && mods.length) {
          if (!patScratch || patScratch.pixelCount !== model.pixelCount) {
            patScratch = new Framebuffer(model.pixelCount);
          }
          patScratch.clear();
          patterns.renderVoice(v, t, level, start, end, attrs, patScratch);
          if (!v.modState) v.modState = [];
          modRange.start = start;
          modRange.end = end;
          const age = timeMs - v.bornAtMs;
          const modCtx = modCtxFor(v, timeMs, frame.transport.bpm);
          applyModifierChain(mods, v.modState, patScratch, modRange, model, age > 0 ? age : 0, frame.dt, modCtx);
          const src = patScratch.rgba;
          for (let i = start; i < end; i++) {
            const j = i * 4;
            const r = src[j]!;
            const g = src[j + 1]!;
            const b = src[j + 2]!;
            const a = src[j + 3]!;
            if (r <= 0 && g <= 0 && b <= 0 && a <= 0) continue;
            dst.add(i, r, g, b, a);
          }
          continue;
        }
        patterns.renderVoice(v, t, level, start, end, attrs, dst);
      }
    },
  };
}

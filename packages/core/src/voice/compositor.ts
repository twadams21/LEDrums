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
import type { Framebuffer } from '../engine/framebuffer';
import type { PixelModel } from '../geometry/pixel-model';
import type { TransportState } from '../engine/render-context';
import { sampleEnvelope } from './envelope';
import { buildPixelAttrs, createPatternRenderer, type PixelAttrs } from './pattern-renderer';
import { createGeneratorBridge } from './generator-bridge';
import type { ParamSpec, ParamValues, Voice } from './types';

// `buildPixelAttrs` / `PixelAttrs` live with the pattern renderer (which samples them);
// re-exported here so the `./compositor` import surface — consumed by the engine and the
// voice barrel — is unchanged.
export { buildPixelAttrs, type PixelAttrs };

const num = (v: number | boolean | undefined, d: number): number => (typeof v === 'number' ? v : d);

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
        if (v.scope === 'drum' && v.sourceDrumId != null) {
          const d = model.drumById.get(v.sourceDrumId);
          if (!d) continue;
          start = d.pixelStart;
          end = d.pixelStart + d.pixelCount;
        }

        if (v.generatorId) {
          // Hosted legacy-generator voice — never falls through to the pattern path.
          generators.renderVoice(v, model, timeMs, level, start, end, dst);
          continue;
        }

        // Pattern voice (fast path).
        patterns.renderVoice(v, t, level, start, end, attrs, dst);
      }
    },
  };
}

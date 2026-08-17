/**
 * Per-frame voice envelope advance + reaping (ported from `sim.tick`). Pure functions
 * over the engine's voice pool: given the current `timeMs` and bus lookup, they advance
 * each live voice's attack/sustain/release level and free voices that have decayed out.
 * No allocation, no array churn — they mutate the pre-sized pool in place.
 */
import { lifeEnvelopeGain } from '../effects/voice-life';
import { releaseVoice } from './voice-pool';
import { ease } from './easing';
import type { Bus, Voice } from './types';

/** Advance every active voice's envelope level for this frame (attack → sustain →
    release), releasing one-shots whose sustain window has elapsed.

    THE one place an authored `lifeEnvelope` is applied (S6b): the curve multiplies the
    level the attack/sustain phases produce, so a voice's brightness follows the shape its
    author drew instead of sitting flat at 1. Release is deliberately NOT multiplied — the
    ramp already starts from `releaseFromLevel`, which is exactly where the curve left the
    voice, so multiplying again would square the tail. Voices with no envelope take a single
    `undefined` check and are byte-identical to what they were before. */
export function advanceEnvelopes(pool: readonly Voice[], timeMs: number, busById: Map<string, Bus>): void {
  for (const v of pool) {
    if (!v.active) continue;
    const age = timeMs - v.bornAtMs;
    if (v.phase === 'attack') {
      // An authored attack curve shapes the voice's own ramp too — otherwise picking a curve
      // would do nothing in the wait modes that have no per-unit envelope.
      const t = v.attackMs <= 0 ? 1 : Math.min(1, age / v.attackMs);
      v.level = v.attackEase ? ease(v.attackEase, t) : t;
      if (v.level >= 1) v.phase = 'sustain';
      v.level *= lifeEnvelopeGain(v.lifeEnvelope, age, v.lifeSpanMs ?? 0);
    } else if (v.phase === 'sustain') {
      if (v.mode === 'oneshot') {
        v.level = lifeEnvelopeGain(v.lifeEnvelope, age, v.lifeSpanMs ?? 0);
        if (age >= v.attackMs + v.sustainMs) releaseVoice(v, timeMs);
      } else {
        v.level = (0.82 + 0.18 * (0.5 + 0.5 * Math.sin(age / 480))) * lifeEnvelopeGain(v.lifeEnvelope, age, v.lifeSpanMs ?? 0);
      }
    } else {
      const bus = busById.get(v.busId);
      const ramp = Math.max(60, v.mode === 'oneshot' ? v.releaseMs : bus?.crossfadeMs ?? v.releaseMs);
      const since = timeMs - (v.releaseAtMs ?? timeMs);
      v.level = Math.max(0, v.releaseFromLevel * (1 - since / ramp));
    }
  }
}

/** Reap dead voices back into the pool (no allocation), clearing any latch still
    pointing at a reaped voice so a toggle doesn't reference a freed slot. */
export function reapDeadVoices(pool: readonly Voice[], latched: Map<string, string | null>): void {
  for (const v of pool) {
    if (v.active && v.phase === 'release' && v.level <= 0.001) {
      v.active = false;
      for (const [k, id] of latched) if (id === v.id) latched.set(k, null);
    }
  }
}

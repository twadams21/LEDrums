/**
 * Per-frame voice envelope advance + reaping (ported from `sim.tick`). Pure functions
 * over the engine's voice pool: given the current `timeMs` and bus lookup, they advance
 * each live voice's attack/sustain/release level and free voices that have decayed out.
 * No allocation, no array churn — they mutate the pre-sized pool in place.
 */
import { releaseVoice } from './voice-pool';
import type { Bus, Voice } from './types';

/** Advance every active voice's envelope level for this frame (attack → sustain →
    release), releasing one-shots whose sustain window has elapsed. */
export function advanceEnvelopes(pool: readonly Voice[], timeMs: number, busById: Map<string, Bus>): void {
  for (const v of pool) {
    if (!v.active) continue;
    const age = timeMs - v.bornAtMs;
    if (v.phase === 'attack') {
      v.level = v.attackMs <= 0 ? 1 : Math.min(1, age / v.attackMs);
      if (v.level >= 1) v.phase = 'sustain';
    } else if (v.phase === 'sustain') {
      if (v.mode === 'oneshot') {
        v.level = 1;
        if (age >= v.attackMs + v.sustainMs) releaseVoice(v, timeMs);
      } else {
        v.level = 0.82 + 0.18 * (0.5 + 0.5 * Math.sin(age / 480));
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

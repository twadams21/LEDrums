import type { PixelModel } from '../geometry/pixel-model';
import { maxCascadeDelayMs } from './splice';
import type { Voice } from './types';

/** A cascade must outlive its last unit. Per-unit envelopes own the attack rather than
 * multiplying a second global attack underneath the first unit (which would square it).
 * Apply once at spawn, in either clock-owning adapter. */
export function shapeCascadeVoice(v: Voice | null, model: PixelModel | null): void {
  if (!v?.splice) return;
  if (model) v.sustainMs += maxCascadeDelayMs(model, v.splice);
  if (v.splice.waitMode === 'fade' || v.splice.waitMode === 'pulse') {
    v.sustainMs += v.attackMs;
    v.attackMs = 0;
  }
}

/** Advance once per live origin, AFTER envelope advance/reaping. Dark gaps and overlapping
 * voices do not advance the origin twice. The adapter owns/reset this cross-voice map. */
export function advanceLatchedSpliceMotion(pool: readonly Voice[], clocks: Map<string, number>, dt: number): void {
  const advanced = new Set<string>();
  for (const v of pool) {
    if (!v.active || v.splice?.motionMode !== 'latched') continue;
    const key = `${v.pad ?? ''}#${v.originNodeId ?? ''}`;
    if (!advanced.has(key)) {
      advanced.add(key);
      clocks.set(key, (clocks.get(key) ?? 0) + Math.max(0, dt));
    }
    v.spliceMotionMs = clocks.get(key) ?? 0;
  }
}

/**
 * The live-feedback buffer behind the per-drum velocity sensitivity editor:
 * recent hits per drum, so the `CurveField` can plot where each one landed on
 * the curve being edited.
 *
 * Requested by Trent (2026-08-17): live feedback in the envelope when triggered
 * "so that we can see how much the changes are fixing / helping". A hit stores
 * only its INPUT velocity (`x`) and when it arrived — never a `y` — so the
 * marker is read off the curve currently on screen. That is what makes an
 * unsaved tweak show its effect on hits that already happened.
 *
 * Pure and store-free so the retention rule is testable without a component.
 */
import type { CurveHit } from '../ui/curve-field';

/** Markers kept per drum. Past this the plot is a smear, not a reading. */
export const VELOCITY_HIT_LIMIT = 12;

/** Per-drum hit buffers, keyed by `drumId`. */
export type VelocityHits = Record<string, readonly CurveHit[]>;

/**
 * Append one hit to a drum's buffer, oldest-first, capped at `limit`. Returns a
 * NEW map (and a new array for that drum) so a `$state` field can be reassigned
 * — mutating in place would leave the overlay static.
 *
 * A hit with no drum is dropped: an input the zone-map does not claim is not
 * shaped by any curve, so plotting it under one would be a lie.
 */
export function appendVelocityHit(
  hits: VelocityHits,
  drumId: string | undefined,
  hit: CurveHit,
  limit = VELOCITY_HIT_LIMIT,
): VelocityHits {
  if (!drumId) return hits;
  const keep = Math.max(1, limit);
  const prev = hits[drumId] ?? [];
  return { ...hits, [drumId]: [...prev.slice(-(keep - 1)), hit] };
}

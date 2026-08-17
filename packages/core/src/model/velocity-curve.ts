/* =============================================================================
   VELOCITY SENSITIVITY — the per-DRUM transfer curve applied to a hit.

   Requested by Trent (2026-08-17): "customise the sensitivity of the MIDI
   velocity input of the drum triggers, per trigger not per zone — Kick has 1
   sensitivity curve, not each zone of the kick drum."

   The curve is a transfer curve: x = the input's normalised velocity 0..1,
   y = the velocity the engine sees. Absent = identity, i.e. exactly today's
   behaviour, which is why the field is optional and why an identity curve is
   DELETED rather than stored ({@link withVelocityCurve}).

   THE RULE (one sentence, so every path can be checked against it): an input
   the zone-map CLAIMS for a drum is shaped by that drum's curve; an unclaimed
   input — a direct-bound MIDI note, a modulation-only OSC address — passes
   through untouched. Claimed inputs are shaped at the ONE seam where the raw
   value and the resolved drum first coexist (`VoiceEngineHost.toInputEvent` on
   the server, the local fire builders in the web store when offline), so the
   value tables the engine feeds from downstream see the shaped velocity too:
   the drum's sensitivity is a property of the drum, not of one consumer.

   Deliberately NOT shaped: `fireGraph` (the keyboard's n-th-graph performance
   intent). That path carries a graph key, never an input-map identity — the
   engine's own contract is "no zone-map, no source re-resolution" — and it must
   behave identically online and offline, so it is uncurved on both.

   Purity: lookup + evaluation only. No engine state, no IO.
   ============================================================================= */
import { clampUnit, evalCurve, isIdentityCurve, type CurveValue } from './curve';
import type { InputMap } from './project-schema';

/**
 * Apply a velocity curve to one normalised 0..1 velocity. `undefined` (no curve
 * authored for this drum) is the identity, and so is an identity-shaped curve.
 * Both return the value UNTOUCHED rather than clamped: absent must be exactly
 * today's behaviour, and the clamping the downstream seams already do is not
 * this function's to duplicate. A curved value is clamped into the field on the
 * way in, because a curve is only defined there.
 */
export function applyVelocityCurve(curve: CurveValue | undefined, velocity: number): number {
  if (!curve || isIdentityCurve(curve)) return velocity;
  return evalCurve(curve, clampUnit(velocity));
}

/** The curve authored for a drum, or `undefined` for identity. */
export function velocityCurveFor(
  inputMap: Pick<InputMap, 'velocityCurves'>,
  drumId: string | undefined,
): CurveValue | undefined {
  if (!drumId) return undefined;
  return inputMap.velocityCurves[drumId];
}

/**
 * The call every input path makes: shape `velocity` by whatever curve the drum
 * carries. One function rather than a lookup plus an apply at each site, so a
 * new path cannot half-implement the rule.
 */
export function applyDrumVelocity(
  inputMap: Pick<InputMap, 'velocityCurves'>,
  drumId: string | undefined,
  velocity: number,
): number {
  return applyVelocityCurve(velocityCurveFor(inputMap, drumId), velocity);
}

/**
 * Set (or clear) a drum's curve, returning a new map. An identity curve is
 * REMOVED rather than written: absent and identity mean the same thing at every
 * read, so persisting one would be a document that differs without behaving
 * differently. `null` clears explicitly (the reset affordance).
 */
export function withVelocityCurve(
  inputMap: InputMap,
  drumId: string,
  curve: CurveValue | null,
): InputMap {
  const next = { ...inputMap.velocityCurves };
  if (curve === null || isIdentityCurve(curve)) {
    if (!(drumId in next)) return inputMap;
    delete next[drumId];
  } else {
    next[drumId] = curve;
  }
  return { ...inputMap, velocityCurves: next };
}

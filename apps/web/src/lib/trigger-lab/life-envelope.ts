/**
 * The bridge between an effect's scalar Life/Decay param and the curve that can replace it
 * (S6b). Pure, registry-only — no store, no Svelte — so the inspector binding and its tests
 * agree on what "this effect has a life you can draw" means.
 *
 * An effect qualifies when it declares {@link EffectGenerator.voiceLife}: that declaration is
 * already the statement "this param governs how long my visuals last", and it is what makes
 * the envelope's x axis meaningful (the curve is normalised over exactly that resolved life,
 * so `h1.x = 1` is the Life slider's own value and the seed is today's behaviour).
 */
import { EXP_TAIL_FACTOR, tryGetEffect, type CurveValue } from '@ledrums/core';

/**
 * `strength` that calibrates the `exp` profile against a true `e^-t` decay.
 *
 * The profile's fall is `(1 - u)^k` with `k = 8^s`; an exponential effect is visible for
 * {@link EXP_TAIL_FACTOR} time constants, so matching the two at the half-way point gives
 * `k = EXP_TAIL_FACTOR / (2 ln 2)` and `s = ln k / ln 8`. A power curve is not an exponential,
 * so the two agree exactly only at that point and stay close either side of it — near enough
 * that "turn my decay into an envelope" reads as a handoff rather than an edit, which is what
 * a seed has to earn. Precision past that belongs to the author's next drag.
 */
export const EXP_SEED_STRENGTH =
  Math.log(EXP_TAIL_FACTOR / (2 * Math.LN2)) / Math.log(8);

/** The param key whose life this effect's envelope would replace, or null if it declares none. */
export function lifeParamKey(generatorId: string | null | undefined): string | null {
  if (!generatorId) return null;
  return tryGetEffect(generatorId)?.voiceLife?.key ?? null;
}

/**
 * The envelope to seed when an author turns a scalar life into a curve: full brightness at
 * birth, gone at the effect's declared life, bent the way that effect already fades.
 *
 * An effect whose param is an exponential time CONSTANT (it declares a `factor`) seeds the
 * matching bend; one that fades on a hard `1 - age/life` seeds `strength: 0`, which collapses
 * the `exp` profile to linear EXACTLY. Either way the first frame after seeding looks like
 * the frame before it, and the strength fader is live rather than greyed.
 */
export function seedLifeEnvelope(generatorId: string | null | undefined): CurveValue {
  const life = generatorId ? tryGetEffect(generatorId)?.voiceLife : undefined;
  return {
    h0: { x: 0, y: 1 },
    h1: { x: 1, y: 0 },
    profile: 'exp',
    strength: life?.factor ? EXP_SEED_STRENGTH : 0,
  };
}

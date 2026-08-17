/**
 * The bridge between an effect's scalar Decay param and the curve that REPLACES it (S6b, F5).
 * Pure, registry-only — no store, no Svelte — so the inspector binding and its tests agree on
 * what "this effect has a decay you can draw" means.
 *
 * An effect qualifies when it declares {@link EffectGenerator.voiceLife}: that declaration is
 * already the statement "this param governs how long my visuals last", and it is what makes
 * the envelope's x axis meaningful (the curve is normalised over exactly that resolved decay
 * time, so `h1.x = 1` is the Decay slider's own value and the seed is today's behaviour).
 *
 * F5 removed the toggle: a qualifying effect ALWAYS shows the envelope, with the Decay slider
 * scaling its x axis and Max brightness scaling its output. The seed below is what the author
 * sees before their first drag, so it has to be the shape the effect already fades on.
 */
import { EXP_TAIL_FACTOR, tryGetEffect, type CurveValue } from '@ledrums/core';

/**
 * `strength` that calibrates the `bend` profile against a true `e^-t` decay.
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

/**
 * The strength fader's step. A seed the fader cannot land on is not a rounding nicety: the
 * control corrects an off-step value to the nearest step as it mounts, and that correction
 * arrives as an ordinary onChange — so merely OPENING the inspector would author an envelope
 * and burn an undo slot for a value nobody drew. Quantising here keeps the seed a shape the
 * author can be shown without it becoming a shape they made.
 */
const STRENGTH_STEP = 0.01;

const toStep = (n: number): number => Math.round(n / STRENGTH_STEP) * STRENGTH_STEP;

/** The param key whose decay this effect's envelope replaces, or null if it declares none. */
export function lifeParamKey(generatorId: string | null | undefined): string | null {
  if (!generatorId) return null;
  return tryGetEffect(generatorId)?.voiceLife?.key ?? null;
}

/**
 * The param the Max-brightness slider writes — the effect's own output scale.
 *
 * The envelope's y axis always reads 100% at the top and the real output is `shape × max`
 * (Trent, 2026-08-17). That multiply already exists inside every generator that declares a
 * decay: each one multiplies its colour by `bri` before it hits the framebuffer. So the max
 * IS that param — no second scale in the model, no second multiply in the engine, and the
 * colour swatch and this slider stay two editors of one value rather than two values.
 *
 * Ordered by how the library names its output scale; every decay-declaring effect today
 * carries `brightness`, and the fallbacks exist so a new one that names it `level` still gets
 * a working y axis instead of silently losing the control.
 */
const MAX_BRIGHTNESS_KEYS = ['brightness', 'level', 'gain', 'intensity'] as const;

export function maxBrightnessKey(generatorId: string | null | undefined): string | null {
  if (!generatorId) return null;
  const specs = tryGetEffect(generatorId)?.paramSpec;
  if (!specs) return null;
  for (const key of MAX_BRIGHTNESS_KEYS) {
    const spec = specs.find((s) => s.key === key);
    if (spec && spec.type === 'number') return key;
  }
  return null;
}

/**
 * Why the envelope's span and the Decay slider can read as two different numbers.
 *
 * They are two different numbers, on purpose. An effect whose param is an exponential time
 * CONSTANT (it declares `voiceLife.factor`) is still visible for {@link EXP_TAIL_FACTOR} of
 * them — `decayMs: 220` renders for ~1.2s, not 220ms — so the envelope's x axis is sized to
 * what the eye actually sees rather than to the constant. Effects with a hard cutoff resolve
 * 1:1, but may still differ in UNIT (`3.00 beats` at 120bpm is a 1.50s axis).
 *
 * Either way the pair looked like a scale bug on sight (caught in review of F5's own
 * screenshot), which is the whole reason the readout says what it is and carries this.
 */
export function decaySpanHint(generatorId: string | null | undefined, spec: { label: string } | null): string {
  const life = generatorId ? tryGetEffect(generatorId)?.voiceLife : undefined;
  const label = spec?.label ?? 'Decay';
  return life?.factor
    ? `Total width of the envelope's time axis. ${label} is an exponential time constant — the decay stays visible for about ${EXP_TAIL_FACTOR.toFixed(1)}× it, and the envelope spans all of that.`
    : `Total width of the envelope's time axis — the ${label} slider's own value, resolved to real time.`;
}

/**
 * The envelope an effect starts on: full brightness at birth, gone at its declared decay time,
 * bent the way that effect already fades.
 *
 * An effect whose param is an exponential time CONSTANT (it declares a `factor`) seeds the
 * matching bend; one that fades on a hard `1 - age/decay` seeds `strength: 0`, which is the
 * `bend` profile's centre notch and therefore EXACTLY linear. Either way the first frame the
 * author sees is the frame the effect has always drawn — the envelope takes over the fade
 * without changing it, and the strength fader is live rather than greyed.
 */
export function seedLifeEnvelope(generatorId: string | null | undefined): CurveValue {
  const life = generatorId ? tryGetEffect(generatorId)?.voiceLife : undefined;
  return {
    h0: { x: 0, y: 1 },
    h1: { x: 1, y: 0 },
    profile: 'bend',
    strength: life?.factor ? toStep(EXP_SEED_STRENGTH) : 0,
  };
}

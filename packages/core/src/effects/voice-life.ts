/**
 * Reconciles a voice's envelope with the effect's OWN life param.
 *
 * Every voice used to take its attack/sustain/release from a fixed per-category envelope
 * baked onto the `EffectDef` at registry build. A `'trigger'` effect therefore died ~410ms
 * after the hit whatever its Life slider said, so effects that fade over their own life
 * (`fade = 1 - age/life`) were cut off long before that fade finished and the slider looked
 * inert. This resolves the two at spawn: an effect that {@link EffectGenerator.voiceLife}
 * declares gets a sustain derived from the instance's params; everything else is untouched.
 *
 * Pure, registry-resolved by generator id — nothing about this crosses the wire.
 */
import { evalCurve, normalizeCurve, type CurveValue } from '../model/curve';
import { tryGetEffect } from './registry';
import { pnum, type ResolvedParams } from './types';

const MS_PER_MINUTE = 60000;
const FALLBACK_BPM = 120;

/**
 * The sustain (ms) a spawning voice should use.
 *
 * Returns `categorySustainMs` unchanged for effects with no declaration — the pre-existing
 * behaviour, byte-identical. For a declaring effect it returns the longer of the category
 * sustain and the declared life, so the voice always outlives the effect's internal fade and
 * a life SHORTER than the category default can never shorten a voice below what it is today.
 *
 * `params` is the instance's own param map; a life the user never touched is absent from it,
 * so the generator's spec default stands in. Beats convert at `bpm` — the same conversion the
 * effect performs internally, so the two agree. A declared `factor` scales the result: an
 * exponential decay's param is a time CONSTANT, and the eye keeps seeing it for
 * {@link EXP_TAIL_FACTOR} of those.
 */
export function resolveVoiceSustainMs(
  generatorId: string | null | undefined,
  params: ResolvedParams,
  bpm: number,
  categorySustainMs: number,
): number {
  if (!generatorId) return categorySustainMs;
  const generator = tryGetEffect(generatorId);
  const life = generator?.voiceLife;
  if (!life) return categorySustainMs;
  const spec = generator.paramSpec.find((s) => s.key === life.key);
  const declared = Math.max(0, pnum(params, life.key, typeof spec?.default === 'number' ? spec.default : 0));
  const ms = life.unit === 'beats' ? declared * (MS_PER_MINUTE / (bpm > 0 ? bpm : FALLBACK_BPM)) : declared;
  const lifeMs = ms * Math.max(0, life.factor ?? 1);
  return Math.max(categorySustainMs, lifeMs);
}

/**
 * What a spawning voice needs in order to live out its authored life.
 *
 * `spanMs` is the real-time width of the envelope's x axis — the SAME number
 * {@link resolveVoiceSustainMs} returns, so an envelope whose end handle sits at `x = 1` is
 * byte-for-byte today's behaviour and the `beats` unit resolves in exactly one place.
 * `sustainMs` is the dwell the pool arms; `envelope` is the normalised curve (null when the
 * node authored none, which is the untouched path).
 */
export interface ResolvedVoiceLife {
  sustainMs: number;
  spanMs: number;
  envelope: CurveValue | null;
}

/**
 * Resolve a spawning voice's dwell and its amplitude-over-life curve together.
 *
 * With no `lifeEnvelope` this is {@link resolveVoiceSustainMs} verbatim — the #182 path,
 * unchanged. With one, the curve REPLACES the param lookup as the thing that says when the
 * voice is done: the envelope's end handle is its end time, so `sustainMs = spanMs × h1.x`.
 * The author dragging `h1` left shortens the voice; dragging it to the right edge restores
 * the effect's own declared life.
 *
 * `h1.y > 0` is a voice that has NOT finished falling when its dwell ends — the existing
 * release path takes over from that level (`releaseFromLevel` is whatever the curve left on
 * the voice), so a held tail fades on the bus's ramp instead of cutting.
 *
 * Called from both the core pool and the web sim, so the two agree by construction.
 */
export function resolveVoiceLife(
  generatorId: string | null | undefined,
  params: ResolvedParams,
  bpm: number,
  categorySustainMs: number,
  lifeEnvelope: CurveValue | null | undefined,
): ResolvedVoiceLife {
  const spanMs = resolveVoiceSustainMs(generatorId, params, bpm, categorySustainMs);
  if (!lifeEnvelope) return { sustainMs: spanMs, spanMs, envelope: null };
  const envelope = normalizeCurve(lifeEnvelope);
  return { sustainMs: spanMs * envelope.h1.x, spanMs, envelope };
}

/**
 * `A(t)` — the authored amplitude at a voice age, as a plain multiplier on the voice's level.
 *
 * Total and allocation-free: no envelope, a non-positive span, or an age past the curve all
 * resolve without branching the caller. Past `spanMs` the curve is flat at `h1.y`, which is
 * what lets the release phase fade from wherever the curve left the voice rather than
 * re-applying the envelope on top of the release ramp.
 *
 * The age is measured from the voice's birth (`bornAtMs`), so an effect with a non-zero
 * attack reaches the curve's end `attackMs` after its dwell begins — the curve is flat there
 * by then, so the only visible consequence is that the plateau is that much longer.
 */
export function lifeEnvelopeGain(
  envelope: CurveValue | null | undefined,
  voiceAgeMs: number,
  spanMs: number,
): number {
  if (!envelope) return 1;
  if (!(spanMs > 0)) return evalCurve(envelope, 1);
  return evalCurve(envelope, voiceAgeMs / spanMs);
}

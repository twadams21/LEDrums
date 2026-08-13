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

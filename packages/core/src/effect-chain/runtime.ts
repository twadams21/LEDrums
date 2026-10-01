/**
 * Engine-internal runtime definitions that let an Effect-path {@link PlayAction} spawn through
 * the unchanged voice pool WITHOUT the show carrying buses, EffectDefs or presets.
 *
 * `VoicePool.spawn` needs an {@link EffectDef} (for the hosted generator id and its param
 * specs) and a {@link Bus} (for polyphony). The Effect model has neither: a voice's polyphony
 * comes from its Effect's retrigger setting, and its envelope from the amp envelope. So the
 * engine synthesises both, in reserved `@`-prefixed id spaces no authored show can collide
 * with (the same convention as the splice fill def):
 *
 * - one internal POLY bus — retrigger policy is applied by the engine before spawning, so the
 *   bus must never steal on its own;
 * - one EffectDef per hosted generator id, built from the generator's own param spec. Its
 *   attack/sustain/release are placeholders: an Effect-path action always carries its own.
 */
import { tryGetEffect } from '../effects/registry';
import { mapVoiceParamSpec } from '../effects/voice-param-spec';
import type { Bus, EffectDef } from '../voice/types';

/** The internal bus every Effect-path voice plays on. */
export const CHAIN_BUS_ID = '@effect-chain';

export const CHAIN_BUS: Bus = { id: CHAIN_BUS_ID, name: 'Effects', polyphony: 'poly', crossfadeMs: 0 };

const CHAIN_DEF_PREFIX = '@chain:';

/** The internal EffectDef id an Effect-path action names for a hosted generator id. */
export function chainEffectDefId(generatorId: string): string {
  return `${CHAIN_DEF_PREFIX}${generatorId}`;
}

/**
 * Build the internal EffectDef for `generatorId` (a registry id or a `canvas:<sceneId>` id),
 * or `null` when no such generator is registered.
 */
export function chainEffectDef(generatorId: string): EffectDef | null {
  const gen = tryGetEffect(generatorId);
  if (!gen) return null;
  return {
    id: chainEffectDefId(generatorId),
    name: gen.name,
    generatorId,
    busId: CHAIN_BUS_ID,
    scope: 'kit',
    params: gen.paramSpec.map(mapVoiceParamSpec),
    attackMs: 0,
    sustainMs: 0,
    releaseMs: 0,
  };
}

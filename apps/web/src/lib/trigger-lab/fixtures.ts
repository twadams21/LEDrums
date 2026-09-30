/* Seed data the Effect-chain app still reads: the kit's pad roster (drum × zone) for the
   performance surface, the drum roster, and every core generator as a selectable EffectDef (the
   thumbnail / gallery fixtures). */

import {
  DEFAULT_KIT,
  collectionOf,
  listEffects,
  type EffectCategory,
  mapVoiceParamSpec as mapParamSpec,
} from '@ledrums/core';
import { type EffectDef } from './sim';

/** One playable drum zone. */
export interface Pad {
  drumId: string;
  drumLabel: string;
  zone: number;
  zoneLabel: string;
}

export const ZONE_LABELS = ['center', 'edge', 'rim', 'shell'];

// ---- generator-backed effects ------------------------------------------------
// Each legacy `EffectGenerator` in core's registry is surfaced as a selectable
// EffectDef carrying `generatorId`; the compositor (server) and render.ts (offline)
// delegate rendering to it. Param specs are mapped from the generator's own spec;
// category drives the bus + envelope timing. See docs/prompts/port-all-effects.md.

/** Legacy category → voice bus. Backdrops on base, washes/utility/meter on effect,
    one-shot/particle hits on trigger. */
const CATEGORY_BUS: Record<EffectCategory, string> = {
  base: 'base',
  texture: 'base',
  wash: 'effect',
  meter: 'effect',
  utility: 'effect',
  particle: 'trigger',
  trigger: 'trigger',
};

/** Legacy category → default voice envelope (attack/sustain/release ms). Continuous
    fields get a slow attack/release; trigger/particle effects a fast one-shot shape. */
const CATEGORY_ENV: Record<EffectCategory, { attackMs: number; sustainMs: number; releaseMs: number }> = {
  base: { attackMs: 800, sustainMs: 0, releaseMs: 900 },
  texture: { attackMs: 800, sustainMs: 0, releaseMs: 900 },
  wash: { attackMs: 400, sustainMs: 0, releaseMs: 700 },
  meter: { attackMs: 80, sustainMs: 0, releaseMs: 250 },
  utility: { attackMs: 200, sustainMs: 0, releaseMs: 400 },
  particle: { attackMs: 10, sustainMs: 120, releaseMs: 500 },
  trigger: { attackMs: 10, sustainMs: 100, releaseMs: 300 },
};

/** All core generators as selectable, generator-backed EffectDefs. Scope is `kit`
    for every one: generators own their spatial layout (drum-locality is intrinsic — e.g.
    whole-drum lights only the struck drum from its trigger), so drum-masking a kit-wide
    field (plasma, radial-wash) would wrongly clip it. */
export const GENERATOR_EFFECTS: EffectDef[] = listEffects().map((gen): EffectDef => {
  const env = CATEGORY_ENV[gen.category];
  return {
    id: `gen:${gen.id}`,
    name: gen.name,
    generatorId: gen.id,
    category: gen.category,
    description: gen.description,
    tags: gen.tags,
    playType: collectionOf(gen.tags),
    deprecated: gen.deprecated,
    busId: CATEGORY_BUS[gen.category],
    scope: 'kit',
    params: gen.paramSpec.map(mapParamSpec),
    attackMs: env.attackMs,
    sustainMs: env.sustainMs,
    releaseMs: env.releaseMs,
  };
});

function pad(drumId: string, drumLabel: string, zone: number): Pad {
  return { drumId, drumLabel, zone, zoneLabel: ZONE_LABELS[zone]! };
}

export const PADS: Pad[] = [
  pad('kick', 'Kick', 0),
  pad('kick', 'Kick', 3),
  pad('snare', 'Snare', 0),
  pad('snare', 'Snare', 2),
  pad('snare', 'Snare', 3),
  pad('tom1', 'Tom 1', 0),
  pad('tom1', 'Tom 1', 1),
  pad('tom1', 'Tom 1', 2),
  pad('tom2', 'Tom 2', 0),
  pad('tom2', 'Tom 2', 2),
];

/** The drum roster, sourced from the canonical kit so ids/labels can't drift from the engine. */
export const DRUMS = DEFAULT_KIT.drums.map((d) => ({ id: d.id, label: d.label }));

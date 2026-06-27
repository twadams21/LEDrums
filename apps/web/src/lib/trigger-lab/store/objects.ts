/* Effect / preset object cores — the pure builders + queries behind the Objects view's CRUD
   (no runes/DOM). The store wraps each with the sim-registry sync (`registerEffect` /
   `registerPreset` / `unregisterPreset`) it can't move here. Effects are foundational
   (rename + duplicate only, never delete); presets add delete, gated to usage 0 and never a
   live effect's `:default`. Extracted from store.svelte.ts unchanged in behaviour. */

import {
  type EffectDef,
  type ParamSpec,
  type Pattern,
  type Preset,
  type Scope,
  type TriggerGraph,
  defaultParams,
} from '../sim';

/** The createEffect input the Objects/Creator view passes in. */
export interface NewEffectInput {
  name: string;
  pattern: Pattern;
  scope: Scope;
  busId: string;
  attackMs: number;
  sustainMs: number;
  releaseMs: number;
  params: ParamSpec[];
}

/** Mint a fresh, unused effect id from a name (slug + `-N` de-dup). Shared by create +
    duplicate. Effect ids are name-derived (not the global counter) so they read nicely. */
export function freshEffectId(effects: readonly EffectDef[], name: string): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'effect';
  let id = base;
  let n = 2;
  while (effects.some((e) => e.id === id)) id = `${base}-${n++}`;
  return id;
}

/** Assemble an authored EffectDef from the Creator input under an already-minted id. */
export function buildEffect(input: NewEffectInput, id: string): EffectDef {
  return {
    id,
    name: input.name.trim() || 'Untitled',
    pattern: input.pattern,
    busId: input.busId,
    scope: input.scope,
    attackMs: input.attackMs,
    sustainMs: input.sustainMs,
    releaseMs: input.releaseMs,
    params: input.params,
  };
}

/** An effect's foundational `:default` preset (seeded at create + duplicate time). */
export function defaultPresetFor(eff: EffectDef): Preset {
  return { id: `${eff.id}:default`, name: 'Default', effectId: eff.id, params: defaultParams(eff) };
}

/** Clone an effect definition (already snapshot/detached) under a fresh id + name — keeps every
    field (incl. a generator-backed effect's `generatorId`) so the copy renders identically. */
export function cloneEffect(srcSnapshot: EffectDef, newId: string, name: string): EffectDef {
  return { ...srcSnapshot, id: newId, name };
}

/** Clone a preset under a fresh id named "<name> copy" — same effect, an INDEPENDENT copy of
    its params (a fresh object, not the source's). */
export function clonePreset(src: Preset, newId: string): Preset {
  return { id: newId, name: `${src.name} copy`, effectId: src.effectId, params: { ...src.params } };
}

/** How many play nodes — across EVERY graph (pad + authored) — reference this preset, whether
    linked (reads the shared preset live) or instance-origin (forked its own params from it,
    keeping `presetId` as the origin). Pure read: gates {@link canDeletePreset}. */
export function presetUsageCount(graphs: Record<string, TriggerGraph>, id: string): number {
  let count = 0;
  for (const graph of Object.values(graphs)) {
    for (const node of graph.nodes) {
      if (node.kind === 'play' && node.presetId === id) count++;
    }
  }
  return count;
}

/** Whether a preset may be deleted: it exists, is used nowhere (`usage === 0`), and is not a
    LIVE effect's foundational `:default` (an effect's seeded baseline is never deletable while
    the effect exists). Mirrors the old inline guards in `deletePreset`. */
export function canDeletePreset(
  preset: Preset | undefined,
  usage: number,
  effects: readonly EffectDef[],
): preset is Preset {
  if (!preset) return false;
  if (usage > 0) return false;
  if (preset.id.endsWith(':default') && effects.some((e) => e.id === preset.effectId)) return false;
  return true;
}

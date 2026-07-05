/* Effect / preset object cores — the pure builders + queries behind the Objects view's CRUD
   (no runes/DOM). The store wraps each with the sim-registry sync (`registerEffect` /
   `registerPreset` / `unregisterPreset`) it can't move here. Effects are foundational
   (rename + duplicate only, never delete); presets add delete, gated to usage 0 and never a
   live effect's `:default`. Extracted from store.svelte.ts unchanged in behaviour. */

import {
  type EffectDef,
  type Preset,
  type TriggerGraph,
  defaultParams,
} from '../sim';

/** Mint a fresh, unused effect id from a name (slug + `-N` de-dup). Shared by duplicate.
    Effect ids are name-derived (not the global counter) so they read nicely. */
export function freshEffectId(effects: readonly EffectDef[], name: string): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'effect';
  let id = base;
  let n = 2;
  while (effects.some((e) => e.id === id)) id = `${base}-${n++}`;
  return id;
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

/** How many play nodes — across EVERY graph (pad + authored) — carry this preset as their
    `presetId` provenance (forked their own params from it; presets are snapshots now — S39). Pure
    read: gates {@link canDeletePreset}. */
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

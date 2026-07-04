/* Generic-graph CRUD cores — build / clone / name / delete-everywhere / label, as PURE
   functions over the graphs map + names + songs (no runes/DOM). No authored/pad distinction:
   pad graphs (keyed `drumId:zone`) and created graphs (keyed `graph-<n>`) are first-class and
   uniform here. The store wraps these with rune assignment + selection bookkeeping. Extracted
   from store.svelte.ts unchanged in behaviour. */

import { type EffectDef, type GraphNode, type ParamValues, type Preset, type TriggerGraph, defaultParams, makeNode } from '../sim';
import { listModifiers } from '@ledrums/core';
import { type Pad } from '../fixtures';
import * as setlist from '../../app/setlist';
import type { Song } from '../../app/setlist';
import { padKey, padLabel } from './seed';

/** A brand-new, empty authored graph — just the implicit trigger input. */
export function buildEmptyGraph(): TriggerGraph {
  return { nodes: [makeNode('trigger', 'trigger')], edges: [] };
}

/** Deep, detached clone of a graph (caller passes a `$state.snapshot`/plain graph). */
export function cloneGraph(snapshot: TriggerGraph): TriggerGraph {
  return structuredClone(snapshot);
}

/** Smallest unused "New graph N" label, so auto-named graphs stay distinct. */
export function nextGraphName(graphNames: Record<string, string>): string {
  const used = new Set(Object.values(graphNames));
  let n = 1;
  while (used.has(`New graph ${n}`)) n++;
  return `New graph ${n}`;
}

/** The default effect id for a fresh play node — the first `drum`-scoped effect, else the
    first effect. */
export function firstEffectId(effects: readonly EffectDef[]): string {
  return effects.find((e) => e.scope === 'drum')?.id ?? effects[0]!.id;
}

/** The seed fields for a fresh play node (effect + a forked copy of its Default preset's
    params). The store passes its preset lookup so the param baseline resolves identically. */
export function playNodeInit(
  effects: readonly EffectDef[],
  presetById: (id: string) => Preset | undefined,
): Pick<GraphNode, 'scope' | 'effectId' | 'presetId' | 'params'> {
  const effId = firstEffectId(effects);
  const eff = effects.find((e) => e.id === effId)!;
  const presetId = `${effId}:default`;
  return { scope: eff.scope, effectId: effId, presetId, params: { ...(presetById(presetId)?.params ?? defaultParams(eff)) } };
}

/** Default param values for a modifier id (its registry `paramSpec` defaults). Unknown id →
    `{}` (the chain runner tolerates missing params via each modifier's own fallbacks). */
export function modifierParamsFor(modifierId: string): ParamValues {
  const def = listModifiers().find((m) => m.id === modifierId);
  const params: ParamValues = {};
  if (def) for (const s of def.paramSpec) params[s.key] = s.default;
  return params;
}

/** The seed fields for a fresh modifier node — the first registered modifier and its
    default params (mirrors {@link playNodeInit}). Empty when the registry is empty. */
export function modifierNodeInit(): Pick<GraphNode, 'modifierId' | 'params'> {
  const first = listModifiers()[0];
  if (!first) return { modifierId: '', params: {} };
  return { modifierId: first.id, params: modifierParamsFor(first.id) };
}

/** Human label for a graph key: the stored display name (`graphNames`, populated for every
    graph incl. pad keys at hydrate), else a kit-derived pad label, else the raw key. */
export function graphLabelOf(graphNames: Record<string, string>, key: string, pads: readonly Pad[]): string {
  return graphNames[key] ?? padLabelForKey(pads, key) ?? key;
}

/** Kit-derived "Drum · zone" label for a pad key, or null when `key` is not a pad. */
function padLabelForKey(pads: readonly Pad[], key: string): string | null {
  const p = pads.find((pad) => padKey(pad) === key);
  return p ? padLabel(p) : null;
}

/** Delete a graph everywhere: drop it from `graphs` + `graphNames`, and purge its key from
    EVERY section across ALL songs (no dangling references). Returns the new triplet; the store
    assigns them and handles selection clearing. Reuses the pure setlist op per section. */
export function removeGraphEverywhere(
  graphs: Record<string, TriggerGraph>,
  graphNames: Record<string, string>,
  songs: readonly Song[],
  key: string,
): { graphs: Record<string, TriggerGraph>; graphNames: Record<string, string>; songs: Song[] } {
  const nextGraphs = { ...graphs };
  delete nextGraphs[key];
  const nextNames = { ...graphNames };
  delete nextNames[key];
  const nextSongs = songs.map((song) =>
    song.sections.reduce((acc, sec) => setlist.removeGraph(acc, sec.id, key), song),
  );
  return { graphs: nextGraphs, graphNames: nextNames, songs: nextSongs };
}

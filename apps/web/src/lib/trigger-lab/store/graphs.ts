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

/** The canonical Gen3 terminal anchor id. Kept literal here (not imported from hydrate)
    so the graph CRUD slice stays small and dependency-free. */
export const OUTPUT_ANCHOR_ID = 'output';

/** A brand-new authored graph is Gen3 from birth: one explicit trigger source anchor and one
    visible Output terminal. Without this, createGraph() briefly produced an unversioned Gen2
    graph where leaf effects fired without reaching Output until the next hydrate pass. */
export function buildEmptyGraph(): TriggerGraph {
  return {
    version: 3,
    nodes: [
      makeNode('trigger', 'trigger', 0, 0),
      makeNode('output', OUTPUT_ANCHOR_ID, 420, 0, { scope: 'kit', targetId: undefined }),
    ],
    edges: [],
  };
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

/** Deep-copy every graph a song references under FRESH keys, returning the remapped song plus the
    graph/name entries to merge into the authored runes. This is what makes a DUPLICATED SONG an
    independent variant: `setlist.cloneSection` copies a section's ordered key LIST but the keys
    themselves still address the one shared graph, so without this pass every edit inside the copy
    (rewire a node, swap an effect, rename the graph) wrote straight through into the source song.
    Cross-section reuse WITHIN a song is unaffected — a key referenced by two sections of the source
    maps to the same new key, so the copy reuses its own graph exactly where the original did.

    Effects / presets are deliberately NOT copied: they are show-level library objects the user picks
    from (the Objects view lists them per show, not per song), and the clipboard song paste treats
    them the same way. A dangling reference (a key with no graph) is carried through untouched —
    faithful to the source song rather than silently repaired.

    Pure: `mintKey` is injected so the caller owns id minting and tests stay deterministic. Pass
    plain (snapshotted) graphs — {@link cloneGraph} structured-clones them. */
export function cloneSongGraphs(
  song: Song,
  graphs: Record<string, TriggerGraph>,
  graphNames: Record<string, string>,
  mintKey: () => string,
): { song: Song; graphs: Record<string, TriggerGraph>; graphNames: Record<string, string> } {
  const remap = new Map<string, string>();
  const nextGraphs: Record<string, TriggerGraph> = {};
  const nextNames: Record<string, string> = {};
  for (const key of setlist.referencedGraphs(song)) {
    const src = graphs[key];
    if (!src) continue; // dangling ref: leave the key as-is (the copy is as broken as the source)
    const newKey = mintKey();
    remap.set(key, newKey);
    nextGraphs[newKey] = cloneGraph(src);
    // Keep the label verbatim — the SONG name is what distinguishes the copy; suffixing 18 graphs
    // with " copy" would just make every duplicated setlist unreadable.
    const name = graphNames[key];
    if (typeof name === 'string') nextNames[newKey] = name;
  }
  const sections = song.sections.map((sec) => ({ ...sec, graphs: sec.graphs.map((k) => remap.get(k) ?? k) }));
  return { song: { ...song, sections }, graphs: nextGraphs, graphNames: nextNames };
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

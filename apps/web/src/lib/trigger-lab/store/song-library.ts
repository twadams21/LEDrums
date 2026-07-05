/* Song Library — pure dependency-closure extraction (S40, doc 07 §B). A PURE module (no runes,
   no DOM), like setlist / show-builder, so the extraction contract is unit-testable in node.

   A song is playable only WITH its dependency closure: sections → graph keys → each play node's
   `effectId` + `presetId` + params, plus each section look's effect (and that effect's
   `:default` preset, which the engine consults to seed a look — engine.ts applyLook). This module
   lifts a show's song OUT into a self-contained {@link LibrarySong} carrying exactly that closure
   and nothing more, with every internal reference re-keyed under a per-song namespace so multiple
   library songs union into one show COLLISION-FREE (doc 07 §B.1/§B.2).

   S40 owns extraction + persistence + the server blob seam ONLY. Resolving a LibrarySong back
   into a show's runtime view (the reverse direction), detach, and library CRUD are S41. */

import type { CanvasScene } from '@ledrums/core';
import type { EffectDef, Preset, TriggerGraph } from '../sim';
import type { Song, SetlistSection } from '../../app/setlist';
import { referencedGraphs } from '../../app/setlist';

/** The authored sources a closure is extracted from — the reachable subset of AuthoredState the
    store already holds. Buses are intentionally absent: a section look's `busId` keys stay
    show-level (resolved against the importing show's buses at resolve time — S41), so a library
    song carries no buses of its own (doc 07 §B lists graphs/effects/presets, not buses). */
export interface ClosureSources {
  graphs: Record<string, TriggerGraph>;
  graphNames: Record<string, string>;
  effects: readonly EffectDef[];
  presets: readonly Preset[];
  /** User-authored canvas scenes (U5). Not part of the namespaced closure — carried alongside
      by the ClipDoc builders so a copied graph/section/song's canvas nodes stay resolvable. */
  canvasScenes?: readonly CanvasScene[];
}

/** A song lifted out of a show into a self-contained, namespaced dependency closure. Every
    internal reference (section→graph key, play node→effect/preset, look→effect, preset→effect)
    is re-keyed under {@link songNamespace}, so the closure is internally consistent AND disjoint
    from every other library song's. */
export interface LibrarySong {
  id: string;
  name: string;
  /** Re-keyed sections: own ids + graph refs + look effect values namespaced; graph refs that
      don't resolve to an included graph are dropped (so every entry resolves). */
  sections: SetlistSection[];
  /** Reached graphs only, keyed by their namespaced key. */
  graphs: Record<string, TriggerGraph>;
  /** Namespaced-key → human label, for each included graph that had one. */
  graphNames: Record<string, string>;
  /** Reached effect defs only, ids namespaced. */
  effects: EffectDef[];
  /** Reached preset defs only, ids + `effectId` namespaced. */
  presets: Preset[];
}

/** The namespace prefix for a library song's re-keyed identifiers. A PREFIX (not a suffix) so
    suffix-based conventions survive — notably `<effectId>:default`, which stays `…:default` and
    keeps its `canDeletePreset` / look-resolution semantics after re-keying. */
export function songNamespace(librarySongId: string): string {
  return `lib:${librarySongId}/`;
}

/** Prefix a non-empty key/id; leave '' untouched — non-play nodes carry empty `effectId`/
    `presetId`, and a null look passes through unprefixed at the call site. */
function nsKey(prefix: string, key: string): string {
  return key ? `${prefix}${key}` : key;
}

/**
 * Extract a song's dependency closure into a self-contained, namespaced {@link LibrarySong}.
 * Pure + deterministic; `librarySongId` is the closure's identity AND its namespace root, injected
 * so the caller controls id minting (and tests stay deterministic).
 *
 * "Reaches" is defined precisely:
 *  - graphs  = the song's referenced graph keys that exist in `sources.graphs`;
 *  - effects = every play node's `effectId` across those graphs, PLUS every section look's effect;
 *  - presets = every play node's `presetId` (provenance snapshot, S39), PLUS the `:default`
 *              preset of each look effect (the engine seeds a look from `<effectId>:default`).
 * Only defs actually present in `sources` are carried (a dangling ref renders nothing here just
 * as it did in the source show — faithful, not repaired). Modifier / lfo / cc / envelope nodes
 * pull NO effects: `modifierId` is a global registry id (never namespaced), and modulation-source
 * nodes carry empty `effectId`.
 */
export function extractSongClosure(song: Song, sources: ClosureSources, librarySongId: string): LibrarySong {
  const prefix = songNamespace(librarySongId);

  // (1) Reachable graph keys present in sources — section→graph references, de-duplicated.
  const graphKeys = referencedGraphs(song).filter((k) => sources.graphs[k] !== undefined);
  const graphKeySet = new Set(graphKeys);

  // (2) Reached effect + preset ids: walk the reachable graphs' PLAY nodes, then the looks.
  const effectIds = new Set<string>();
  const presetIds = new Set<string>();
  for (const key of graphKeys) {
    for (const node of sources.graphs[key]!.nodes) {
      if (node.kind !== 'play') continue; // modifier/lfo/cc/env nodes reach no effect or preset
      if (node.effectId) effectIds.add(node.effectId);
      if (node.presetId) presetIds.add(node.presetId);
    }
  }
  for (const sec of song.sections) {
    for (const effectId of Object.values(sec.looks)) {
      if (!effectId) continue;
      effectIds.add(effectId);
      presetIds.add(`${effectId}:default`); // the look's seed params (engine.ts applyLook)
    }
  }

  // (3) Re-keyed graphs + names.
  const graphs: Record<string, TriggerGraph> = {};
  const graphNames: Record<string, string> = {};
  for (const key of graphKeys) {
    graphs[nsKey(prefix, key)] = rekeyGraph(sources.graphs[key]!, prefix);
    const name = sources.graphNames[key];
    if (typeof name === 'string') graphNames[nsKey(prefix, key)] = name;
  }

  // (4) Reached defs only, re-keyed (order-preserving). Deep-cloned (see rekeyGraph) so the
  //     closure aliases NOTHING in the source show — `effect.params` (a ParamSpec[]) /
  //     `preset.params` are fresh. `preset.effectId` is remapped through the same prefix so a
  //     `:default` preset still points at its (re-keyed) effect.
  const effects = sources.effects
    .filter((e) => effectIds.has(e.id))
    .map((e) => ({ ...structuredClone(e), id: nsKey(prefix, e.id) }));
  const presets = sources.presets
    .filter((p) => presetIds.has(p.id))
    .map((p) => ({ ...structuredClone(p), id: nsKey(prefix, p.id), effectId: nsKey(prefix, p.effectId) }));

  // (5) Re-keyed sections — ids + graph refs + look values namespaced; unresolved graph refs
  //     dropped so every `section.graphs` entry maps to an included graph.
  const sections = song.sections.map((sec) => rekeySection(sec, prefix, graphKeySet));

  return { id: librarySongId, name: song.name, sections, graphs, graphNames, effects, presets };
}

/** Deep-copy a graph, namespacing each node's `effectId`/`presetId` (empty ids untouched, so
    modifier/lfo/cc/envelope nodes are carried verbatim). `modifierId` + `generatorId` are global
    registry ids and are NOT namespaced. `structuredClone` FIRST so the closure aliases nothing in
    the source show — a node's `params`/`env`/`bands`/`modInputs` are fresh objects, and a later
    source-show edit can never write through into a held LibrarySong (S41 keeps them in memory).
    Extraction is not on the render loop, so the clone cost is irrelevant. */
function rekeyGraph(graph: TriggerGraph, prefix: string): TriggerGraph {
  const clone = structuredClone(graph);
  for (const n of clone.nodes) {
    n.effectId = nsKey(prefix, n.effectId);
    n.presetId = nsKey(prefix, n.presetId);
  }
  return clone;
}

/** Re-key a section: own id + graph refs + look effect values under the prefix. Graph refs not in
    `graphKeySet` (dangling / absent in sources) are dropped; a `null` look passes through. */
function rekeySection(sec: SetlistSection, prefix: string, graphKeySet: Set<string>): SetlistSection {
  const graphs = sec.graphs.filter((k) => graphKeySet.has(k)).map((k) => nsKey(prefix, k));
  const looks: Record<string, string | null> = {};
  for (const [busId, effectId] of Object.entries(sec.looks)) {
    looks[busId] = effectId ? nsKey(prefix, effectId) : effectId;
  }
  return { id: nsKey(prefix, sec.id), name: sec.name, graphs, looks };
}

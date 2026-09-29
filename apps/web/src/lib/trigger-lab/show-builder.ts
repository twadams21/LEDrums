/* Adapter: the lab's editable config (the rune-backed `store`) → a `voice.Show`,
   the authored-content aggregate the real server engine runs. The lab's `sim.ts`
   types were the SOURCE the core `voice` types were ported from, so the shapes are
   structurally identical (Bus / Preset / Section / EffectDef / GraphNode / Envelope
   / TriggerGraph all line up field-for-field). That lets us assemble the Show by
   structural assignment with no `as any` — TypeScript's structural typing accepts
   the web instances wherever the core nominal type is expected.

   If a future divergence appears between the two type sets, this is the single
   place to map it explicitly (rather than casting at the call site).

   Effect chains (v3): a source tagged `format: 'effects'` takes a separate path,
   {@link buildEffectsShow}, which delegates to core `effectChain.buildRuntimeShow` — the builder
   the server restores from — instead of the graph assembly below. The graph path is unchanged
   until the graph model is retired (effect-chains S08). */

import {
  assertShowIntegrity,
  effectChain,
  resolveEffectAlias,
  SHOWS_VERSION_EFFECTS,
  SONGS_VERSION_EFFECTS,
  voice,
  type CanvasScene,
} from '@ledrums/core';
import { referencedGraphs, type Song } from '../app/setlist';
import { type Bus, type EffectDef, type Preset, type Section, type TriggerGraph } from './sim';

/** The slice of the store this adapter reads (kept narrow + read-only). */
export interface ShowSource {
  buses: Bus[];
  graphs: Record<string, TriggerGraph>;
  sections: Section[];
  effects: EffectDef[];
  presets: Preset[];
  /** User-authored canvas scene docs — registered in the engine so `canvas:<id>` resolves. */
  canvasScenes?: CanvasScene[];
  /** Canonical kit drums — every graph key's drum is validated against these. */
  drums: { id: string }[];
  /** Authored setlist songs — slot refs are validated against the graph keys. */
  songs?: Song[];
}

/**
 * Assemble a {@link voice.Show} from the lab store. This is the explicit bridge from
 * web-authored setlists (songs → sections → flat ordered graph-key lists) to the runtime
 * show model (songs → sections → padKey slot grids). Graph definitions stay shared by key
 * in `Show.graphs`; sections reference those keys and never copy graph bodies.
 *
 * Validates referential integrity at this boundary (the same core check the server
 * load path reuses): every graph key resolves to a kit drum, and every setlist slot
 * references a real graph. A dangling ref throws here instead of misrendering later.
 */
export function buildShow(source: ShowSource | EffectsShowSource): voice.Show {
  if (isEffectsShowSource(source)) return buildEffectsShow(source).show;
  assertShowIntegrity({
    drumIds: source.drums.map((d) => d.id),
    graphKeys: Object.keys(source.graphs),
    slotRefs: (source.songs ?? []).flatMap((song) => referencedGraphs(song)),
  });
  return {
    buses: source.buses.map((b) => ({ ...b })),
    // Graphs (incl. the `value` switch mode + per-band edge `fromPort`s) pass through
    // by structural assignment: core's `voice` types now model `on:'value'` and
    // `fromPort`, so the web↔core graph types have re-converged (no cast needed).
    // Effect aliases (D1) are consulted here too so a Show pushed to the engine never
    // carries a retired effect id — retired ids resolve to their live replacement.
    graphs: normalizeRuntimeGraphs(aliasResolvedGraphs(source.graphs)),
    // Section snapshots carry the per-bus `looks` the engine spawns on recall (S15).
    // Deep-copy `looks` so the sent Show is a true snapshot, never a live alias of the
    // rune-backed section state (the header's snapshot invariant).
    sections: source.sections.map((s) => ({ ...s, looks: { ...s.looks } })),
    effects: source.effects.map((e) => ({ ...e })),
    presets: source.presets.map((p) => ({ ...p })),
    // User-authored canvas scenes travel in the show doc so the engine's setShow registers
    // them into the pure canvas registry — `canvas:<sceneId>` then resolves for real output.
    // JSON round-trip (not structuredClone): `source` may be the live store, whose scenes are
    // Svelte `$state` proxies — structuredClone throws DataCloneError on proxies, while
    // JSON.stringify reads through them. Scenes are plain JSON data by definition (persisted).
    canvasScenes: (source.canvasScenes ?? []).map((scene) => JSON.parse(JSON.stringify(scene)) as CanvasScene),
    songs: (source.songs ?? []).map((song) => ({
      id: song.id,
      name: song.name,
      sections: song.sections.map((sec) => voice.runtimeSectionFromGraphKeys({
        id: sec.id,
        name: sec.name,
        graphKeys: sec.graphs,
        graphs: source.graphs,
      })),
    })),
  };
}

/** Rewrite play-node effect ids through the alias map so the pushed Show never references a
    retired id (D1). Copies only graphs that actually change — identity while the map is empty. */
function aliasResolvedGraphs(
  graphs: Record<string, TriggerGraph>,
): Record<string, TriggerGraph> {
  const out: Record<string, TriggerGraph> = {};
  for (const [key, graph] of Object.entries(graphs)) {
    let changed = false;
    const nodes = graph.nodes.map((n) => {
      if ((n.kind !== 'play' && n.kind !== 'effect') || !n.effectId) return n;
      const resolved = resolveEffectAlias(n.effectId);
      if (resolved === n.effectId) return n;
      changed = true;
      return { ...n, effectId: resolved, presetId: `${resolved}:default` };
    });
    out[key] = changed ? { ...graph, nodes } : graph;
  }
  return out;
}

function normalizeRuntimeGraphs(graphs: Record<string, TriggerGraph>): Record<string, TriggerGraph> {
  const out: Record<string, TriggerGraph> = {};
  for (const [key, graph] of Object.entries(graphs)) out[key] = voice.normalizeTriggerGraphToGen3(graph).graph as TriggerGraph;
  return out;
}

// ---- v3 (effect chains) -----------------------------------------------------------

/** One authored v3 section: the section stack plus its Master chain. */
export interface EffectsSectionSource {
  id: string;
  name: string;
  effects: readonly effectChain.Effect[];
  master: readonly effectChain.ModifierDevice[];
  bars?: number;
  bpm?: number;
}

/** One authored v3 song (a show's own, or a song-library entry). */
export interface EffectsSongSource {
  id: string;
  name: string;
  sections: readonly EffectsSectionSource[];
}

/** A song-library entry: already re-keyed under its `lib:<songId>/` namespace by extraction. */
export interface EffectsLibrarySongSource extends EffectsSongSource {
  canvasScenes?: readonly CanvasScene[];
}

/**
 * The v3 authored source: the ACTIVE show's authored state (refs unresolved, exactly as
 * persisted) plus the song library its `songRefs` point into. `format` discriminates it from
 * the graph-era {@link ShowSource}.
 */
export interface EffectsShowSource {
  format: 'effects';
  songs: readonly EffectsSongSource[];
  /** Ids into `songLibrary`, in setlist order. Duplicates / dangling refs are skipped by core. */
  songRefs: readonly string[];
  canvasScenes: readonly CanvasScene[];
  /** The song library (`id → song`); `null` / absent when there is none. */
  songLibrary?: Readonly<Record<string, EffectsLibrarySongSource>> | null;
}

/** An assembled v3 Show plus every authored Effect / master modifier core left out of it. */
export interface EffectsShowBuild {
  show: voice.Show;
  diagnostics: effectChain.LibraryDiagnostic[];
}

function isEffectsShowSource(source: ShowSource | EffectsShowSource): source is EffectsShowSource {
  return 'format' in source && source.format === 'effects';
}

/**
 * Assemble the runtime {@link voice.Show} for a v3 authored source through core
 * `effectChain.buildRuntimeShow` — the SAME builder the server's cold-start / backup restore
 * projects from the persisted blob, so the web and the server build one Show from one library.
 *
 * The source is wrapped as a one-show v3 library (+ a v2 song library) and parsed by core's
 * envelope schemas, so defaults and per-Effect validation match the server exactly: an invalid
 * Effect or master modifier is dropped and reported in `diagnostics`, never thrown. A
 * structurally unusable source (e.g. a section without an id) throws with the failing path.
 *
 * The source is JSON-snapshotted first: it may be the live store, whose `$state` proxies
 * `structuredClone` (used inside core) cannot copy — and the sent Show must never alias it.
 */
export function buildEffectsShow(source: EffectsShowSource): EffectsShowBuild {
  const authored = snapshot({
    songs: source.songs,
    songRefs: source.songRefs,
    canvasScenes: source.canvasScenes,
  });
  const showLib = effectChain.parseShowLibraryV3({
    version: SHOWS_VERSION_EFFECTS,
    data: { shows: { active: { authored } }, activeShowId: 'active' },
  });
  const songLib = source.songLibrary
    ? effectChain.parseSongLibraryV2({ version: SONGS_VERSION_EFFECTS, data: { songs: snapshot(source.songLibrary) } })
    : null;
  const { show, diagnostics } = effectChain.buildRuntimeShow(showLib, songLib);
  // One show in, so core always selects it; a null here is a core contract break.
  if (!show) throw new Error('buildEffectsShow: core buildRuntimeShow returned no show');
  return { show, diagnostics };
}

function snapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

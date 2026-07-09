/* Adapter: the lab's editable config (the rune-backed `store`) → a `voice.Show`,
   the authored-content aggregate the real server engine runs. The lab's `sim.ts`
   types were the SOURCE the core `voice` types were ported from, so the shapes are
   structurally identical (Bus / Preset / Section / EffectDef / GraphNode / Envelope
   / TriggerGraph all line up field-for-field). That lets us assemble the Show by
   structural assignment with no `as any` — TypeScript's structural typing accepts
   the web instances wherever the core nominal type is expected.

   If a future divergence appears between the two type sets, this is the single
   place to map it explicitly (rather than casting at the call site). */

import { assertShowIntegrity, resolveEffectAlias, voice, type CanvasScene } from '@ledrums/core';
import { referencedGraphs, type Song } from '../app/setlist';
import { triggerSourceOf, type Bus, type EffectDef, type Preset, type Section, type TriggerGraph } from './sim';

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
export function buildShow(source: ShowSource): voice.Show {
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
      sections: song.sections.map((sec) => ({
        id: sec.id,
        name: sec.name,
        // A section is a FLAT ordered graph list, but the engine still resolves a pad
        // hit by a padKey-keyed slot grid — so bridge graphs → slots here (the explicit map
        // this adapter's header promises). See sectionSlotsFromGraphs.
        slots: sectionSlotsFromGraphs(sec.graphs, source.graphs),
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

/**
 * Reconstruct the engine's per-pad slot grid (`SlotRefs`) from a section's flat graph
 * list: group each graph under its `drum` source's padKey `"drumId:zone"`, preserving list
 * order so layered same-source graphs keep their order. AUTHORED graphs with a `midi`/`osc`
 * source (or no source / an unknown key) are NOT pad-bound, so they're omitted — the server
 * fires those via direct trigger-source routing, not the section slot path.
 */
function sectionSlotsFromGraphs(
  graphs: readonly string[],
  allGraphs: Record<string, TriggerGraph>,
): Record<string, string[]> {
  const slots: Record<string, string[]> = {};
  for (const key of graphs) {
    const g = allGraphs[key];
    const src = g ? triggerSourceOf(g) : undefined;
    if (src?.kind === 'drum') {
      const pad = `${src.drumId}:${src.zone}`;
      (slots[pad] ??= []).push(key);
    }
  }
  return slots;
}

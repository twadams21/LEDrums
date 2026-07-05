/* Blank-document seed + pad-key helpers — the clean-slate content a fresh/new show starts
   from, and the reset target when SWITCHING shows. PURE (no runes/DOM), like setlist.ts:
   the store's authored `$state` field initializers mirror {@link seedAuthored}; keep the two
   in sync. Extracted from store.svelte.ts unchanged. */

import { BUILTIN_CANVAS_SCENES } from '@ledrums/core';
import { type TriggerGraph, treeToGraph } from '../sim';
import { BUSES, PADS, PRESETS, EFFECTS, SECTIONS, type Pad } from '../fixtures';
import * as setlist from '../../app/setlist';
import type { Song } from '../../app/setlist';
import type { AuthoredState } from '../persistence';

/** Stable graph key for a pad — `"drumId:zone"`. */
export const padKey = (p: Pad): string => `${p.drumId}:${p.zone}`;

/** Kit-derived display label for a pad ("Kick · center") — the friendly name a pad-keyed graph
    starts from (used by pad-label hydration + the graphLabel fallback). */
export const padLabel = (p: Pad): string => `${p.drumLabel} · ${p.zoneLabel}`;

/** Seed one demo song from the fixture sections, each section being the FLAT list of every
    pad's graph key (U4). Each pad graph declares a `drum` source from its padKey (the
    constructor's unionTriggerSources back-fill), so a hit fires only the matching pad's
    graph — reproducing the pre-section per-zone behaviour exactly while every section is a
    real, editable, reusable graph list. References are by graph key, so the same key in two
    sections is the same graph, not a copy; layering a drum is now two graphs in the section
    that share a source (each pad appears once in the seed). */
export function seedSongs(): Song[] {
  const padKeys = PADS.map(padKey);
  return [
    {
      id: 'set-1',
      name: 'Set 1',
      // Seed each fixture section's per-bus `looks` (S16) so the demo looks are AUTHORED content
      // (editable in the Section inspector, persisted, bridged to the engine) — the store's
      // `sections` look-list derives from these, so there's no separate fixture look array to drift.
      sections: SECTIONS.map((s) => setlist.makeSection(s.id, s.name, padKeys, s.looks)),
    },
  ];
}

/** The pad-derived trigger graphs, keyed by padKey — the kit's built-in graph set, seeded
    fresh for a blank document (each pad's tree compiled to a graph). */
export function seedGraphs(): Record<string, TriggerGraph> {
  return Object.fromEntries(PADS.map((p) => [padKey(p), treeToGraph(p.tree)]));
}

/** A blank document's authored content — the clean-slate seed a fresh/new show starts from,
    and the reset target when SWITCHING shows (so no field of the outgoing show bleeds into the
    incoming one). Mirrors the authored `$state` field initializers on TriggerLab; keep the two
    in sync. */
export function seedAuthored(): AuthoredState {
  return {
    graphs: seedGraphs(),
    graphNames: {},
    songs: seedSongs(),
    songRefs: [],
    buses: BUSES.map((b) => ({ ...b })),
    presets: structuredClone(PRESETS),
    effects: [...EFFECTS],
    // structuredClone preserves the source's `readonly` array type, so re-spread into a
    // mutable array — AuthoredState.canvasScenes is user-editable.
    canvasScenes: BUILTIN_CANVAS_SCENES.map((s) => structuredClone(s)),
    selectedPadKey: padKey(PADS[2]!),
    activeSongId: 'set-1',
    activeSectionId: SECTIONS[0]?.id ?? null,
    bpm: 120,
    velocity: 0.85,
    beatsPerBar: 4,
    paneSizes: {},
    patchLabels: {},
  };
}

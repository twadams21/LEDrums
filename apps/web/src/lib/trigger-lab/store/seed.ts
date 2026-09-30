/* Blank-document seed + pad-key helpers — the clean-slate content a fresh/new show starts
   from, and the reset target when SWITCHING shows. PURE (no runes/DOM), like setlist.ts:
   the store's authored `$state` field initializers mirror {@link seedAuthored}; keep the two
   in sync. Extracted from store.svelte.ts unchanged. */

import { type TriggerGraph, treeToGraph } from '../sim';
import { BUSES, PADS, PRESETS, EFFECTS, SECTIONS, type Pad } from '../fixtures';
import * as setlist from '../../app/setlist';
import type { Song } from '../../app/setlist';
import type { AuthoredState, AuthoredStateV3 } from '../persistence';
import { SEED_SONG_ID, seedAuthoredV3, seedEffectSection } from '../seed-effects';

/** Stable graph key for a pad — `"drumId:zone"`. */
export const padKey = (p: Pad): string => `${p.drumId}:${p.zone}`;

/** Kit-derived display label for a pad ("Kick · center") — the friendly name a pad-keyed graph
    starts from (used by pad-label hydration + the graphLabel fallback). */
export const padLabel = (p: Pad): string => `${p.drumLabel} · ${p.zoneLabel}`;

/** Stable, section-owned seed key. It is deliberately distinct from the legacy pad key so a
    fresh show cannot accidentally link its sections through the old canonical identity. */
export const seedGraphKey = (sectionId: string, p: Pad): string => `graph:seed:${sectionId}:${padKey(p)}`;

/** Seed one demo song from the fixture sections. Every section gets its own graph key and graph
    object by default; the labels and ordered pad list remain the same as the fixture. */
export function seedSongs(): Song[] {
  return [
    {
      id: 'set-1',
      name: 'Set 1',
      // Seed each fixture section's per-bus `looks` (S16) so the demo looks are AUTHORED content
      // (editable in the Section inspector, persisted, bridged to the engine) — the store's
      // `sections` look-list derives from these, so there's no separate fixture look array to drift.
      sections: SECTIONS.map((s) => setlist.makeSection(s.id, s.name, PADS.map((p) => seedGraphKey(s.id, p)), s.looks)),
    },
  ];
}

/** The section-owned pad-derived trigger graphs for a blank document. */
export function seedGraphs(): Record<string, TriggerGraph> {
  return Object.fromEntries(
    SECTIONS.flatMap((section) =>
      PADS.map((p) => {
        const graph = treeToGraph(p.tree);
        const trigger = graph.nodes.find((node) => node.kind === 'trigger');
        if (trigger) trigger.source = { kind: 'drum', drumId: p.drumId, zone: String(p.zone) };
        return [seedGraphKey(section.id, p), graph] as const;
      }),
    ),
  );
}

export function seedGraphNames(): Record<string, string> {
  return Object.fromEntries(SECTIONS.flatMap((section) => PADS.map((p) => [seedGraphKey(section.id, p), padLabel(p)])));
}

/** A blank document's authored content — the clean-slate seed a fresh/new show starts from,
    and the reset target when SWITCHING shows (so no field of the outgoing show bleeds into the
    incoming one). Mirrors the authored `$state` field initializers on TriggerLab; keep the two
    in sync. */
export function seedAuthored(): AuthoredState {
  return {
    graphs: seedGraphs(),
    graphNames: seedGraphNames(),
    songs: seedSongs(),
    songRefs: [],
    buses: BUSES.map((b) => ({ ...b })),
    presets: structuredClone(PRESETS),
    effects: [...EFFECTS],
    // Only USER-AUTHORED scenes live in the show document (D4) — the built-in canvas
    // library ships in core and is surfaced read-only via `store.allCanvasScenes`.
    canvasScenes: [],
    selectedPadKey: seedGraphKey(SECTIONS[0]?.id ?? 'intro', PADS[2]!),
    activeSongId: 'set-1',
    activeSectionId: SECTIONS[0]?.id ?? null,
    bpm: 120,
    velocity: 0.85,
    beatsPerBar: 4,
    paneSizes: {},
    patchLabels: {},
    autoZoneGraphs: false,
  };
}

// ---- effect chains (S05) ---------------------------------------------------------------------

/**
 * A fresh v3 show's authored content: the effect-chains seed (`seed-effects.ts`) with the demo
 * Effects in the Intro section, followed by the fixture's other sections (Verse, Chorus) empty —
 * the same three-section song a fresh graph-era show started with (agent-chosen, S05 §1).
 */
export function seedDocumentV3(): AuthoredStateV3 {
  const seed = seedAuthoredV3();
  const demo = seedEffectSection();
  const sections = SECTIONS.map((s) => (s.id === demo.id ? demo : { id: s.id, name: s.name, effects: [], master: [] }));
  if (!sections.some((s) => s.id === demo.id)) sections.unshift(demo);
  return { ...seed, songs: seed.songs.map((song) => (song.id === SEED_SONG_ID ? { ...song, sections } : song)) };
}

/** The graph-era section placements of the seed song (`graphs` / `looks` per section id) — the
    transient graph sandbox's seed until S08 (never persisted). */
export function seedSectionPlacements(): Record<string, { graphs: string[]; looks: Record<string, string | null> }> {
  const out: Record<string, { graphs: string[]; looks: Record<string, string | null> }> = {};
  for (const song of seedSongs()) for (const s of song.sections) out[s.id] = { graphs: [...s.graphs], looks: { ...s.looks } };
  return out;
}

/* Adapter: the lab's editable config (the rune-backed `store`) → a `voice.Show`,
   the authored-content aggregate the real server engine runs. The lab's `sim.ts`
   types were the SOURCE the core `voice` types were ported from, so the shapes are
   structurally identical (Bus / Preset / Section / EffectDef / GraphNode / Envelope
   / TriggerGraph all line up field-for-field). That lets us assemble the Show by
   structural assignment with no `as any` — TypeScript's structural typing accepts
   the web instances wherever the core nominal type is expected.

   If a future divergence appears between the two type sets, this is the single
   place to map it explicitly (rather than casting at the call site). */

import type { voice } from '@ledrums/core';
import type { Bus, EffectDef, Preset, Section, TriggerGraph } from './sim';

/** The slice of the store this adapter reads (kept narrow + read-only). */
export interface ShowSource {
  buses: Bus[];
  graphs: Record<string, TriggerGraph>;
  sections: Section[];
  effects: EffectDef[];
  presets: Preset[];
}

/**
 * Assemble a {@link voice.Show} from the lab store. Graphs stay keyed by the
 * padKey `"drumId:zone"` the store already uses — the engine's registry expects
 * exactly that key, so the map is passed through verbatim. Arrays are copied so
 * the sent Show is a snapshot, not a live alias of the rune state.
 */
export function buildShow(source: ShowSource): voice.Show {
  return {
    buses: source.buses.map((b) => ({ ...b })),
    graphs: { ...source.graphs },
    sections: source.sections.map((s) => ({ ...s })),
    effects: source.effects.map((e) => ({ ...e })),
    presets: source.presets.map((p) => ({ ...p })),
  };
}

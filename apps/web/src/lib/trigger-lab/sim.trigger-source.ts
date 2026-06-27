/* =============================================================================
   TRIGGER LAB — trigger source + value normalization (extracted from sim.ts, S3.3).

   The ONE source-match + value-normalization seam every input (drum/midi/osc)
   feeds, plus offline DIRECT graph resolution. Mirrors the engine's source model
   byte-for-byte. Pure — no behaviour change. Part of the throwaway lab.
   ============================================================================= */

import { clampUnit } from './sim.envelopes';
import type { TriggerGraph } from './sim.graph-compilation';

/** What input fires a trigger graph — declared on the graph's `trigger` node. A tagged
    union: `drum` is the existing implicit padKey binding (`"drumId:zone"`) made explicit;
    `midi` (a note OR a CC) and `osc` (an address) are direct bindings for AUTHORED graphs
    that have no physical drum zone. The MIDI channel and OSC host/namespace live on the
    patch device, NOT here. Mirrored byte-for-byte in core `voice/types.ts`. */
export type TriggerSource =
  | { kind: 'drum'; drumId: string; zone: string }
  | { kind: 'midi'; note?: number; cc?: number }
  | { kind: 'osc'; address: string };

/** A raw fire from one of the three trigger sources, in that source's native units.
    Normalized to the trigger's 0..1 value by {@link normalizeTriggerValue} — the single
    value the switch `value` mode (gate/bands) routes on, identical across all sources. */
export type TriggerFire =
  | { kind: 'drum'; velocity: number } // Sensory Percussion velocity, already 0..1
  | { kind: 'midi'; value: number } //   MIDI note-on velocity OR CC value, 0..127
  | { kind: 'osc'; arg: number }; //     OSC float argument (clamped to 0..1)

/** Normalize a raw fire to the trigger's 0..1 value — the ONE seam every source feeds so
    they route through the switch `value` mode identically. Pure: drum velocity passes
    through (already 0..1), MIDI note-velocity / CC divides by 127, OSC arg is taken as-is;
    all clamped to 0..1. Not yet wired into eval/resolution (that is a later slice). */
export function normalizeTriggerValue(fire: TriggerFire): number {
  switch (fire.kind) {
    case 'drum':
      return clampUnit(fire.velocity);
    case 'midi':
      return clampUnit(fire.value / 127);
    case 'osc':
      return clampUnit(fire.arg);
  }
}

/** A raw input for offline DIRECT resolution: the identity to match a trigger source
    against, plus the value in that source's native units ({@link normalizeTriggerValue}
    normalizes it). The web mirror of the engine's raw `InputEvent`. */
export type RawTriggerInput =
  | { kind: 'midi'; note?: number; cc?: number; value: number } // value 0..127
  | { kind: 'osc'; address: string; arg: number };

/** A graph's declared input source — its `trigger` node's `source`, or undefined for a
    graph authored before the source model / with none bound. Mirrors core `engine`. */
export function triggerSourceOf(graph: TriggerGraph): TriggerSource | undefined {
  return graph.nodes.find((n) => n.kind === 'trigger')?.source;
}

/** Does a trigger source match a raw MIDI/OSC fire? `drum` sources are pad-bound and
    never match a raw midi/osc fire (they fire via the padKey path). A note fire matches
    a `note` source; a CC fire matches a `cc` source. */
export function sourceMatchesFire(source: TriggerSource | undefined, fire: RawTriggerInput): boolean {
  if (!source) return false;
  if (fire.kind === 'osc') return source.kind === 'osc' && source.address === fire.address;
  if (source.kind !== 'midi') return false;
  if (fire.note !== undefined) return source.note !== undefined && source.note === fire.note;
  if (fire.cc !== undefined) return source.cc !== undefined && source.cc === fire.cc;
  return false;
}

/** Does a trigger source match a physical drum-zone hit? Only a `drum` source matches — its
    `drumId` + `zone` must equal the hit's (zone compared as a string, the padKey form). The
    pad-path counterpart to {@link sourceMatchesFire}: together they are the ONE source-match
    rule the store's section hit-resolution shares with the engine. midi/osc sources never
    match a pad hit (they fire via raw fires). */
export function sourceMatchesPad(source: TriggerSource | undefined, drumId: string, zone: string): boolean {
  return source?.kind === 'drum' && source.drumId === drumId && source.zone === zone;
}

/** Offline DIRECT resolution: the authored graphs a raw MIDI/OSC fire triggers by their
    trigger source, each with the fire's normalized 0..1 value (what eval routes on). The
    web mirror of the engine's `resolveDirectGraphs` — the zone-map precedence half is the
    store's padKey path; this is the second half. Pure (stable key order). */
export function resolveGraphsForFire(
  graphs: Record<string, TriggerGraph>,
  fire: RawTriggerInput,
): Array<{ key: string; graph: TriggerGraph; value: number }> {
  const value = normalizeTriggerValue(
    fire.kind === 'osc' ? { kind: 'osc', arg: fire.arg } : { kind: 'midi', value: fire.value },
  );
  const out: Array<{ key: string; graph: TriggerGraph; value: number }> = [];
  for (const [key, graph] of Object.entries(graphs)) {
    if (sourceMatchesFire(triggerSourceOf(graph), fire)) out.push({ key, graph, value });
  }
  return out;
}

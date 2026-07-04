/* Pure display labels for a trigger graph's input source — the `source` on the graph's
   trigger node (U1 model). ONE place to turn a TriggerSource into the short kind headline
   plus the resolved, self-describing detail line, so the node card and the Inspector never
   drift. No Svelte / DOM — unit-tested in isolation. */
import { ZONE_LABELS } from '../trigger-lab/fixtures';
import { triggerSourceOf, type TriggerGraph, type TriggerSource } from '../trigger-lab/sim';
import { formatMidiNote } from '../midi/midi-note';
import type { InputMap } from '@ledrums/core';

/** Minimal drum roster entry (id → display label) — i.e. `store.drums`. */
export interface DrumRef {
  id: string;
  label: string;
}

/** A trigger source rendered for display. */
export interface TriggerSourceLabel {
  /** Short kind headline — `'Drum' | 'MIDI' | 'OSC' | 'Trigger'` (the last when unbound). */
  label: string;
  /** Resolved, self-describing detail — the node card's sub line. e.g. `'Kick · center'`,
      `'MIDI D2'`, `'MIDI CC 74'`, `'OSC /kick'`, `'unbound'`. */
  sub: string;
}

/** Human zone label for a drum source's numeric zone string (`'0'` → `'center'`). Falls
    back to the raw string for an out-of-range / non-numeric zone. */
export function zoneLabel(zone: string): string {
  if (zone.trim() === '') return zone; // guard JS's Number('') === 0 → would read as 'center'
  const i = Number(zone);
  return Number.isInteger(i) && i >= 0 && i < ZONE_LABELS.length ? ZONE_LABELS[i]! : zone;
}

/** Turn a trigger node's `source` into its display label + sub line. Pure: resolves the
    drum label from `drums` and the zone via {@link zoneLabel}. An unset source (an authored
    graph not yet bound to a MIDI/OSC input) is the `unbound` placeholder. */
export function describeTriggerSource(
  source: TriggerSource | undefined,
  drums: readonly DrumRef[],
): TriggerSourceLabel {
  if (!source) return { label: 'Trigger', sub: 'unbound' };
  switch (source.kind) {
    case 'drum': {
      const drum = drums.find((d) => d.id === source.drumId)?.label ?? source.drumId;
      return { label: 'Drum', sub: `${drum} · ${zoneLabel(source.zone)}` };
    }
    case 'midi':
      // CC wins when both happen to be set — the editor only ever writes one of them.
      if (source.cc !== undefined) return { label: 'MIDI', sub: `MIDI CC ${source.cc}` };
      if (source.note !== undefined) return { label: 'MIDI', sub: `MIDI ${formatMidiNote(source.note)}` };
      return { label: 'MIDI', sub: 'MIDI — set a note' };
    case 'osc': {
      const addr = source.address.trim();
      return { label: 'OSC', sub: addr ? `OSC ${addr}` : 'OSC — set an address' };
    }
  }
}

/** A drum zone a trigger source is ALSO mapped to through the patch zone-map — the
    "drum-link". Both paths fire for one message by design (doc 03 §4), so the trigger node
    flags it instead of hiding it. */
export interface ZoneLink {
  drumId: string;
  /** Numeric slot as a string (the padKey / `drum`-source zone form) → renders via
      {@link zoneLabel} / {@link describeTriggerSource}, e.g. `'kick · center'`. */
  zone: string;
}

/** Does a MIDI/OSC trigger `source` ALSO resolve to a drum zone via the patch input map? A
    note source matched in `midiNotes`, or an OSC address matched in `oscMap`, returns that
    zone's `(drumId, zone)` — the note/address fires BOTH the direct graph and the pad graph
    (both-fire is kept by design; this surfaces it). Returns null for an unbound source, a
    `drum` source (it IS the drum trigger — no extra link), a CC source (the zone-map keys
    notes, not CCs), or a source that maps to no zone. Pure — the node icon + inspector hint
    read only this. */
export function zoneLinkForSource(inputMap: InputMap, source: TriggerSource | undefined): ZoneLink | null {
  if (!source) return null;
  if (source.kind === 'midi') {
    if (source.cc !== undefined) return null; // CC wins (as in describeTriggerSource); CCs aren't zone-mapped
    if (source.note === undefined) return null;
    const m = inputMap.midiNotes.find((n) => n.note === source.note);
    return m ? { drumId: m.drumId, zone: String(m.slot) } : null;
  }
  if (source.kind === 'osc') {
    const addr = source.address.trim();
    if (!addr) return null;
    const m = inputMap.oscMap.find((o) => o.address === addr);
    return m ? { drumId: m.drumId, zone: String(m.slot) } : null;
  }
  return null; // drum source — already a drum trigger
}

/** The drum-link hint text a zone-mapped source shows, or null when the source isn't
    zone-mapped. `"also drum trigger: kick · center"` — the ONE phrasing the trigger node's
    icon tooltip and the source inspector share so they never drift. */
export function drumLinkHint(
  inputMap: InputMap,
  source: TriggerSource | undefined,
  drums: readonly DrumRef[],
): string | null {
  const link = zoneLinkForSource(inputMap, source);
  if (!link) return null;
  return `also drum trigger: ${describeTriggerSource({ kind: 'drum', ...link }, drums).sub}`;
}

/** The reverse of {@link zoneLinkForSource}: the authored graphs a patch zone's note/address
    ALSO fires directly. Returns the graph keys whose trigger source is a MIDI note equal to
    `note`, or an OSC address equal to `address` — so the zone inspector can show "this zone's
    note also fires graph X". Pure; iterates a stable key order. The caller turns keys into
    display names (`store.graphLabel`). */
export function graphsLinkedToZone(
  graphs: Record<string, TriggerGraph>,
  note: number | null,
  address: string | null,
): string[] {
  const trimmedAddr = address?.trim() ?? '';
  const out: string[] = [];
  for (const [key, graph] of Object.entries(graphs)) {
    const src = triggerSourceOf(graph);
    if (!src) continue;
    if (src.kind === 'midi' && src.cc === undefined && src.note !== undefined && note !== null && src.note === note) {
      out.push(key);
    } else if (src.kind === 'osc' && trimmedAddr !== '' && src.address.trim() === trimmedAddr) {
      out.push(key);
    }
  }
  return out;
}

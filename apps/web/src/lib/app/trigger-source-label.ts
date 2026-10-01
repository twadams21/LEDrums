/* Pure display labels for an input source (a drum zone, a MIDI note / CC, an OSC address) — ONE
   place to turn a TriggerSource into the short kind headline plus the resolved, self-describing
   detail line, so the binding-refusal copy and the global-control labels never drift. No Svelte /
   DOM — unit-tested in isolation. */
import { zoneLabel as configuredZoneLabel } from './docks/patch-inspector';
import { ZONE_LABELS } from '../trigger-lab/fixtures';
import { formatMidiNote } from '../midi/midi-note';
import type { InputMap, voice } from '@ledrums/core';

type TriggerSource = voice.TriggerSource;

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

/** Turn an input `source` into its display label + sub line. Pure: resolves the drum label from
    `drums` and the zone via {@link zoneLabel}. An unset source is the `unbound` placeholder. */
export function describeTriggerSource(
  source: TriggerSource | undefined,
  drums: readonly DrumRef[],
  inputMap?: InputMap,
): TriggerSourceLabel {
  if (!source) return { label: 'Trigger', sub: 'unbound' };
  switch (source.kind) {
    case 'drum': {
      const drum = drums.find((d) => d.id === source.drumId)?.label ?? source.drumId;
      const zone = inputMap && source.zone.trim() !== '' && Number.isInteger(Number(source.zone))
        ? configuredZoneLabel(inputMap, source.drumId, Number(source.zone))
        : zoneLabel(source.zone);
      return { label: 'Drum', sub: `${drum} · ${zone}` };
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

/** A drum zone a source is ALSO mapped to through the patch zone-map — the "drum-link". Both
    paths fire for one message by design (doc 03 §4), so the labels flag it instead of hiding it. */
export interface ZoneLink {
  drumId: string;
  /** Numeric slot as a string (the padKey / `drum`-source zone form) → renders via
      {@link zoneLabel} / {@link describeTriggerSource}, e.g. `'kick · center'`. */
  zone: string;
}

/** Does a MIDI/OSC `source` ALSO resolve to a drum zone via the patch input map? A note source
    matched in `midiNotes`, or an OSC address matched in `oscMap`, returns that zone's
    `(drumId, zone)` (both-fire is kept by design; this surfaces it). Returns null for an unbound
    source, a `drum` source (it IS the drum trigger — no extra link), a CC source (the zone-map
    keys notes, not CCs), or a source that maps to no zone. Pure. */
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

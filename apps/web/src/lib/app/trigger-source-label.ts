/* Pure display labels for a trigger graph's input source — the `source` on the graph's
   trigger node (U1 model). ONE place to turn a TriggerSource into the short kind headline
   plus the resolved, self-describing detail line, so the node card and the Inspector never
   drift. No Svelte / DOM — unit-tested in isolation. */
import { ZONE_LABELS } from '../trigger-lab/fixtures';
import type { TriggerSource } from '../trigger-lab/sim';
import { formatMidiNote } from '../midi/midi-note';

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

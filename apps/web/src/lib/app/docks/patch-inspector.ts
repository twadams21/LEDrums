/* Pure helpers backing the Patch-graph per-node Inspector (S4). No Svelte / DOM here,
   so the node-id decoding, per-hoop pixel math, and input-map editing are unit-testable
   in node — mirroring the project's "pure core, reactive shell" split (patch-routing.ts,
   shell-nav.ts). The reactive `Inspector.svelte` is a thin consumer.

   It reads the AUTHORITATIVE routing (`store.project.kit.outputs` → S2 `outputsToPatch`)
   to derive the read-outs (first/last pixel, ordering), and edits the real project via
   the S3 store mutators — so each Patch node becomes the editor of the device setting it
   represents. */

import { drumDensity, type DrumConfig, type InputMap, type KitConfig } from '@ledrums/core';
import { ZONE_LABELS } from '../../trigger-lab/fixtures';
import { parseHoopNodeId, parseOutputNodeId } from '../patch-graph';
import type { HoopRef, PatchRouting, PixelSpan } from '../patch-routing';

const MM_PER_INCH = 25.4;

/** Which Inspector editor a selected Patch node opens, with its decoded references.
    The id grammar is minted by patch-topology.ts / patch-graph.ts. */
export type PatchEditor =
  | { kind: 'input' }
  | { kind: 'trigger'; drumId: string }
  | { kind: 'triggers' } // the Drum Triggers holder zone (D1)
  | { kind: 'zone'; drumId: string; zone: string; slot: number }
  | { kind: 'drum'; drumId: string }
  | { kind: 'kit' } // the Drum Kit holder zone (D1)
  | { kind: 'hoop'; drumId: string; hoop: number } // 1-based hoop index (A1)
  | { kind: 'output'; outputId: string }
  | { kind: 'controller' }
  | { kind: 'unknown'; id: string };

/** Map a Patch zone label to its trigger slot — the 0-based index in the canonical
    zone order (`fixtures.ZONE_LABELS`). InputMap keys MIDI/OSC by `(drumId, slot)`, so
    the same labelled zone on any drum resolves to a stable slot. Unknown labels → 0. */
export function zoneSlot(zone: string): number {
  const i = ZONE_LABELS.indexOf(zone);
  return i >= 0 ? i : 0;
}

/** Decode a Patch flow-node id into the editor it should open plus its refs. */
export function patchEditorFor(id: string): PatchEditor {
  if (id === 'input') return { kind: 'input' };
  if (id === 'controller') return { kind: 'controller' };
  if (id === 'kit') return { kind: 'kit' }; // Drum Kit holder zone (D1)
  if (id === 'triggers') return { kind: 'triggers' }; // Drum Triggers holder zone (D1)

  const hoop = parseHoopNodeId(id);
  if (hoop) return { kind: 'hoop', drumId: hoop.drumId, hoop: hoop.hoop };

  const outputId = parseOutputNodeId(id);
  if (outputId !== null) return { kind: 'output', outputId };

  const parts = id.split(':');
  switch (parts[0]) {
    case 'trigger':
      return parts.length >= 2 && parts.slice(1).join(':')
        ? { kind: 'trigger', drumId: parts.slice(1).join(':') }
        : { kind: 'unknown', id };
    case 'zone': {
      // zone:<drumId>:<zoneLabel> — the label is the LAST segment; rejoin the middle
      // defensively in case a drum id ever carries a ':'.
      if (parts.length < 3) return { kind: 'unknown', id };
      const zone = parts[parts.length - 1]!;
      const drumId = parts.slice(1, -1).join(':');
      return drumId ? { kind: 'zone', drumId, zone, slot: zoneSlot(zone) } : { kind: 'unknown', id };
    }
    case 'drum':
      return parts.slice(1).join(':') ? { kind: 'drum', drumId: parts.slice(1).join(':') } : { kind: 'unknown', id };
    default:
      return { kind: 'unknown', id };
  }
}

/** Effective pixels-per-hoop for a drum. Mirrors core's PRIVATE `pixelsPerHoop`
    (geometry/pixel-model.ts): a literal `pixelsPerHoop` override wins, else
    density × circumference rounded (≥1). Kept in step with that helper — if core's
    formula changes, change it here too. Every hoop on a drum shares this count. */
export function pixelsPerHoopForDrum(drum: DrumConfig, kit: KitConfig): number {
  if (drum.pixelsPerHoop !== undefined) return drum.pixelsPerHoop;
  const circumferenceM = (Math.PI * drum.diameterIn * MM_PER_INCH) / 1000;
  return Math.max(1, Math.round(circumferenceM * drumDensity(kit, drum)));
}

/** First/last GLOBAL pixel index a single hoop covers, sweeping the routing in transmit
    order (outputs → hoops) — the same walk as S2 `pixelRanges`. null when the hoop is wired
    into no output, or carries no pixels. */
export function hoopPixelSpan(
  routing: PatchRouting,
  target: HoopRef,
  pixelsForHoop: (h: HoopRef) => number,
): PixelSpan | null {
  let cursor = 0;
  for (const output of routing.outputs) {
    for (const h of output.hoops) {
      const count = pixelsForHoop(h);
      if (count <= 0) continue;
      if (h.drumId === target.drumId && h.hoop === target.hoop) {
        return { first: cursor, last: cursor + count - 1 };
      }
      cursor += count;
    }
  }
  return null;
}

// --- input-map editing (zone node MIDI / OSC) ----------------------------------------
// Pure, immutable updates keyed by (drumId, slot). The store optimistic-writes the result
// and forwards `setInputMap` over WS.

/** The MIDI note mapped to `(drumId, slot)`, or null. */
export function zoneMidiNote(map: InputMap, drumId: string, slot: number): number | null {
  return map.midiNotes.find((n) => n.drumId === drumId && n.slot === slot)?.note ?? null;
}

/** The OSC address mapped to `(drumId, slot)`, or null. */
export function zoneOscAddress(map: InputMap, drumId: string, slot: number): string | null {
  return map.oscMap.find((o) => o.drumId === drumId && o.slot === slot)?.address ?? null;
}

/** Immutably set (or clear, when null) the MIDI note for `(drumId, slot)`. */
export function setZoneMidiNote(map: InputMap, drumId: string, slot: number, note: number | null): InputMap {
  const rest = map.midiNotes.filter((n) => !(n.drumId === drumId && n.slot === slot));
  return { ...map, midiNotes: note === null ? rest : [...rest, { note, drumId, slot }] };
}

/** Immutably set (or clear, when null / blank) the OSC address for `(drumId, slot)`. */
export function setZoneOscAddress(map: InputMap, drumId: string, slot: number, address: string | null): InputMap {
  const rest = map.oscMap.filter((o) => !(o.drumId === drumId && o.slot === slot));
  const trimmed = address?.trim();
  return { ...map, oscMap: trimmed ? [...rest, { address: trimmed, drumId, slot }] : rest };
}

/* Pure helpers backing the Patch-graph per-node Inspector (S4). No Svelte / DOM here,
   so the node-id decoding, per-hoop pixel math, and input-map editing are unit-testable
   in node — mirroring the project's "pure core, reactive shell" split (patch-routing.ts,
   shell-nav.ts). The reactive `Inspector.svelte` is a thin consumer.

   It reads the AUTHORITATIVE routing (`store.project.kit.outputs` → S2 `outputsToPatch`)
   to derive the read-outs (first/last pixel, ordering), and edits the real project via
   the S3 store mutators — so each Patch node becomes the editor of the device setting it
   represents. */

import { drumDensity, SLOT_LABELS, type DrumConfig, type InputMap, type KitConfig, type voice } from '@ledrums/core';
import { ZONE_LABELS } from '../../trigger-lab/fixtures';
import { parseHoopNodeId, parseOutputNodeId } from '../patch-graph';
import type { HoopRef, PatchRouting, PixelSpan } from '../patch-routing';

const CHANNELS_PER_UNIVERSE = 512;

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

// --- pixel-count read-outs (C2 kit, C5 hoop) -----------------------------------------
// Per-hoop counts honour first-class `hoops[]` (B4) when present, else the drum's uniform
// density-derived count. Mirrors core's own per-hoop resolution (geometry/pixel-model.ts).

/** Effective hoop count for a drum: an explicit `hoops[]` (B4) wins (its length IS the
    count), else a per-drum `hoopCount` override, else the kit global. Matches core's
    hoop-count resolution so read-outs agree with the compiled pixel model. */
function hoopCountForDrum(drum: DrumConfig, kit: KitConfig): number {
  return drum.hoops?.length ?? drum.hoopCount ?? kit.global.hoopCount;
}

/** Pixel count for ONE hoop (1-based `hoopIndex`): the first-class `hoops[hoopIndex-1].pixelCount`
    (B4) when present, else the drum's uniform {@link pixelsPerHoopForDrum}. Out-of-range indices
    (or a drum with no `hoops[]`) fall back to the uniform count. For the C5 hoop read-out. */
export function perHoopPixelCount(drum: DrumConfig, kit: KitConfig, hoopIndex: number): number {
  return drum.hoops?.[hoopIndex - 1]?.pixelCount ?? pixelsPerHoopForDrum(drum, kit);
}

/** Total pixels across the WHOLE kit: sum of every hoop's {@link perHoopPixelCount} over every
    drum (honouring mixed per-hoop counts). For the C2 kit read-out. */
export function totalKitPixelCount(kit: KitConfig): number {
  let total = 0;
  for (const drum of kit.drums) {
    const n = hoopCountForDrum(drum, kit);
    for (let hoop = 1; hoop <= n; hoop++) total += perHoopPixelCount(drum, kit, hoop);
  }
  return total;
}

// --- physical output mapping (C4 output) ---------------------------------------------

/** The physical Advatek port + data line a **0-based** logical output index drives. The inverse
    of core's {@link logicalOutputsForPhysical}: in EXPANDED mode (B2/B5) the 8 logical outputs map
    onto 4 physical ports × 2 data lines — logical n (1-based) → port `ceil(n/2)`, line `((n-1)%2)+1`;
    in normal mode each logical output IS its own port on line 1. Both `port` and `line` are 1-based
    (device convention). For the C4 output read-out. */
export function physicalPortLine(outputIndex: number, expanded: boolean): { port: number; line: number } {
  const n = outputIndex + 1; // 1-based logical output number
  if (!expanded) return { port: n, line: 1 };
  return { port: Math.ceil(n / 2), line: ((n - 1) % 2) + 1 };
}

/** One row of the C4 Pixel Output Table: an output's transmit-order position, where its first
    pixel lands in the dense DMX stream, and how many pixels it carries.

    Channel math MIRRORS core's {@link buildDmxMap} exactly: a single global channel cursor starts
    at 0, snaps to `output.startUniverse * 512` when that output declares one (blank = dense/auto),
    and advances `channelsPerPixel` per pixel. So `startChannel` is the GLOBAL, 0-based DMX channel
    of the output's first pixel (core's `PixelDmx.channel`), and `startUniverse` is its 0-based
    universe (`floor(startChannel / 512)`), `null` for an unwired output (no pixels, no start).

    The C4 view derives the PixLite device columns from these: device `startUni = startUniverse + 1`
    and `startCh = startChannel % 512 + 1` (the API models both from 1 — see PixLite Mk3 API v1.7
    `pixPort.startUni` / `startCh`). */
export type PixelOutputRow = {
  outputId: string;
  index: number;
  startUniverse: number | null;
  startChannel: number;
  pixelCount: number;
};

/** Build the C4 Pixel Output Table: one {@link PixelOutputRow} per output in transmit order,
    mirroring core's dense-channel packing so the read-out is byte-truthful. `pixelsForHoop`
    supplies each hoop's literal count (per-hoop B4 aware). An unwired output (no hoops / zero
    pixels) still occupies a row (`pixelCount: 0`, `startUniverse: null`) and still applies its
    own `startUniverse` snap to the shared cursor — matching core. */
export function buildPixelOutputTable(
  routing: PatchRouting,
  _kit: KitConfig,
  pixelsForHoop: (h: HoopRef) => number,
): PixelOutputRow[] {
  const rows: PixelOutputRow[] = [];
  let cursor = 0; // next global DMX channel to assign

  routing.outputs.forEach((output, index) => {
    if (output.startUniverse !== undefined) cursor = output.startUniverse * CHANNELS_PER_UNIVERSE;
    const startChannel = cursor;

    let pixelCount = 0;
    for (const hoop of output.hoops) {
      const count = pixelsForHoop(hoop);
      if (count <= 0) continue;
      pixelCount += count;
      cursor += count * output.channelsPerPixel;
    }

    rows.push({
      outputId: output.id,
      index,
      startUniverse: pixelCount > 0 ? Math.floor(startChannel / CHANNELS_PER_UNIVERSE) : null,
      startChannel,
      pixelCount,
    });
  });

  return rows;
}

// --- trigger bindings (C3 drum, C6 trigger) ------------------------------------------

/** The trigger graph bound to a drum by IDENTITY — the first graph whose `trigger` node carries a
    `drum` source ({@link voice.TriggerSource}) for `drumId`. Read-only lookup over the graphs map
    (`store.graphs` shape, `Record<graphKey, TriggerGraph>`); returns the graph key plus a
    `drumId:zone` binding label, or `null` when no graph is bound. A `voice.TriggerGraph` carries no
    human name (that lives in the store's separate `graphNames`), so the C3 view MAY upgrade `label`
    via `store.graphLabel(graphKey)`; the returned label is a self-contained fallback. */
export function boundTriggerFor(
  drumId: string,
  graphs: Record<string, voice.TriggerGraph>,
): { graphKey: string; label: string } | null {
  for (const [graphKey, graph] of Object.entries(graphs)) {
    const source = graph.nodes.find((n) => n.kind === 'trigger')?.source;
    if (source?.kind === 'drum' && source.drumId === drumId) {
      return { graphKey, label: `${source.drumId}:${source.zone}` };
    }
  }
  return null;
}

/** The zone slots a drum HAS — every distinct slot declared (`zones`) OR bound (a MIDI note / OSC
    address) for `drumId`, sorted ascending. The single definition of "a zone" on a drum, shared by
    the trigger-node face's zone count and the Inspector's zones list — so the node's "N zones" and
    the Inspector's rows never disagree. A declared-but-unbound zone counts (it persists in `zones`). */
export function zoneSlotsForDrum(map: InputMap, drumId: string): number[] {
  const slots = new Set<number>();
  for (const z of map.zones ?? []) if (z.drumId === drumId) slots.add(z.slot);
  for (const n of map.midiNotes) if (n.drumId === drumId) slots.add(n.slot);
  for (const o of map.oscMap) if (o.drumId === drumId) slots.add(o.slot);
  return [...slots].sort((a, b) => a - b);
}

/** Declare a zone slot on a drum (immutably) — persists an added zone before it carries any MIDI/OSC
    binding. Idempotent: a slot already declared (or already bound, hence already a zone) is a no-op. */
export function addDeclaredZone(map: InputMap, drumId: string, slot: number): InputMap {
  const zones = map.zones ?? [];
  if (zones.some((z) => z.drumId === drumId && z.slot === slot)) return map;
  return { ...map, zones: [...zones, { drumId, slot }] };
}

/** Remove a zone from a drum ENTIRELY — drops its declaration and any MIDI-note / OSC binding, so
    the slot is no longer a zone. The inverse of {@link addDeclaredZone} + the per-binding setters. */
export function removeZone(map: InputMap, drumId: string, slot: number): InputMap {
  const cleared = setZoneOscAddress(setZoneMidiNote(map, drumId, slot, null), drumId, slot, null);
  return { ...cleared, zones: (cleared.zones ?? []).filter((z) => !(z.drumId === drumId && z.slot === slot)) };
}

/** Move a zone (declaration + MIDI/OSC bindings) from `oldSlot` to `newSlot` — a re-label. */
export function moveZoneSlot(map: InputMap, drumId: string, oldSlot: number, newSlot: number): InputMap {
  if (oldSlot === newSlot) return map;
  const note = zoneMidiNote(map, drumId, oldSlot);
  const addr = zoneOscAddress(map, drumId, oldSlot);
  let m = removeZone(map, drumId, oldSlot);
  m = addDeclaredZone(m, drumId, newSlot);
  m = setZoneMidiNote(m, drumId, newSlot, note);
  m = setZoneOscAddress(m, drumId, newSlot, addr);
  return m;
}

/** The zone slot LABELS ({@link SLOT_LABELS}) still AVAILABLE on a drum's trigger — those whose
    0-based slot index is neither in `usedSlots` (slots the caller has already assigned in the
    editor) nor already mapped for this drum in `inputMap` (MIDI note or OSC address). For the C6
    trigger zones list (the per-zone slot dropdown, used slots excluded). */
export function availableSlots(inputMap: InputMap, drumId: string, usedSlots: number[]): string[] {
  const used = new Set([...usedSlots, ...zoneSlotsForDrum(inputMap, drumId)]);
  return SLOT_LABELS.filter((_, slot) => !used.has(slot));
}

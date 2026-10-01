/* Patch node-id grammar — the stable string ids Settings keys hoops, drums and outputs by
   (hoop drag-and-drop, per-object user labels). Pure; no Svelte / DOM.

   HOOP INDEX BASE. Hoop indices are **1-based everywhere** since A1: these hoop ids
   (`hoop:<drum>:1..N`), core's `OutputSegment`, and `HoopRef.hoop` all agree (`dmx-map.ts`
   validates `1..hoopCount`). The helpers below just format/parse the shared 1-based number. */

import type { HoopRef } from './patch-routing';

const HOOP_PREFIX = 'hoop:';
const OUTPUT_PREFIX = 'output:';

/** Id for a hoop ref (`hoop:<drumId>:<n>`). Both `HoopRef.hoop` and the id are 1-based (A1). */
export function hoopNodeId(ref: HoopRef): string {
  return `${HOOP_PREFIX}${ref.drumId}:${ref.hoop}`;
}

/** Decode a hoop id back to a 1-based {@link HoopRef}; null if not a hoop.
    Drum ids never contain ':' today, but rejoin the middle defensively anyway. */
export function parseHoopNodeId(id: string): HoopRef | null {
  const parts = id.split(':');
  if (parts[0] !== 'hoop' || parts.length < 3) return null;
  const n = Number(parts[parts.length - 1]);
  if (!Number.isFinite(n)) return null;
  const drumId = parts.slice(1, -1).join(':');
  if (!drumId) return null;
  return { drumId, hoop: n };
}

/** Id for a drum (`drum:<drumId>`) — the key its user label is stored under in `patchLabels`. */
export const drumZoneId = (drumId: string): string => `drum:${drumId}`;

/** Id for a physical output, carrying its `OutputConfig.id` for round-trip. */
export function outputNodeId(outputId: string): string {
  return OUTPUT_PREFIX + outputId;
}

/** Recover an output's `OutputConfig.id` from its id; null if not an output. */
export function parseOutputNodeId(id: string): string | null {
  return id.startsWith(OUTPUT_PREFIX) ? id.slice(OUTPUT_PREFIX.length) : null;
}

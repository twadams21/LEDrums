/* Patch flow-node id grammar — the ONE module that mints or reads `<kind>[:<payload>]`
   node ids for the Patch Graph. Encoders here are the only place ids are built;
   `parsePatchNodeId` is the only decoder (total: every string maps to a `PatchNodeRef`,
   unrecognised ids to `kind: 'unknown'` rather than posing as anything else).

   Three defensive rules, each matching the behaviour of the parsers this module replaces:

   1. REJOIN — for `drum:` / `trigger:`, a drum id containing ':' survives
      (`parts.slice(1).join(':')`).
   2. HOOP — `hoop:<drumId>:<n>`: the hoop index is the LAST segment parsed as a finite
      number, with the drum id rejoined from the middle; anything else is `unknown`.
   3. OUTPUT — `output:` is a PREFIX CLAIM, never a split: the payload is EVERYTHING after
      the first colon. Load-bearing: core's `reconcileOutputs` mints `OutputConfig.id`
      values that are THEMSELVES `output:<n>` (see kit-schema.ts), so shipping flow-node
      ids are the double-prefixed `output:output:<n>` — a split-based decode would return
      `'output'` for every reconciled port and mis-key routing in the COMMON case.

   There is no `zone:` kind: nothing mints per-zone node ids since the v1 topology
   builder was deleted and the zone Inspector arm was retired (11-decisions.md #5) —
   a `zone:` id decodes as `unknown`. A per-zone node returns with its caller if ever. */

import type { HoopRef } from './patch-routing';

// --- singleton node ids -------------------------------------------------------------
export const INPUT_ID = 'input';
export const CONTROLLER_ID = 'controller';
export const KIT_ID = 'kit';
export const TRIGGERS_ID = 'triggers';

// --- encoders -----------------------------------------------------------------------

/** Flow-node id for a hoop ref. Both `HoopRef.hoop` and the node id are 1-based (A1). */
export function hoopNodeId(ref: HoopRef): string {
  return `hoop:${ref.drumId}:${ref.hoop}`;
}

/** Flow-node id for a physical output, carrying its `OutputConfig.id` for round-trip. */
export function outputNodeId(outputId: string): string {
  return `output:${outputId}`;
}

/** Flow-node id for a drum sub-zone (also its Inspector selection id → the drum editor). */
export const drumNodeId = (drumId: string): string => `drum:${drumId}`;

/** Flow-node id for a trigger node. */
export const triggerNodeId = (drumId: string): string => `trigger:${drumId}`;

// --- the total decoder --------------------------------------------------------------

/** A decoded Patch flow-node id. Discriminated on `kind`; `unknown` carries the raw id. */
export type PatchNodeRef =
  | { kind: 'input' }
  | { kind: 'controller' }
  | { kind: 'kit' }
  | { kind: 'triggers' }
  | { kind: 'trigger'; drumId: string }
  | { kind: 'drum'; drumId: string }
  | { kind: 'hoop'; drumId: string; hoop: number }
  | { kind: 'output'; outputId: string }
  | { kind: 'unknown'; id: string };

const OUTPUT_PREFIX = 'output:';

/** Decode any string into a {@link PatchNodeRef} (total — never throws, never guesses). */
export function parsePatchNodeId(id: string): PatchNodeRef {
  if (id === INPUT_ID) return { kind: 'input' };
  if (id === CONTROLLER_ID) return { kind: 'controller' };
  if (id === KIT_ID) return { kind: 'kit' };
  if (id === TRIGGERS_ID) return { kind: 'triggers' };

  // Rule 2 (HOOP): last segment is the 1-based index; middle rejoins to the drum id.
  if (id.startsWith('hoop:')) {
    const parts = id.split(':');
    if (parts.length >= 3) {
      const n = Number(parts[parts.length - 1]);
      const drumId = parts.slice(1, -1).join(':');
      if (Number.isFinite(n) && drumId) return { kind: 'hoop', drumId, hoop: n };
    }
    return { kind: 'unknown', id };
  }

  // Rule 3 (OUTPUT): prefix claim — the payload is everything after the FIRST colon.
  if (id.startsWith(OUTPUT_PREFIX)) {
    return { kind: 'output', outputId: id.slice(OUTPUT_PREFIX.length) };
  }

  // Rule 1 (REJOIN) for the remaining `<kind>:<drumId>` shapes.
  const parts = id.split(':');
  switch (parts[0]) {
    case 'trigger': {
      const drumId = parts.slice(1).join(':');
      return drumId ? { kind: 'trigger', drumId } : { kind: 'unknown', id };
    }
    case 'drum': {
      const drumId = parts.slice(1).join(':');
      return drumId ? { kind: 'drum', drumId } : { kind: 'unknown', id };
    }
    default:
      return { kind: 'unknown', id };
  }
}

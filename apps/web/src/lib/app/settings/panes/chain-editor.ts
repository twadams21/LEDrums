/* Pure reducers for the Outputs & Chains pane (S4c) — the settings-form replacement for
   the Patch canvas' drag-wiring. Every edit gesture (add from the pool, remove back to the
   pool, reorder) produces the NEXT `PatchRouting` immutably; the pane compiles the result
   through `patchToOutputs` and commits via `store.setRouting`, gated by core's ONE
   routing-validation seam (`checkRoutingIntegrity` / `blockingRoutingIssues`).

   The pool model makes hoop fan-out unrepresentable by construction: a hoop can only be
   added from the unassigned pool, so it is in at most one chain — the list-editor twin of
   the canvas' single-upstream wiring rule. `chainBlockers` is still called on every commit
   as the backstop (same predicate the server write-gate enforces).

   No Svelte / DOM here — unit-tested in chain-editor.test.ts. */

import {
  blockingRoutingIssues,
  checkRoutingIntegrity,
  drumHoopCount,
  introducedBlockingIssues,
  type KitConfig,
  type RoutingIssue,
} from '@ledrums/core';
import { patchToOutputs, type HoopRef, type PatchRouting } from '../../patch-routing';

/** Identity key for a physical hoop — matches core's `drumId#hoop` claim key. */
export const hoopKey = (h: HoopRef): string => `${h.drumId}#${h.hoop}`;

/** Every kit hoop carried on NO chain, in rig order (drum → 1-based hoop) — the
    "unassigned pool" that feeds the add-hoop picker and the warning chips. */
export function unassignedHoops(kit: KitConfig, routing: PatchRouting): HoopRef[] {
  const assigned = new Set(routing.outputs.flatMap((o) => o.hoops.map(hoopKey)));
  const pool: HoopRef[] = [];
  for (const drum of kit.drums) {
    const count = drumHoopCount(kit, drum);
    for (let hoop = 1; hoop <= count; hoop++) {
      if (!assigned.has(hoopKey({ drumId: drum.id, hoop }))) pool.push({ drumId: drum.id, hoop });
    }
  }
  return pool;
}

/** Append `hoop` to the END of `outputId`'s chain. A hoop already on ANY chain is a no-op
    (returns `routing` unchanged) — the pool feed makes this unreachable from the UI, but the
    reducer holds the single-upstream invariant on its own. */
export function addHoop(routing: PatchRouting, outputId: string, hoop: HoopRef): PatchRouting {
  const key = hoopKey(hoop);
  if (routing.outputs.some((o) => o.hoops.some((h) => hoopKey(h) === key))) return routing;
  return {
    outputs: routing.outputs.map((o) => (o.id === outputId ? { ...o, hoops: [...o.hoops, hoop] } : o)),
  };
}

/** Remove the hoop at `index` from `outputId`'s chain (it returns to the pool by
    derivation). An unknown output or out-of-range index is a no-op. */
export function removeHoop(routing: PatchRouting, outputId: string, index: number): PatchRouting {
  return {
    outputs: routing.outputs.map((o) =>
      o.id === outputId && index >= 0 && index < o.hoops.length
        ? { ...o, hoops: o.hoops.filter((_, i) => i !== index) }
        : o,
    ),
  };
}

/** Move the hoop at `from` to rest at index `to` within `outputId`'s chain (`to` is the
    FINAL index, clamped to the list). Out-of-range `from` or a no-motion move is a no-op. */
export function moveHoop(routing: PatchRouting, outputId: string, from: number, to: number): PatchRouting {
  return {
    outputs: routing.outputs.map((o) => {
      if (o.id !== outputId || from < 0 || from >= o.hoops.length) return o;
      const target = Math.max(0, Math.min(o.hoops.length - 1, to));
      if (target === from) return o;
      const hoops = [...o.hoops];
      const [moved] = hoops.splice(from, 1);
      hoops.splice(target, 0, moved!);
      return { ...o, hoops };
    }),
  };
}

/** Convert a drag-drop GAP index (0..len, from `gapIndexAt`) into the FINAL index the row
    dragged from `from` should rest at — accounting for the source row's own removal. */
export function gapToIndex(from: number, gap: number): number {
  return gap > from ? gap - 1 : gap;
}

/** Insert `hoop` into `outputId`'s chain at `index` (clamped to the ends). A hoop already on
    ANY chain is a no-op — the same single-upstream invariant `addHoop` holds. */
export function insertHoop(routing: PatchRouting, outputId: string, hoop: HoopRef, index: number): PatchRouting {
  const key = hoopKey(hoop);
  if (routing.outputs.some((o) => o.hoops.some((h) => hoopKey(h) === key))) return routing;
  return {
    outputs: routing.outputs.map((o) => {
      if (o.id !== outputId) return o;
      const at = Math.max(0, Math.min(o.hoops.length, index));
      const hoops = [...o.hoops];
      hoops.splice(at, 0, hoop);
      return { ...o, hoops };
    }),
  };
}

/** What is being dragged: a hoop, and where it came from — a chain position, or `null` for
    the unassigned pool. */
export interface HoopDrag {
  hoop: HoopRef;
  from: { outputId: string; index: number } | null;
}

/** Where it was released: into a chain at a gap index (0..len), or back to the pool. */
export type HoopDropTarget = { kind: 'chain'; outputId: string; gap: number } | { kind: 'pool' };

/**
 * The routing a completed hoop drag produces — the ONE reducer behind every drop, so
 * assigning from the pool, moving between outputs, reordering within a chain and dragging
 * back to the pool are all the same mutation path the buttons and the picker already use.
 *
 * A hoop leaves its old chain before it joins the new one, so the single-upstream invariant
 * holds mid-gesture as well as after it: a drop can never fan a hoop out across two outputs.
 */
export function dropHoop(routing: PatchRouting, drag: HoopDrag, target: HoopDropTarget): PatchRouting {
  if (target.kind === 'pool') {
    return drag.from ? removeHoop(routing, drag.from.outputId, drag.from.index) : routing;
  }
  if (drag.from?.outputId === target.outputId) {
    return moveHoop(routing, target.outputId, drag.from.index, gapToIndex(drag.from.index, target.gap));
  }
  const detached = drag.from ? removeHoop(routing, drag.from.outputId, drag.from.index) : routing;
  return insertHoop(detached, target.outputId, drag.hoop, target.gap);
}

/** The blocking (`error`-severity) issues a routing would hit at the server write-gate —
    core's ONE validation seam, compiled through the same `patchToOutputs` the commit uses.
    Empty = safe to commit (warnings like `hoop-uncovered` ride the pool indicators instead). */
export function chainBlockers(kit: KitConfig, routing: PatchRouting): RoutingIssue[] {
  return blockingRoutingIssues(checkRoutingIntegrity(kit, patchToOutputs(routing)));
}

/** The blockers `next` would INTRODUCE over the committed `current` routing — DELTA
    validation for the commit gate, delegated to core's `introducedBlockingIssues` (the same
    predicate the server `setKitOutputs` write-gate runs, so client and server can't drift).
    A routing can already be damaged without any chain edit (e.g. the kit's hoopCount shrunk
    while hoops were routed); an edit that only removes or carries existing blockers commits
    (repair converges), an edit adding a NEW blocker class/location is refused. */
export function newBlockers(kit: KitConfig, current: PatchRouting, next: PatchRouting): RoutingIssue[] {
  return introducedBlockingIssues(
    checkRoutingIntegrity(kit, patchToOutputs(current)),
    checkRoutingIntegrity(kit, patchToOutputs(next)),
  );
}

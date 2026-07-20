# Spec: Patch graph → static outputs, no destructive edits (resolves #112 gap)

**Date:** 2026-07-20 · **Status:** ready-to-slice · **Resolves:** the remaining gap in #112
(the reframing landed in the `patch-graph-v2` merge, PR #133).

## Problem (grounded)

The drummer's Mac shows **3 outputs in expanded mode** (should be 8) and pressing **Delete**
freezes the app. Root cause: the Patch graph renders the **stored** `kit.outputs` array, which
can drift from the canonical count because output/data-line nodes are freely deletable.

- **Delete path:** `PatchGraphView.svelte:252 onDelete` → `commitRouting`. SvelteFlow's
  Delete/Backspace key removes an edge; `routingFromGraph` then drops the whole dangling tail
  past the cut. Deleting the output-rooted wire strips that output out of `kit.outputs` →
  8 → 3. The result is persisted server-side (`apps/server/src/projects.ts`,
  `projects/<name>.local`), so it survives restarts — this is why his rig is stuck at 3.
- **Freeze:** the same Delete keypath (the "freezes like in the past" symptom).
- **Canonical count already exists:** `logicalOutputCount(kit)` = `expanded ? 8 : 4`
  (`packages/core/src/geometry/kit-schema.ts:483`). The `expanded` toggle already lives on the
  Controller inspector (`PatchControllerInspector.svelte:156`, writes `store.setKitGlobal`).
  What's missing: nothing forces `kit.outputs.length` to **equal** that count.

## Decision (locked with Trent, 2026-07-20)

The Patch graph is a **mostly-static rig shape**, set once. We do **not** need create-node or
delete-node. Hoops, drums, triggers, and zones are a fixed set; zones stay configurable;
**outputs are fixed at 4 (normal) or 8 (expanded), driven solely by the controller
normal/expanded toggle.** Making the config static makes it far less likely to break the app.

## Changes

### 1. Output count is derived, not editable
The output half of the graph renders exactly `logicalOutputCount(kit)` output nodes. The
`expanded` toggle is the **only** control that changes the count. Remove the "add Output / add
Data Line" palette affordance from the Patch graph (create-node not needed anywhere in Patch).

### 2. Disable destructive edits (kills the freeze)
Stop the Delete/Backspace keypath in the Patch graph: drop the `onDelete` prop and set
SvelteFlow's `deleteKeyCode` to `null` for the patch `GraphCanvas` (trigger graph unaffected).
Node deletion of the output half is likewise removed. Wire **rewiring** (reconnect) of the
hoop→output chain may stay if still wanted, but it must never change output *count*.

### 3. Reconcile helper (self-heals the drift) — pure core
Add `reconcileOutputs(kit): KitConfig` in `packages/core/src/geometry/kit-schema.ts`:
grow/shrink `kit.outputs` to `logicalOutputCount(kit)` — preserve existing outputs in order,
append default outputs when growing, trim extras when shrinking. Deterministic, pure, unit-tested
(3→8 grow, 8→4 shrink, 4→4 identity, empty→4).

Invoke it:
- **On the `expanded` toggle** (`setKitGlobal({ expanded })`) in `packages/core` engine +
  server apply path, so flipping the mode immediately yields 4 or 8 outputs.
- **Defensively on project load** (`apps/server/src/projects.ts` read), so any already-corrupted
  saved project (the drummer's 3-output file) **self-heals to 8 on next boot** with no manual
  surgery.

### 4. Repair verification
After #3 ships, confirm the drummer's `projects/<name>.local` loads back to 8 outputs in
expanded mode (server log / Monitor). No hand-editing of his file required — load-time reconcile
does it.

## Out of scope
- Trigger-graph delete (that graph keeps create/delete).
- The MIDI transport question (separate ticket — server-side CoreMIDI live-diagnosis).

## Touch list
- `packages/core/src/geometry/kit-schema.ts` — `reconcileOutputs` + tests.
- `packages/core/src/engine/engine.ts` (`setKitGlobal`) — reconcile on `expanded` flip.
- `apps/server/src/input-router.ts` / `handlers/voice-input.ts` — server apply reconcile.
- `apps/server/src/projects.ts` — reconcile on load.
- `apps/web/src/lib/app/views/PatchGraphView.svelte` — drop `onDelete`, `deleteKeyCode: null`,
  remove output/data-line palette add.
- UI touch → apply `/make-interfaces-feel-better` + `pnpm ui-shot` on the Patch surface.

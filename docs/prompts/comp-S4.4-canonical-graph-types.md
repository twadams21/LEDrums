# Component pass S4.4 — Core-canonical graph types

PRD §A4. Overlay PR **#22** (architecturally significant). Branch base `feat/unified-shell` (worktree — read
`_worktree-note.md`). **DECISION D2 = LOCKED → Option A (CORE-CANONICAL).** **Depends on S3.3** (sim split)
so the type re-point lands on the slimmer modules. Independent worktree otherwise.

**Blocked by:** S3.3 (sim split) — re-point the graph types on the slimmer sim modules.

## What this delivers
Ends the web⇄core model duplication: `apps/web/.../sim.ts` currently re-declares core's `GraphNode` /
`GraphEdge` / `TriggerGraph` / `TriggerSource` byte-for-byte (kept aligned only by structural typing). Per
D2, the canonical definitions live in **`packages/core/voice/types.ts`** and the web imports them
**type-only**; **core stays pure** (these are types, no runtime/IO).

## Scope
- `packages/core/src/voice/types.ts` — confirm it exports the canonical `GraphNode`/`GraphEdge`/
  `TriggerGraph`/`TriggerSource` (+ related unions: `SwitchOn`, `ValueMode`, etc.). Add any web-only field
  the web variant carried, if it belongs in the shared model (note any that should NOT move).
- `apps/web/src/lib/trigger-lab/sim.ts` (+ the modules S3.3 extracted) — delete the local re-declarations and
  `import type { GraphNode, GraphEdge, TriggerGraph, TriggerSource } from '@ledrums/core/...'` (use the
  package's existing import path/namespace). Type-only imports — no runtime dependency added.
- Re-point any other web file that imported the local copies (`git grep` the type names under `apps/web`).
- This is the web⇄**core** *model* boundary — distinct from S4.3 (the web⇄server WS *protocol* boundary).
  Do not merge the two.

## Tests
- All web sim/store tests + core voice tests green untouched (structural identity means zero behaviour
  change). Typecheck is the real proof here — it must stay 0 with the types now sourced from core.

## Gate discipline
Per-package typecheck/test; full `pnpm typecheck && pnpm test`. Confirm `packages/core` still imports nothing
from Node/DOM/IO (types-only addition keeps it pure).

## Acceptance
Web sim no longer re-declares the graph types; it imports them type-only from `packages/core`; core pure;
typecheck 0; full sweep green. Closes #22.

## Report back
Report to parent (orchestrator) with commit SHA, types removed from web + now sourced from core, any field
that had to move (or stay), gate totals, deviations. Leave ROUTER to the orchestrator.

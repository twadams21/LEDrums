# Component pass S3.1 — Split Inspector.svelte into per-kind editors

PRD §S3.1. Overlay PR **#8** (exact match). Branch base `feat/unified-shell` (worktree — read
`_worktree-note.md`). **Depends on S1.1 (CommitInput) + S1.3 (form-options).** Owns
`lib/app/docks/Inspector.svelte` — nothing else touches it, so conflict-free in its own worktree.
**API-preserving refactor — no behaviour change.**

**Blocked by:** S1.1 (CommitInput) + S1.3 (form-options). Owns `Inspector.svelte` alone → conflict-free.

## What this delivers
The single biggest live file (`Inspector.svelte`, 1359) — a ~12-branch if/else over every selection kind —
becomes a thin container (~200 lines) dispatching to focused per-kind editor sub-components, each adopting
the right `lib/ui` primitives.

## Scope (`apps/web/src/lib/app/docks/`)
- Extract these sub-components under `inspectors/` (sizes approximate, from the explorer map):
  `TriggerSourceInspector` · `PlayNodeInspector` · `ContainerNodeInspector` (random/switch/chance/all/
  sequence/toggle) · `BusInspector` · `PatchZoneInspector` · `PatchDrumInspector` · `PatchHoopInspector` ·
  `PatchDataLineInspector` · `PatchOutputInspector` · `PatchControllerInspector` · `SectionInspector`.
- `Inspector.svelte` becomes the selection→component dispatcher (header + which-editor logic only).
- Reuse the pure `patch-inspector.ts` helpers (unchanged) + the S1.3 shared form-options. Adopt primitives
  for the hand-rolled controls inside: checkbox → `lib/ui/Toggle`; `.envbtn` → `IconButton`; numeric fields →
  the consolidated `CommitInput`/numeric (S1.1); side-by-side field rows → `lib/ui/Field`.
- Preserve every editor's exact inputs/outputs (the store mutators it calls) — this is structure-only.

## Tests
- `patch-inspector.test.ts` must stay green untouched (it's the contract). Add light per-editor render tests
  if cheap, but do not change behaviour.

## Gate discipline
Per-package typecheck/test; full sweep on commit. **Svelte MCP / svelte-file-editor mandatory.** Tokens only
(replace the ~8 hardcoded px/duration/gap values the explorer flagged with `--space-*`/`--dur-*`).

## Acceptance
Inspector ≤ ~250 lines dispatching to ~11 per-kind editors; every node/patch/section editor behaves exactly
as before; `patch-inspector.test.ts` green; full sweep green. Closes #8. (Live `:5173` spot-check owed.)

## Report back
Report to parent (orchestrator) with commit SHA, the sub-component list + sizes, primitives adopted, gate
totals, owed spot-check, deviations. Leave ROUTER to the orchestrator.

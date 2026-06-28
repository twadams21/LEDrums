# Component pass S2.2 — Object/Section views adopt primitives + shrink

PRD §S2.2. Branch base `feat/unified-shell` (worktree — read `_worktree-note.md`). **Depends on Wave B**
(S1.2 EditableRow, S1.3 form-options, S1.5 MasterDetail). **PR mapping:** S2 adoption. Owns
`lib/app/views/{SectionsView,ObjectsView,PerformView}.svelte` — disjoint from S2.1 (chrome) and S2.3
(graph views).

**Blocked by:** S1.2, S1.3, S1.5 (the primitives it adopts). File-disjoint from S2.1 + S2.3 → parallel.

## What this delivers
The two big CRUD views (SectionsView 535, ObjectsView 508) adopt `MasterDetail` + `EditableRow` and extract
their row sub-components, collapsing each toward ~150–300 lines while keeping behaviour identical.

## Scope
- `ObjectsView.svelte` — wrap in `lib/ui/MasterDetail` (type rail = master, detail = the selected type's
  rows). Replace the four near-identical per-type row renders (Songs/Effects/Graphs/Presets) with
  `EditableRow` + small per-type row components (`SongRow`/`EffectRow`/`GraphRow`/`PresetRow`, co-located).
  Preserve per-type CRUD/context-menu wiring + preset delete-gating (`objects-view.ts` helpers unchanged).
- `SectionsView.svelte` — adopt `MasterDetail` (section columns = master, graph list = detail) + `EditableRow`
  for section header + graph rows. Extract the graph-picker drawer into a `GraphPickerDrawer` sub-component.
  Keep copy/paste/duplicate/remove wiring. NB the prior CRUD initiative split section-header vs graph-row
  ownership — keep both reachable.
- `PerformView.svelte` — the section-recall `.chip` buttons → `SegmentedControl` or a pill button; drop the
  bespoke oklch-mix chip styling.
- Use the shared form-options/formatters from S1.3 where these views format node/source labels.

## Tests
- Keep `objects-view.test.ts` green (helpers unchanged). Add coverage only where row wiring moved. Behaviour
  parity is the bar.

## Gate discipline
Per-package typecheck/test; full sweep on commit. **Svelte MCP / svelte-file-editor mandatory.** Tokens only.

## Acceptance
Both views render via `MasterDetail`+`EditableRow`; per-type/section CRUD + delete-gating intact; each big
view materially shorter; full sweep green. (Live `:5173` spot-check owed — flag it.)

## Report back
Report to parent (orchestrator) with commit SHA, files changed + new row sub-components, before/after line
counts, gate totals, the owed spot-check, deviations. Leave ROUTER to the orchestrator.

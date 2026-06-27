# Component pass S1.3 — Shared view form-options + formatters

PRD §A2 (componentise). Overlay PR **#15**. Branch base `feat/unified-shell` (worktree — read
`_worktree-note.md`). **Foundation slice.** Runs AFTER **S0.2** (the lab's `NodeCanvas` — one of the two
dup sources — is deleted there), so extract from the live remainder.

## What this delivers
A single home for the option lists + value formatters that were duplicated between `Inspector.svelte` and
the (now-deleted) lab `NodeCanvas.svelte`: play-mode / layer / switch-mode `SegmentedControl` option arrays
(`MODE_OPTS` / `SWITCH_OPTS` and the iconed variants) and the small numeric/label `fmt` helpers. Centralizing
them means the Inspector split (S3.1) and the views consume one source.

## Scope (new shared module)
- Create `apps/web/src/lib/app/views/node-options.ts` (or `lib/trigger-lab/node-options.ts` — co-locate with
  `trigger-node-meta.ts`; your call, documented) exporting the option arrays + formatters as pure consts/fns.
- Repoint `Inspector.svelte` (and `trigger-node-meta.ts` / `TriggerNode.svelte` where they re-derive the same
  labels) to import from the new module. Do not change behaviour — same options, same order, same labels.
- Keep this PURE (no Svelte) so it's unit-testable and importable anywhere.

## Tests
- Unit test the formatters + assert the option arrays match what the Inspector/segmented-controls expect
  (kinds, icons, order).

## Gate discipline
Per-package typecheck/test; full sweep on commit. Pure TS (no `.svelte` here unless repointing markup).

## Acceptance
One module owns the node form-options + formatters; Inspector + node meta import it; no duplicated arrays;
full sweep green. Closes #15. (Eases the S3.1 Inspector split.)

## Report back
Report to parent (orchestrator) with commit SHA, the module's exports, call-sites repointed, gate totals,
deviations. Leave ROUTER to the orchestrator.

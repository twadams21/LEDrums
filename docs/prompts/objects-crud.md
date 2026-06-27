# Objects CRUD backfill — effects + presets (rename/duplicate; delete only unused presets)

PRD: `docs/plans/2026-06-27-recall-objects-persistence-prd.md`. Branch base
`feat/unified-shell` (worktree — read `docs/prompts/_worktree-note.md`). Wave 1. Shares
`store.svelte.ts` (effects/presets region) with `graphs-generic` (graph region — disjoint
methods). Keep additions localized.

## Locked decisions (from Trent)
- **Effects are NOT deletable** (foundational). Add **rename + duplicate** only.
- **Presets: rename + duplicate; DELETE only when the preset is used nowhere** (usage
  count == 0). In-use presets refuse deletion.
- No blank "create preset from scratch" — **duplicate** an existing preset covers it.

## What this delivers (store API; the Objects view consumes it next)
- `store.renameEffect(id, name)` — update the `EffectDef` name; persists.
- `store.duplicateEffect(id)` — clone the `EffectDef` under a fresh id, register with the
  sim, seed its `${newId}:default` preset; return the new id; persists. (Mirror `createEffect`.)
- `store.renamePreset(id, name)` — update the `Preset` name; persists.
- `store.duplicatePreset(id)` — clone the `Preset` under a fresh id, `"<name> copy"`,
  register; return the new id; persists.
- `store.presetUsageCount(id)` — pure: how many play nodes (across all graphs) reference
  the preset (linked or instance-origin). Used to gate deletion + shown in the Objects view.
- `store.deletePreset(id)` — **only if `presetUsageCount(id) === 0`**; remove from
  `presets[]` + the sim registry; no-op (return false) when in use or built-in `:default`
  for a live effect. Persists.

## Scope
- `apps/web/src/lib/trigger-lab/store.svelte.ts` — the 6 methods above, placed near the
  existing `createEffect`/preset methods.
- `apps/web/src/lib/trigger-lab/sim.ts` — add `unregisterEffect`/preset unregister if a
  clean sim deregistration is needed for duplicate/delete (only what's required; effects
  aren't deletable so no effect-unregister needed).
- Tests: a new `store.objects.test.ts` — effect rename/duplicate (new id, default preset
  seeded); preset rename/duplicate; `presetUsageCount` correctness; `deletePreset` removes
  when unused, refuses when in use; persists.

## Gate discipline
Per-package typecheck/test during work; full `pnpm typecheck && pnpm test` on the committed
tree.

## Acceptance
Effects rename/duplicate (no delete); presets rename/duplicate + delete-only-when-unused
via `presetUsageCount`; all persist; full sweep green. (Live spot-check owed.)

## Report back
Parent with commit SHA(s), the new store API, gate totals, deviations. Commit before reporting; ROUTER to orchestrator.

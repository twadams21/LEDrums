# Component pass S1.1 — Consolidate CommitInput + numeric field

PRD §S1.1. Overlay PR **#16**. Branch base `feat/unified-shell` (worktree — read `_worktree-note.md`).
**Foundation slice (additive-ish); land before the adoption slices.**

## What this delivers
One canonical inline-edit primitive. Today there are TWO divergent `CommitInput`s:
- `lib/ui/CommitInput.svelte` (89) — text inline-rename: commit on Enter/blur, revert on Esc, autofocus+select.
- `lib/app/docks/CommitInput.svelte` (120) — numeric: min/max clamp, unit suffix, commit-on-blur.
This merges them so every inline-edit site shares one component (and one feel).

## Scope
- `apps/web/src/lib/ui/CommitInput.svelte` — extend to support a **`type: 'text' | 'number'`** prop with the
  numeric extras (`min`/`max`/`step`/`suffix`, clamp on commit) folded in; keep the text behaviour (Esc
  revert, autofocus+select) as the default. Preserve the existing text-mode public props so current callers
  don't break. (If a single component gets unwieldy, instead keep `CommitInput` text-only and add a sibling
  `NumericField.svelte` sharing the commit/revert core — your call; one of the two, documented.)
- Delete `apps/web/src/lib/app/docks/CommitInput.svelte`; repoint its importer(s) (the Inspector numeric
  fields — `git grep "docks/CommitInput"`) to the consolidated primitive.
- Keep all styling on tokens; no hardcoded padding (the old one used `6px 8px` → `--space-1`).

## Tests
- A focused component/unit test (or extend an existing one) for: text commit-on-Enter, revert-on-Esc,
  numeric clamp to min/max, suffix render. Match the repo's `.svelte` test approach.

## Gate discipline
Per-package typecheck/test; full `pnpm typecheck && pnpm test` on the committed tree. **Svelte MCP /
svelte-file-editor mandatory** for `.svelte`. Reuse tokens.

## Acceptance
One inline-edit primitive (text + number) under `lib/ui`; the docks copy gone; Inspector numeric fields
still clamp/suffix correctly; rename sites still revert on Esc; full sweep green. Closes #16.

## Report back
Report to parent (orchestrator) with commit SHA, the final primitive API (props), files changed, gate
totals, deviations. Leave ROUTER to the orchestrator.

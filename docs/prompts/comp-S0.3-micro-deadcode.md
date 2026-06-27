# Component pass S0.3 — Micro dead-code cleanup

PRD §S0.3. Branch base `feat/unified-shell` (worktree — read `_worktree-note.md`). **PR mapping:** PRD
finding. **Independent worktree.** Small, surgical removals only — verify each with a grep before deleting.

**Blocked by:** none — can start immediately.

## What this delivers
Removes a handful of grep-confirmed unused exports/params and verifies-then-prunes underused tokens.

## Scope (verify each with a reference grep first; if any live caller appears, SKIP + note it)
- *(Note: the unused `store.svelte.ts` export `makeBlock` is removed by **S3.2**, not here — that slice
  owns `store.svelte.ts`, so folding it there avoids a same-wave edit collision.)*
- `apps/server/src/ws-protocol.ts` — remove **`encodeClient`** (only used by its own test; drop or fold the
  test assertion). Symmetry-only export.
- `apps/server/src/show-library.ts` — remove **`showLibraryExists`** (test-only).
- `apps/server/src/output-manager.ts` — drop the unused **`rgbOrder`** param on `blackout()` (and its
  `void rgbOrder;` line); update the one caller.
- `apps/web/src/styles/tokens.css` — **verify-then-prune** underused tokens flagged by the styleguide
  explorer: `--ink-on-accent`, `--ease-out-expo`, `--ease-out-quint`, `--leading-tight`, `--leading-normal`,
  `--tracking-tight`. For EACH, `git grep "var(--<name>)"` across `apps/web/src`; remove only if 0 live
  uses. Leave `--reactive-tint`/`--reactive-amount` (runtime feature). **Do NOT** touch the migration-alias
  tokens here — those belong to S4.1.

## Gate discipline
Per-package typecheck/test during work; full `pnpm typecheck && pnpm test` on the committed clean tree.

## Acceptance
Each removal grep-justified; build + tests green; a short note listing what was removed vs. skipped (and
why) for each item.

## Report back
Report to parent (orchestrator) with commit SHA, removals (with the grep evidence per item), gate totals,
anything skipped. Leave ROUTER to the orchestrator.

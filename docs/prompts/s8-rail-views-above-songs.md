# S8 — Left rail: Views above Songs

Small UI reorder on the unified shell (`docs/prompts/patch-graph-authoritative.md` for context). Branch `feat/unified-shell`. **Web-only, scoped to the left rail chrome — do not touch the Patch graph, Inspector, store model, or any other view.**

## Goal
In the Author shell's left rail, the **Views** section (the view rail: Trigger / Patch / Sections / Kit) should sit **above** the **Songs** section. Today Songs is above Views — swap them.

## Where
- `apps/web/src/lib/app/chrome/LeftRail.svelte` and/or `SongRail.svelte` (whichever composes the rail's vertical order). Find where the Views list and the Songs list are stacked and swap their order. Keep all behaviour, styling, and collapse/resize affordances identical — this is purely the vertical order.
- Use the **Svelte MCP / `svelte:svelte-file-editor`** for the `.svelte` edit; run the autofixer clean.

## Acceptance
- `pnpm --filter @ledrums/web typecheck` + `test` green; autofixer clean on the edited component.
- Visual order in the Author rail is Views (top) → Songs (below). No other change.

## Report back
Report to parent (`twux send-message --session parent`) with the commit SHA, the file(s) touched, and gate output. **Commit on `feat/unified-shell` before reporting.**

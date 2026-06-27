# Component pass S0.2 — Retire the trigger-lab probe

PRD §S0.2. Overlay PR **#17 + #18** (resolved by this deletion). Branch base `feat/unified-shell`
(worktree — read `_worktree-note.md`). **DECISION D1 = GO** (Trent confirmed the trigger-model branches
are settled). **Independent worktree.**

**Blocked by:** none — can start immediately.

## What this delivers
Removes the throwaway `?proto=trigger` model lab (~1,667 lines). The lab was the model probe kept only
while the trigger-model branches were undecided; they're now settled, so it goes. **The live brain stays** —
`store.svelte.ts`, `sim.ts`, `persistence.ts`, `fixtures.ts`, etc. are `LIVE-APP` and must NOT be touched.

## Scope
- Delete `apps/web/src/lib/trigger-lab/NodeCanvas.svelte` (954) and `apps/web/src/lib/trigger-lab/TriggerLab.svelte` (713).
- `apps/web/src/main.ts` — remove the `else if (params.get('proto') === 'trigger') { … }` lazy-mount branch
  (and its dynamic import of `TriggerLab.svelte`). Keep the `?style` branch and the default `App` mount.
- `git grep "NodeCanvas\|trigger-lab/TriggerLab"` to confirm nothing else references them. The shared
  graph-node metadata that #17 wanted to consolidate lived inside `NodeCanvas` — deleting it resolves #17;
  the only live remnant is `LayersDock`'s `busIcon` helper, which is handled in **S2.3** (not here).
- Do **not** remove any other `trigger-lab/*` file — they're the live store/sim/effect-UI.

## Gate discipline
Full `pnpm typecheck && pnpm test` on a clean tree (no live tests reference the lab; counts unchanged).
Svelte MCP not needed (deletions only).

## Acceptance
Both lab files gone; `?proto=trigger` route removed from `main.ts`; typecheck 0; tests green; live `App`
and `?style` routes unaffected.

## Report back
Report to parent (orchestrator) with commit SHA, files deleted, lines removed, gate totals, confirmation
that `main.ts` still mounts App + styleguide. Leave ROUTER to the orchestrator.

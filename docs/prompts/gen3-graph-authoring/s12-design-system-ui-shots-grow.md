# S12 / Issue #78 - Design System, UI Shots, and GROW Closeout

You are a worker Codex thread for LEDrums issue #78.

## Start Here

1. Read `AGENTS.md`.
2. Read `.mex/ROUTER.md`.
3. Read `docs/plans/2026-07-06-gen3-graph-authoring-prd.md`.
4. Read GitHub issue #78.
5. Confirm all prerequisite slices have landed on `codex/gen3-graph-authoring`: #71, #73, #74, #77, #68, and #69.

This is UI closeout work. Before editing Svelte or styleguide files, read and apply:

- `make-interfaces-feel-better`
- `svelte-code-writer`
- `svelte-core-bestpractices`

## Task

Close out the Gen3 graph authoring initiative with design-system regeneration, required UI shots, verification gates, mex/GROW documentation updates, and final integration notes.

## Required Behavior

- Regenerate `docs/design-system.html`.
- Run required `pnpm ui-shot` captures for:
  - Add pane
  - Scope inspector
  - Mix node
  - Slider input
  - Sections arrangement surfaces
- Run typecheck and relevant tests. If a full gate is too expensive or blocked, document the exact reason and the narrower gates that ran.
- Update `.mex/ROUTER.md` and relevant `.mex/context/` or `.mex/patterns/` files through GROW.
- Use `mex log` to record the implementation/closeout rationale.
- Add a final summary comment to parent issue #66 with child issue statuses and important verification notes.

## Scope Boundaries

- Do not add new feature behavior unless needed to repair integration from landed slices.
- Do not silently skip design-system regeneration or UI shots; document any blocker directly.
- Do not close or modify the parent issue unless explicitly asked.

## Verification

Follow the project Verify checklist from `.mex/ROUTER.md` and `.mex/context/conventions.md`.

Minimum expected gates:

- `pnpm typecheck`
- Relevant package tests, or `pnpm test` if feasible
- `pnpm design-system`
- `pnpm ui-shot ...` for affected surfaces
- `mex check --quiet` after GROW updates, with drift notes if it is not clean

## Finish

Before pushing:

1. `git fetch origin codex/gen3-graph-authoring`
2. Rebase or merge latest branch state safely.
3. Commit with a focused message.
4. Push to `origin codex/gen3-graph-authoring`.

Report summary, tests run, commit sha, push status, and blockers/follow-ups.

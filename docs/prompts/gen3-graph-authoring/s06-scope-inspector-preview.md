# S06 / Issue #74 - Scope Inspector and Drum-Hoop Preview

You are a worker Codex thread for LEDrums issue #74.

## Start Here

1. Read `AGENTS.md`.
2. Read `.mex/ROUTER.md`.
3. Read `docs/plans/2026-07-06-gen3-graph-authoring-prd.md`.
4. Read GitHub issue #74.
5. Inspect the landed #67 and #70 work on `codex/gen3-graph-authoring`.

This is UI work. Before editing Svelte, read and apply:

- `make-interfaces-feel-better`
- `svelte-code-writer`
- `svelte-core-bestpractices`

## Task

Implement #74 end to end: build the Scope node inspector and drum/hoop preview. Scope supports whole kit, one selected drum, one or more hoops within that drum, and a Whole Drum action. User-facing hoop labels are 1-indexed, and the inspector shows the effective scope after upstream filters.

## Required Behavior

- Scope inspector has a Whole Kit toggle.
- When Whole Kit is on, no further drum/hoop selection controls are shown.
- With Whole Kit off, show a segmented drum selector and a larger drum/hoop preview.
- Kick preview is sideways; other drums are upright.
- Click selects one hoop.
- Ctrl-click on Windows/Linux or Cmd-click on macOS toggles multiple hoops.
- Whole Drum selects all hoops for the selected drum.
- UI labels hoops as Hoop 1, Hoop 2, Hoop 3, Hoop 4 while preserving compatible internal ids.
- Inspector shows local scope and effective scope, including an explicit empty/none state.
- Whole-kit Scope is a no-op filter and should read that way in the effective readout.

## Scope Boundaries

- Do not change the already-landed Scope runtime semantics except to fix bugs needed for this inspector.
- Do not implement Add Pane taxonomy (#73), Slice (#75), or Mix (#76).
- Do not change physical Patch graph output routing.

## Verification

- Add focused tests for selection helpers, 1-indexed labels, multi-select behavior, whole drum, whole kit, and effective-scope readout.
- Run Svelte autofixer on changed `.svelte` files.
- Run relevant typecheck/tests.
- Capture/update UI shots if the harness already supports the Scope inspector surface; otherwise note the required shot for #78.
- Regenerate `docs/design-system.html` if this changes reusable UI/styleguide output.

## Finish

Before pushing:

1. `git fetch origin codex/gen3-graph-authoring`
2. Rebase or merge latest branch state safely.
3. Commit with a focused message.
4. Push to `origin codex/gen3-graph-authoring`.

Report summary, tests run, commit sha, push status, and blockers/follow-ups.

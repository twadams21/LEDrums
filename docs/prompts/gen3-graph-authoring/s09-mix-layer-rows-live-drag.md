# S09 / Issue #77 - Mix Layer Rows and Live Drag Ordering

You are a worker Codex thread for LEDrums issue #77.

## Start Here

1. Read `AGENTS.md`.
2. Read `.mex/ROUTER.md`.
3. Read `docs/plans/2026-07-06-gen3-graph-authoring-prd.md`.
4. Read GitHub issue #77.
5. Confirm #76 has landed on `codex/gen3-graph-authoring` before editing.

This is UI work. Before editing Svelte, read and apply:

- `make-interfaces-feel-better`
- `svelte-code-writer`
- `svelte-core-bestpractices`

## Task

Implement #77 end to end: render Mix node incoming wires as edge-backed layer rows on the node card and keep their order live while upstream nodes are dragged. Handle centers must align vertically with node card edges.

## Required Behavior

- Each incoming Mix wire has its own visible node-card row and target handle.
- Mix layer identity is edge-backed so reconnect/delete preserves the correct opacity state.
- Rows are sorted by upstream source node y-position with a deterministic tiebreaker.
- Row ordering recomputes live during node drag, not only on drag stop.
- Handles are visually centered on the node edge across standard, param, modulation, and Mix rows.
- The Mix inspector exposes per-input opacity controls if not already handled by #76.

## Scope Boundaries

- Do not implement Mix runtime (#76); this prompt assumes it has landed.
- Do not refactor all graph node rendering unless needed for handle alignment.
- Do not alter Scope runtime or Add Pane taxonomy except for integration compatibility.

## Verification

- Add focused tests for row ordering, edge-backed identity, reconnect/delete behavior, and live drag projection signatures.
- Run Svelte autofixer on changed `.svelte` files.
- Run relevant typecheck/tests.
- Capture/update UI shots if the harness supports Mix node surfaces; otherwise note the required shot for #78.
- Regenerate `docs/design-system.html` if this changes reusable UI/styleguide output.

## Finish

Before pushing:

1. `git fetch origin codex/gen3-graph-authoring`
2. Rebase or merge latest branch state safely.
3. Commit with a focused message.
4. Push to `origin codex/gen3-graph-authoring`.

Report summary, tests run, commit sha, push status, and blockers/follow-ups.

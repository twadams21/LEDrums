# S08 / Issue #76 - Mix Node Buffer Composition

You are a worker Codex thread for LEDrums issue #76.

## Start Here

1. Read `AGENTS.md`.
2. Read `.mex/ROUTER.md`.
3. Read `docs/plans/2026-07-06-gen3-graph-authoring-prd.md`.
4. Read GitHub issue #76.
5. Inspect the landed #67 and #70 graph/runtime work on `codex/gen3-graph-authoring`.

## Task

Implement #76 end to end: add Mix as a buffer-level route composition node. Mix accepts unlimited incoming effect-flow routes, blends upstream rendered buffers using one node blend mode and per-input opacity, then continues downstream.

## Required Behavior

- Mix can receive any number of incoming effect-flow wires.
- Each upstream route renders into an intermediate buffer before Mix composition.
- Mix has one blend mode for the node.
- Each incoming edge has its own opacity.
- Mixed output continues downstream through Scope, Modifier, and Output.
- Input count is not artificially capped.
- Behavior is deterministic for the same graph, time, inputs, and model.

## Scope Boundaries

- Keep `packages/core` pure.
- Do not implement Mix node layer-row UI/live drag ordering (#77), beyond data/model fields required for #76.
- Do not implement Add Pane taxonomy (#73), except minimal metadata if needed to create/test Mix.
- Do not change unrelated blend/compositor behavior unless required by the Mix seam.

## Verification

- Add tests for multiple inputs, blend modes, per-edge opacity, downstream continuation, no input cap, and deterministic ordering.
- Prefer high-seam graph eval/render tests over isolated implementation tests.
- Run relevant core/web tests and typecheck.

## Finish

Before pushing:

1. `git fetch origin codex/gen3-graph-authoring`
2. Rebase or merge latest branch state safely.
3. Commit with a focused message.
4. Push to `origin codex/gen3-graph-authoring`.

Report summary, tests run, commit sha, push status, and blockers/follow-ups.

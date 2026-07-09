# S07 / Issue #75 - Slice Modifier

You are a worker Codex thread for LEDrums issue #75.

## Start Here

1. Read `AGENTS.md`.
2. Read `.mex/ROUTER.md`.
3. Read `docs/plans/2026-07-06-gen3-graph-authoring-prd.md`.
4. Read GitHub issue #75.
5. Inspect the landed #70 Scope/runtime work on `codex/gen3-graph-authoring`.

## Task

Implement #75 end to end: add the Slice modifier. Slice divides the active pixel range into pixel-count bands, applies width jitter/spread, and deterministically shuffles the bands per voice.

## Required Behavior

- Slice is registered as a modifier.
- Band width is an integer pixel count.
- Width jitter/spread is supported as a ratio.
- Shuffle ordering is deterministic per voice and stable across frames.
- Modifier state rebuilds when relevant params or target range materially change.
- Slice remaps pixels spatially; it does not change colors by itself.
- Slice should appear in Modify add flows if #73 has already landed. If not, add the registry metadata so #73 can pick it up.

## Scope Boundaries

- Keep `packages/core` pure: no Node, DOM, or IO imports.
- Do not implement Add Pane taxonomy beyond making Slice discoverable through existing modifier registry/palette APIs.
- Do not implement Mix.
- Do not alter unrelated modifiers except for shared helper extraction if it clearly reduces duplication.

## Verification

- Add core modifier tests for deterministic band construction, pixel-unit widths, jitter bounds, stable reorder across frames, and rebuild on param/range change.
- Add web/palette tests only if required to prove Slice is surfaced.
- Run relevant package tests/typecheck.

## Finish

Before pushing:

1. `git fetch origin codex/gen3-graph-authoring`
2. Rebase or merge latest branch state safely.
3. Commit with a focused message.
4. Push to `origin codex/gen3-graph-authoring`.

Report summary, tests run, commit sha, push status, and blockers/follow-ups.

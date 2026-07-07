# S04 / Issue #73 - Add Node Taxonomy and Node Previews

You are a worker Codex thread for LEDrums issue #73.

## Start Here

1. Read `AGENTS.md`.
2. Read `.mex/ROUTER.md`.
3. Read `docs/plans/2026-07-06-gen3-graph-authoring-prd.md`.
4. Read GitHub issue #73.
5. Inspect the landed `codex/gen3-graph-authoring` branch, especially the completed #67, #71, and #72 changes.

This is UI work. Before editing Svelte, read and apply:

- `make-interfaces-feel-better`
- `svelte-code-writer`
- `svelte-core-bestpractices`

## Task

Implement #73 end to end: populate the Add Node pane with the approved Effect, Route, Modulate, and Modify taxonomy. Stage 2 options should render as actual node-card previews in palette mode with handles hidden, tight descriptions, and meaningful thumbnails/previews.

## Required Behavior

- Stage 1 categories are Effect, Route, Modulate, and Modify.
- Route includes Random, Sequence, Switch, Chance, Toggle, Delay, Scope, and Mix.
- Modulate includes Envelope, LFO, CC, Note, OSC, and Random.
- Modify uses the current modifier groups and includes Slice once available. If Slice has not landed yet, leave a clean integration seam and do not fake runtime behavior.
- Envelope options create Envelope nodes seeded as Pluck, Stab, Swell, Gate, or Custom.
- LFO options create LFO nodes seeded as Sine, Triangle, Saw, Square, or Sample & Hold.
- Palette previews reuse the real node-card visual language with handles hidden.
- Palette previews show icon, title, tight description, and meaningful thumbnail/preview where available.
- Palette previews do not show params, preset subtitle, or Effect type pill.

## Scope Boundaries

- Do not implement Scope inspector UI (#74).
- Do not implement Slice runtime (#75) unless it has already landed.
- Do not implement Mix runtime (#76).
- Keep this slice focused on Add Node taxonomy, preview rendering, and creation presets.

## Verification

- Add or update focused tests for category mapping, reset behavior if touched, click add, drag add, and preset seeding.
- Run Svelte autofixer on changed `.svelte` files.
- Run the narrowest relevant typecheck/test commands.
- Regenerate `docs/design-system.html` if this changes reusable UI/styleguide output.

## Finish

Before pushing:

1. `git fetch origin codex/gen3-graph-authoring`
2. Rebase or merge latest branch state safely.
3. Commit with a focused message.
4. Push to `origin codex/gen3-graph-authoring`.

Report summary, tests run, commit sha, push status, and blockers/follow-ups.

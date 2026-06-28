# Fix — `assertShowIntegrity` must accept authored (non-pad) graph keys

Small core bug fix. You are in a **git worktree** — read `docs/prompts/_worktree-note.md` first. Branch base `feat/unified-shell`.

## The bug
`assertShowIntegrity` (in `packages/core`, called by the web `show-builder.ts buildShow`) validates that every entry in `Show.graphs` is keyed by a `drumId:zone` padKey resolving to a real kit drum. But since U2 (`store.createGraph`) + U3 (direct MIDI/OSC trigger bindings), **authored graphs are keyed `graph:<n>` / `graph-<n>`** — they are fired by their trigger *source* (midi/osc), not bound to a pad. So a **connected** `setShow` carrying any authored graph **throws** (`buildShow` runs only when the WS link is open → authored graphs work offline but break a live server). This blocks the trigger-source payoff (authored graph fired by external MIDI/OSC through the engine).

## The fix
Find `assertShowIntegrity` (search `packages/core` — likely `src/voice/` or `src/model/`). In the loop that validates graph **keys** against kit drums, **skip keys that are not padKeys** (an authored graph key has no `drumId:zone` form / no matching kit drum). Concretely: only run the drumId-resolves-to-a-kit-drum check for keys that parse as `drumId:zone` where `drumId` is a known drum; authored keys (`graph:…`) are valid standalone graphs and must pass. Keep all the OTHER integrity checks intact (slot references, etc.). Do NOT weaken validation for real pad graphs.

## Scope (disjoint — yours)
- The core file defining `assertShowIntegrity` (+ its `.test.ts`).
- **Do NOT** touch web files (a sibling U5 agent is editing `setlist.ts`/`store.svelte.ts`/`SectionsView.svelte` in a separate worktree) or anything outside the integrity check.

## Tests
- A `Show` whose `graphs` contains an authored key (`graph:1`) with a `midi`/`osc` trigger source passes `assertShowIntegrity` (no throw); a genuinely-dangling padKey (`unknownDrum:center`) still throws; existing integrity tests stay green.

## Acceptance
- `assertShowIntegrity` accepts authored graph keys; a connected `setShow` with an authored graph no longer throws. `pnpm --filter @ledrums/core typecheck` + `test` green (run the full sweep on your committed tree).

## Report back
Report to parent with commit SHA + files + gate output + the exact predicate you used to distinguish authored vs pad keys. Commit on your worktree branch (do NOT switch branches). Leave `.mex/ROUTER.md` to the orchestrator.

# Guard duplicate graph keys in section slots (core)

Implementer agent. Small, surgical core fix + test. Branch **`feat/unified-shell`** (checked out).
Report to your parent orchestrator (`--session parent`). No push/PR/merge.

## The bug
`packages/core/src/voice/engine.ts` → `resolveHitGraphs(drumId, zone)` returns one `{ graph,
statePrefix }` per filled slot, using `statePrefix = key` (the graph key). `fireGraph` passes that
prefix into eval, where node state keys are `${prefix}#${nodeId}` (see `nodeStateKey`). If the SAME
graph key is placed in two slots of one drum in the active section, both layers share the same
`statePrefix` → their `sequence`/`random`/`toggle`/latch state collides (one advances the other's
sequence index, toggles cancel each other, etc.). Two layers of the same graph should run as two
INDEPENDENT voices/layers.

## The fix
Make each slot's `statePrefix` unique per slot POSITION, e.g. `statePrefix = `${key}#${slotIndex}``
(include the slot index). This:
- disambiguates two slots holding the same key in the same section (distinct state — the goal), AND
- keeps cross-section reuse stable: the same graph in slot 0 of Verse and slot 0 of Chorus still shares
  a state key (same slot index), which is the existing/intended behaviour (sequential, not collision).
Do NOT dedupe (that would drop a real layer). Keep the flat-fallback path's prefix as the padKey
(unchanged). Determinism must hold (seeded PRNG; no `Math.random`/`Date.now`).

## Test (packages/core/src/voice/engine.test.ts)
Add a test: an active section with a drum whose TWO slots reference the SAME graph key (use a
`sequence` graph) fires TWO independent layers whose state does not collide — e.g. both spawn on the
first hit (2 voices), and across hits each instance advances its own sequence independently (assert
the voice count / chosen effects reflect two independent sequencers, not one shared one). Keep all
existing tests green.

## Gate + report
Use package-scoped gates while working: `pnpm --filter @ledrums/core typecheck && pnpm --filter
@ledrums/core test`. Edit ONLY `packages/core/src/voice/engine.ts` + `engine.test.ts` (sibling agents
are concurrently editing web files — do not touch them). Before reporting, run the package gates and
paste output. Then:
```
twux send-message --session parent --slice-status "<short>" --body "<the collision, the per-slot prefix fix, the test, pasted core typecheck+test output>"
```

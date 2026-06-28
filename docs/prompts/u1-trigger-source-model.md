# U1 — Trigger-source model (the foundation)

Slice T1 of `docs/prompts/trigger-node-source.md` (read it + `docs/prompts/patch-graph-authoritative.md` for the input model this consumes). Branch `feat/unified-shell`. **Model only — NOT the Inspector UI (a later slice owns `Inspector.svelte`), NOT input routing (a later slice owns `input-router.ts` + engine resolution), NOT fixtures (a sibling owns `fixtures.ts`).**

## Goal
Give the **trigger node** (the root of every trigger graph) an explicit, editable `source` so a graph declares *what fires it*. Today the binding is implicit (graphs keyed by padKey `drumId:zone`). Add the model + a single value-normalization seam + store mutators + back-compat. No UI, no routing changes yet.

## Scope (disjoint — yours alone)
- `apps/web/src/lib/trigger-lab/sim.ts`
- `packages/core/src/voice/types.ts`  (structural mirror of the source field ONLY — see constraint)
- `apps/web/src/lib/trigger-lab/store.svelte.ts`
- new/updated `*.test.ts` beside the above
- **Do NOT touch:** `Inspector.svelte`, `TriggerNode.svelte`, `core/voice/engine.ts` (resolution is U3), `input-router.ts`, `fixtures.ts`.

## Tasks
1. **Source union on the trigger node** (`sim.ts` `GraphNode`, additive/optional):
   ```ts
   type TriggerSource =
     | { kind: 'drum'; drumId: string; zone: string }   // Sensory Percussion pad-zone (existing binding, made explicit)
     | { kind: 'midi'; note?: number; cc?: number }      // raw MIDI note OR cc (one or the other); channel comes from the patch device, NOT here
     | { kind: 'osc'; address: string };                 // e.g. '/kick'; host/namespace from the patch device
   ```
   The trigger node gains an optional `source?: TriggerSource`.
2. **Back-compat default** (`store.svelte.ts` hydrate, like `unionEffects`/`unionPresets`): every existing trigger node with no `source` defaults to `{ kind:'drum', drumId, zone }` derived from its graph's padKey. Authored graphs (`graph:<n>`) with no pad get a sensible default (e.g. `drum` with empty/first zone, or leave `source` unset = behaves as today) — pick the least-surprising and document it. Idempotent.
3. **Value-normalization seam** — ONE exported pure function that maps a raw fire into the trigger's normalized **0–1 value** per source: drum velocity (already 0–1) · MIDI note-velocity or `cc/127` · OSC arg. This is the value the switch `value` mode routes on. Keep it in one place (so all three sources feed the switch identically); unit-test it. Do NOT wire it into eval/resolution yet (that's U3) — just provide + test the seam.
4. **Core mirror** (`core/voice/types.ts`): add the SAME `source?: TriggerSource` field, **structurally identical** to web (show-builder passes graphs through by structural typing — keep them byte-identical in shape). Do NOT add resolution logic to `engine.ts`.
5. **Store mutators**: `setTriggerSource(graphKey, source)` (+ any helpers the future Inspector will call), optimistic local write; autosave/persistence already covers it. No WS message needed yet.
6. **Tests** (web + core): back-compat default fills `drum` from padKey; normalization parity for drum/midi/cc/osc; idempotent hydrate; structural identity web↔core (a graph with a source round-trips through `buildShow`).

## Gate discipline
- During work: `pnpm --filter @ledrums/web typecheck` + `--filter @ledrums/core typecheck`; full `pnpm typecheck && pnpm test` only on your committed clean tree. Keep the change **additive** so it doesn't break existing consumers before commit.
- Sibling agents are concurrently editing `Inspector.svelte`, `fixtures.ts`, `output-manager.ts`, core geometry (S6) and the server (S7) — stay strictly off those files.

## Acceptance
- Trigger nodes carry an explicit `source`; existing graphs default to `drum` from padKey (no behaviour change yet); normalization seam tested; web↔core shapes identical; full sweep green.

## Report back
Report to parent (`twux send-message --session parent`) with commit SHA, files, the final `TriggerSource` shape + normalization API (U2/U3 build on it), gate totals, deviations. **Commit before reporting.** Leave `.mex/ROUTER.md` to the orchestrator.

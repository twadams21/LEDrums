# S13 - Gen3 Stabilisation Review Fixes

Date: 2026-07-08
Branch: `codex/gen3-graph-authoring`
Parent initiative: Issue #66, Gen3 Graph Authoring
Depends on: the current branch head after `Stabilise Gen3 graph authoring`

## Agent Brief

You are fixing the remaining merge blockers found in review of the Issue #66 Gen3 Graph Authoring implementation. This is not a broad feature slice. Do not redesign the Add pane, Scope inspector, sliders, Sections UI, or Mix visuals unless a change is directly required by the correctness fixes below.

The target outcome is merge-readiness for the Gen3 initiative: Gen3 routes only render when intentionally wired to Output, graph normalisation preserves valid Gen3 state, Mix semantics are active-route-correct in both core and offline preview, and Delay resumes through the same Gen3 semantics.

Read these first:

- `.mex/ROUTER.md`
- `AGENTS.md`
- `CLAUDE.md`
- `PRODUCT.md`
- `docs/plans/2026-07-06-gen3-graph-authoring-prd.md`
- `docs/plans/2026-07-08-gen3-graph-authoring-stabilisation-prd.md`
- this file

Run the relevant tests before and after the implementation. If you touch UI files, follow the project UI-shot/design-system rules from `AGENTS.md`.

## Problem Statement

The current Gen3 branch contains most of Issue #66, but the stabilisation implementation still violates core Gen3 semantics in several important ways.

Most importantly, the new core graph normaliser currently auto-wires render leaves to the terminal Output anchor even when the graph is already `version: 3`. That makes half-authored Gen3 routes render when they should be silent. Several web hydration helpers also drop the graph `version`, causing valid Gen3 graphs to be accidentally treated as legacy and re-migrated. Mix evaluation has improved in core, but it is still vulnerable to visual-position ordering, Delay re-enters the old evaluator, and the offline preview still uses the old backwards Mix reconstruction path.

These bugs undermine the central Issue #66 promise: Gen3 graphs have explicit terminal Output routing, and routes render only when they reach Output.

## Solution

Make Gen3 correctness explicit and shared:

1. Core graph normalisation must distinguish legacy migration from Gen3 repair.
2. Every graph transform must preserve `version` and other graph-level metadata unless it is intentionally changing schema generation.
3. Gen3 Mix evaluation must be based on active route propagation, not visual canvas order or backwards static reconstruction.
4. Delayed Gen3 branches must resume through the Gen3 evaluator.
5. Offline preview must use the same Gen3 graph evaluation semantics as core, or have parity tests proving it mirrors core exactly.
6. Tests must cover the failure modes from this review directly, not just happy paths.

## User Stories

1. As a graph author, I want an unwired Gen3 Effect to render nothing, so that half-authored graphs cannot emit light accidentally.
2. As a graph author, I want legacy graphs to preserve old behavior by auto-wiring render leaves during migration, so that returning shows still work.
3. As a graph author, I want valid Gen3 graphs to stay Gen3 through every hydration pass, so that terminal Output anchors are not converted into Scope nodes.
4. As a rig builder, I want the id `output` reserved for the terminal Output anchor, so that pasted or corrupted content cannot delete the real Output anchor by collision.
5. As a performer, I want Mix to include only branches that actually fired for this hit, so that inactive Switch/Chance/Random branches do not ghost into the output.
6. As a graph author, I want Mix behavior to be independent of node x/y placement except for documented layer ordering, so that rearranging the canvas cannot change which branches render.
7. As a graph author, I want delayed branches to behave exactly like immediate branches once they fire, so that Delay + Mix/Scope/Output combinations are reliable.
8. As an operator, I want offline preview to match the connected engine for Gen3 routing, so that the browser preview remains trustworthy.
9. As a reviewer, I want focused regression tests for the exact bugs found in review, so that future changes do not reintroduce them.

## Implementation Decisions

### 1. Fix core Gen3 normalisation so Output auto-wiring is legacy-only

File: `packages/core/src/voice/graph-integrity.ts`

Current problem:

- `normalizeTriggerGraphToGen3()` computes render leaves and adds `leaf -> output` unconditionally.
- This is correct for legacy/unversioned graphs, because old behavior had implicit leaf rendering.
- This is wrong for already-Gen3 graphs, because Issue #66 requires explicit Output-gated rendering.

Required behavior:

- If `graph.version !== 3`, migrate legacy render leaves to Output using flow-edge-only leaf detection.
- If `graph.version === 3`, never add new render-leaf-to-Output edges just because a route is a leaf.
- Gen3 repair may still repair malformed existing Output anchors, dangling edges, duplicate ids, duplicate output nodes, persisted `play`, etc.
- Preserve idempotence: running the normaliser twice on the repaired graph should produce the same graph and no new issues.

Suggested implementation shape:

```ts
const shouldWireLegacyLeaves = legacy;
if (shouldWireLegacyLeaves) {
  const hasOutgoingFlow = new Set(edges.filter(isFlowEdge).map((e) => e.from));
  const leaves = nodes.filter((n) =>
    n.id !== OUTPUT_ANCHOR_ID &&
    isRenderLeafCandidate(n) &&
    !hasOutgoingFlow.has(n.id),
  );
  for (const leaf of leaves) {
    addEdge({ id: edgeIdFor(edgeIds, `e-${leaf.id}-output`), from: leaf.id, to: OUTPUT_ANCHOR_ID });
  }
}
```

Do not use exactly this snippet blindly if the surrounding implementation changes. The invariant is what matters.

Tests to add/update:

- `packages/core/src/voice/graph-integrity.test.ts`
  - Legacy unversioned `trigger -> play` still normalises to `trigger -> effect -> output`.
  - Gen3 `trigger -> effect`, with a terminal Output anchor but no effect-to-output edge, remains unwired after normalisation.
  - Gen3 with only a `param:<key>` or `mod` outgoing wire from an Effect remains unwired unless it already had a flow edge to Output.
  - Gen3 normalisation is idempotent and does not add new edges on the second pass.
- `packages/core/src/voice/eval-graph.playtype.test.ts` or a new eval test:
  - Gen3 unwired Effect emits no PlayAction after normalisation.

### 2. Preserve graph `version` and graph-level metadata in all hydration transforms

Files to inspect and fix:

- `apps/web/src/lib/trigger-lab/store/hydrate.ts`
- Any other graph transform helpers returning `{ nodes, edges }`

Known suspect helpers:

- `withDrumSource()` currently returns `{ nodes, edges: graph.edges }` when it changes the trigger source.
- `materializeLinkedNodes()` currently returns `{ nodes, edges: graph.edges }`.
- `migrateGraphEnvelopes()` currently returns `{ nodes, edges: graph.edges }`.
- `migrateGraphEnvMaps()` currently returns `{ nodes, edges: [...graph.edges, ...addedEdges] }`.

Required behavior:

- Any transform that is not intentionally changing schema generation should return `{ ...graph, nodes, edges: ... }`.
- Do not drop `version: 3`.
- Do not drop future graph-level metadata.
- Keep alias-stability where possible: unchanged graphs should return the same reference.

Tests to add/update:

- `apps/web/src/lib/trigger-lab/store/hydrate.integrity.test.ts`
  - A valid Gen3 graph with trigger/effect/output remains Gen3 after full `normalizeGraphs()`.
  - A valid Gen3 terminal Output node remains `kind: 'output'`, not rewritten to `scope`.
  - A Gen3 graph that triggers `withDrumSource()` still preserves `version: 3`.
  - A Gen3 graph that triggers env/materialize migrations still preserves `version: 3`.

### 3. Reserve the terminal `output` id

File: `packages/core/src/voice/graph-integrity.ts`

Current problem:

- A non-output node with id `output` can be added before the terminal Output anchor is added.
- The real terminal Output anchor then collides and can be dropped as a duplicate id.

Required behavior:

- In Gen3, `id: 'output'` is reserved for the terminal Output anchor.
- In legacy migration, old scoped Output with id `output` should continue to be remapped to a Scope id such as `scope:output` before adding the terminal Output anchor.
- If a non-output node has id `output`, deterministically rename/remap it or drop it with a clear issue. Prefer remapping where edge preservation is straightforward.
- Existing edges that pointed at the remapped node must follow the remap.

Tests to add:

- Non-output node id `output` does not prevent the terminal Output anchor from existing.
- Edges to/from the remapped non-output node remain valid if the node is remapped.
- Exactly one terminal Output anchor remains after normalisation.

### 4. Make Gen3 Mix evaluation independent of visual processing order

File: `packages/core/src/voice/eval-graph.ts`

Current problem:

- `evalGraphGen3()` uses a queue sorted by node visual rank (`x`, then `y`, then id).
- Mix waits only for incoming source nodes that are already enqueued but not processed.
- A Mix can process too early if a later active branch has not reached/enqueued its source yet.
- Once Mix is marked enqueued, late branch inputs may not cause it to run again.

Required behavior:

- Gen3 eval must be based on active route propagation, not visual canvas position.
- Visual y-position may determine Mix layer order only after the active input set is known.
- A Mix node should receive every active upstream branch for the current trigger evaluation and no inactive branches.
- Inactive switch/chance/random branches and disconnected branches must never contribute to Mix.

Acceptable implementation approaches:

1. Two-phase active propagation:
   - Phase A walks from Trigger and records all active route arrivals into per-node buckets without emitting Mix too early.
   - Phase B evaluates Mix nodes after upstream active propagation for that trigger has settled.
2. Worklist with dependency accounting:
   - Track active predecessor completion per node.
   - A Mix is ready only when all active incoming predecessor paths that can reach it in this evaluation have either arrived or been proven inactive.
3. Another deterministic active-route algorithm that passes the tests below and does not use visual rank as the correctness mechanism.

Do not patch this by checking only static reachability from Trigger. Reachability is not enough; Switch/Chance/Random/Sequence/Toggle/Delay decide active branches for the current trigger context.

Tests to add/update in `packages/core/src/voice/eval-graph.mix.test.ts`:

- Mix visually before one active upstream branch still receives both active inputs.
- Moving nodes in x/y changes Mix input row/layer ordering only where the PRD says it should, not active branch membership.
- Switch bands: selected branch only enters Mix.
- Chance fail: failed branch does not enter Mix.
- Disconnected branch wired into Mix does not enter Mix.
- Two active branches entering Mix are sorted by upstream source y, then id, after active membership is decided.
- Per-edge opacity stays attached to the correct active incoming edge.
- Mix output action has `scope: 'kit'` / no target by default and does not inherit final scope/target from the first input.
- Downstream Scope after Mix filters the composite action.

### 5. Route delayed Gen3 evaluation through the Gen3 evaluator

File: `packages/core/src/voice/eval-graph.ts`

Current problem:

- Immediate `evalGraph()` dispatches to `evalGraphGen3()` for `graph.version === 3`.
- Delayed branch resume goes through `evalChildren()`, which currently calls `evalNodeWithDraft()` and therefore uses the old recursive evaluator.
- The old recursive evaluator still contains backwards `draftFromUpstream()` / `mixInputsFor()` and first-input host semantics.

Required behavior:

- If a pending descriptor belongs to a Gen3 graph, resume it through the same Gen3 active-route evaluator semantics used by immediate graph fires.
- Preserve delay guarantees: `ctx` and delay time are snapshotted at enqueue time, and nested delay cycle guards still prevent infinite loops.
- Legacy/unversioned graphs can keep using the old evaluator if that reduces risk.

Possible implementation direction:

- Extend the Gen3 evaluator to accept an initial set of active child ids plus an optional incoming draft/bucket context.
- `evalGraphGen3()` becomes a small wrapper around a shared `evalGraphGen3From(...)` helper.
- `evalChildren()` checks `graph.version === 3` and delegates to the Gen3 helper instead of `evalNodeWithDraft()`.

Tests to add:

- `delay -> effect -> output` still emits after the delay.
- `delay -> switch -> mix -> output` uses active Switch/Mix semantics after the delay.
- `delay -> mix -> output` does not include disconnected/inactive branches.
- Nested delay still does not infinite-loop on cycles.

### 6. Make offline preview use the same Gen3 eval semantics as core

Files to inspect:

- `apps/web/src/lib/trigger-lab/sim.ts`
- `apps/web/src/lib/trigger-lab/render.ts`
- `apps/web/src/lib/trigger-lab/sim.value-switch.test.ts`
- Any test seams that compare web sim and core voice evaluation.

Current problem:

- The web `Sim` class still has its own graph evaluator.
- Its Mix path still uses backwards `draftFromUpstream()` and `mixInputsFor()`.
- Its Mix node still uses the first input as host.
- Therefore offline preview can diverge from the connected core engine for Gen3 Mix semantics.

Preferred fix:

- For `graph.version === 3`, have web `Sim.triggerGraph()` delegate to core `voice.evalGraph` or a shared exported core evaluator, then spawn equivalent web voices from those actions.
- Keep legacy Block-tree simulation if needed for old lab paths.

If direct delegation is too invasive:

- Mirror the fixed core Gen3 evaluator exactly in web sim.
- Add parity tests that compare core `voice.evalGraph` output and web `Sim` output for the same Gen3 graphs.

Tests to add:

- Core/web parity for Gen3 unwired effect = no action/voice.
- Core/web parity for Switch -> Mix active branch membership.
- Core/web parity for Mix with different branch scopes.
- Core/web parity for Delay -> Mix if web preview supports delayed graph firing.

### 7. Review UI-shot and design-system evidence only after correctness fixes

Files:

- `scripts/ui-shot/shots.json`
- `docs/design-system.html`

The branch already has Gen3 UI-shot targets for:

- `gen3-add-pane-route`
- `gen3-scope-inspector`
- `gen3-mix-node`
- `gen3-slider-input`
- `gen3-sections-arrangement`

After the correctness fixes, rerun the project-required checks. If this implementation does not touch UI, do not churn UI files unnecessarily. If any UI files change, regenerate/verify according to `AGENTS.md`.

## Testing Decisions

Run at least:

```bash
pnpm test
pnpm typecheck
```

If UI files changed, also run:

```bash
pnpm ui-shot
pnpm design-system
```

Targeted tests that must exist after this slice:

- Core graph integrity tests for legacy auto-wiring versus Gen3 no-auto-wiring.
- Web hydration tests proving `version: 3` survives the full `normalizeGraphs()` pipeline.
- Core graph integrity tests proving reserved `output` id cannot remove the terminal Output anchor.
- Core eval tests proving Gen3 unwired effects do not emit.
- Core Mix tests proving active branch membership is independent of visual processing order.
- Core Delay tests proving delayed Gen3 branches resume through Gen3 semantics.
- Web/core parity tests for offline preview Gen3 Mix behavior.

## Acceptance Criteria

This slice is complete when all of the following are true:

1. Legacy/unversioned graphs still auto-wire render leaves to Output during migration.
2. Already-Gen3 graphs never gain new leaf-to-Output wires unless those wires already existed or the user explicitly adds them.
3. A Gen3 `trigger -> effect` graph with an Output anchor but no `effect -> output` emits nothing.
4. Full web graph hydration preserves `version: 3` through every transform.
5. Valid Gen3 terminal Output anchors are not converted to Scope by accidental legacy re-migration.
6. The id `output` is reserved for the terminal Output anchor and cannot be stolen by another node kind.
7. Gen3 Mix includes exactly the active branches for the current trigger evaluation.
8. Gen3 Mix correctness does not depend on canvas x/y processing order.
9. Delayed Gen3 branches resume through the same active-route semantics as immediate branches.
10. Offline preview and connected core engine agree for Gen3 Mix/Switch/Scope/Output behavior.
11. All new regressions from this prompt are covered by tests.
12. `pnpm test` and `pnpm typecheck` pass, or any failure is documented with exact unrelated pre-existing evidence.
13. UI-shot/design-system checks are rerun if UI files changed.

## Out of Scope

- New node kinds.
- New Add pane visuals.
- Reworking Scope inspector UI beyond what tests force.
- Redesigning Mix node card rows.
- Removing the legacy Block-tree `PlayBlock` model entirely.
- Multiple terminal Output anchors.
- Large performance rewrites unrelated to the eval correctness problems above.
- Broader issue splitting or GitHub issue management.

## Suggested Commit Order

1. `fix(gen3): keep output leaf auto-wiring legacy-only`
2. `fix(hydrate): preserve trigger graph version through migrations`
3. `fix(gen3): reserve terminal output anchor id`
4. `fix(core): make gen3 mix evaluation topology-active`
5. `fix(core): resume delayed gen3 branches through gen3 eval`
6. `fix(web): align offline gen3 preview with core eval`
7. `test(gen3): cover output gating hydration mix and delay regressions`
8. `test(ui): refresh gen3 ui-shot evidence` only if UI changed

## Notes for the Agent

- Do not trust existing tests that expect Gen3 normalisation to add `effect -> output` edges. That expectation is wrong for `version: 3` graphs.
- Do not solve Mix by static reachability. Static reachability still includes inactive Switch/Chance/Random branches.
- Do not make visual position a dependency-order mechanism. Visual y may sort Mix layers, but should not decide whether an active input arrives.
- Be careful with old helper comments that claim valid references are preserved. The current normaliser always returns new graph objects; preserve identity where practical but correctness comes first.
- Prefer sharing the core Gen3 evaluator with web preview rather than maintaining two route evaluators.
- Keep `packages/core` pure: no DOM, Svelte, Node IO, or browser APIs.

# Gen3 Graph Authoring Stabilisation PRD

Date: 2026-07-08
Branch: `codex/gen3-graph-authoring`
Parent PRD: `docs/plans/2026-07-06-gen3-graph-authoring-prd.md`
Related issue: #66

This PRD is a follow-up to the Gen3 Graph Authoring PRD. It documents the remaining correctness problems found during review of `codex/gen3-graph-authoring` after the partial fix commits ending at `94681c0b9bbc59adcfe9e7ef4ce75197c86b094d`.

## Problem Statement

The branch has many useful Gen3 authoring pieces, but it is still not safe to merge because the new graph model is only partially enforced. The UI now exposes Gen3 concepts such as Effect, Scope, Mix, Output, section DnD, and Add-node taxonomy, but several runtime and model boundaries can still accept or produce internally inconsistent graphs.

The highest-risk remaining bugs are:

1. Gen3 graph invariants are enforced mainly in web hydration, not at core/runtime boundaries.
2. `play` still exists as a first-class graph node kind in core types even though Gen3 should persist `effect` only.
3. Mix evaluation reconstructs upstream branches statically, so inactive/disconnected branches can still participate in a Mix.
4. Mix uses the first input as the host draft, so mixed branches with different scopes or targets can render incorrectly.
5. The Gen3 migration leaf detector treats any outgoing edge as evidence that a render route is not a leaf, including non-flow wires.
6. The authored setlist model and runtime/core show model are still documented as different shapes without an explicit boundary contract.
7. UI-shot evidence and full test verification are still missing for this UI-heavy branch.

The implementation agent should treat this as a stabilisation/merge-readiness slice, not as a new feature expansion.

## Already Landed in This Branch

Do not duplicate this work unless tests show it regressed:

- Fresh authored graphs now start as Gen3 with `version: 3`, `trigger`, and a terminal `output` anchor in `apps/web/src/lib/trigger-lab/store/graphs.ts`.
- `treeToGraph()` now compiles legacy block-tree `play` leaves to canonical `effect` graph nodes, adds `version: 3`, adds an Output anchor, and wires render leaves to Output in `apps/web/src/lib/trigger-lab/sim.graph-compilation.ts`.
- Section and graph-row same-list drag/drop now corrects downward pre-removal indices in `apps/web/src/lib/app/setlist.ts`.
- Section duplicate shortcut handling now ignores editable text targets via `apps/web/src/lib/app/primary-shortcut.ts` and `SectionsView.svelte`.
- Scope inspector effective readout now walks all incoming flow branches and ignores modulation/param wires in `apps/web/src/lib/app/docks/inspectors/scope-inspector.ts`.
- Focused tests were added for the above pure seams, but the full suite has not been run by this author.

## Solution

Make Gen3 a real invariant at the pure/core boundary, then fix Mix as a forward active-route evaluation problem rather than a backwards static-draft reconstruction problem.

The desired end state:

- Every graph entering runtime evaluation or show compilation is either normalised to Gen3 or rejected with actionable diagnostics.
- Gen3 persisted graphs contain canonical `effect` nodes only; `play` is accepted only as legacy input to migration.
- Every Gen3 graph has exactly one Trigger anchor and exactly one terminal Output anchor.
- Effect routes emit only when the active route reaches Output.
- Mix combines only active upstream route buffers for the current trigger context.
- Mix does not inherit final scope/target from the first input. Branch scopes apply to branch render buffers; downstream Scope/Output filters apply to the composite route after Mix.
- Migration connects legacy render leaves to Output based on flow edges only.
- Authored setlist shape and runtime show shape have an explicit documented bridge.
- Tests and UI-shot evidence prove the branch is merge-ready.

## User Stories

1. As a rig builder, I want invalid Gen3 graphs repaired or rejected before runtime, so that half-authored or stale persisted data cannot emit unexpected light.
2. As a show author, I want Gen3 graphs to consistently use Effect nodes, so that old Play vocabulary does not leak into new authoring or saved shows.
3. As a performer, I want a Mix node to blend only the routes that actually fired for the current hit, so that random/switch/chance branches do not ghost into the output.
4. As a graph author, I want mixed branches with different scopes to preserve their own target regions before blending, so that a snare layer and kick layer do not collapse onto whichever branch is first.
5. As a returning user, I want legacy graphs with modulation or modifier wires to migrate safely, so that leaf Effect nodes are not accidentally left disconnected from Output.
6. As an implementation agent, I want pure graph normalisation and validation seams, so that invariants can be tested without UI or Svelte state.
7. As a reviewer, I want UI-shot artifacts for the changed authoring surfaces, so that dense graph UI changes can be checked visually before merge.

## Implementation Plan

### 1. Move Gen3 normalisation and validation into core

Current problem:

- `packages/core/src/voice/types.ts` defines `TriggerGraph` as a loose shape with optional `version?: 3`, `nodes`, and `edges` only.
- Web hydration has `migrateGen3Graph()` and `sanitizeGraphIntegrity()` in `apps/web/src/lib/trigger-lab/store/hydrate.ts`, but core/runtime boundaries can still receive invalid shapes.
- The original Gen3 PRD explicitly required schema/invariant tests for one Output anchor, no persisted `play`, duplicate ids, dangling edges, and anchor deletion.

Create a pure core module:

```ts
// packages/core/src/voice/graph-integrity.ts
import type { GraphEdge, GraphNode, TriggerGraph } from './types';

export type TriggerGraphIssueCode =
  | 'missing-trigger'
  | 'missing-output'
  | 'duplicate-output'
  | 'duplicate-node-id'
  | 'duplicate-edge-id'
  | 'dangling-edge'
  | 'self-edge'
  | 'persisted-play-in-gen3'
  | 'duplicate-connection';

export interface TriggerGraphIssue {
  code: TriggerGraphIssueCode;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface TriggerGraphIntegrityResult {
  graph: TriggerGraph;
  issues: TriggerGraphIssue[];
}

export function normalizeTriggerGraphToGen3(graph: TriggerGraph): TriggerGraphIntegrityResult;
export function validateTriggerGraphIntegrity(graph: TriggerGraph): TriggerGraphIssue[];
export function assertTriggerGraphIntegrity(graph: TriggerGraph): void;
```

Implementation decisions:

- Keep this module free of web/Svelte dependencies.
- Do not import `makeNode` from the web sim layer.
- Define a tiny core-local `anchorNode(kind, x, y)` helper that fills all required `GraphNode` fields with neutral defaults matching `makeNode()`.
- Treat `graph.version !== 3` as legacy input:
  - rewrite `play` nodes to `effect`;
  - rewrite legacy `output` nodes to `scope` route filters;
  - create one terminal Output anchor with id `output`;
  - connect legacy render leaves to Output.
- Treat `graph.version === 3` as canonical input:
  - rewrite stray `play` to `effect` for robustness but emit a `persisted-play-in-gen3` issue;
  - preserve exactly one Output anchor with id `output`;
  - drop or remap duplicate Output anchors deterministically and report issues;
  - drop dangling/self/duplicate edges deterministically and report issues.
- Preserve valid node ids and wire ids wherever possible.
- Preserve node positions wherever possible.
- Make the normaliser idempotent.

Wire it in:

- Export from `packages/core/src/voice/index.ts`.
- Replace or delegate web `migrateGen3Graph()` / `sanitizeGraphIntegrity()` in `apps/web/src/lib/trigger-lab/store/hydrate.ts` to the core function rather than maintaining two subtly different implementations.
- Ensure show/runtime compilation uses the same normalisation before handing graphs to eval/engine:
  - inspect `apps/web/src/lib/trigger-lab/show-builder.ts`;
  - inspect server/engine graph entry points under `apps/server/src/`;
  - avoid putting allocation-heavy normalisation inside the render hot path if the graph can instead be normalised at load/build/update time.

Tests to add:

- `packages/core/src/voice/graph-integrity.test.ts`
- `apps/web/src/lib/trigger-lab/store/hydrate.integrity.test.ts` should become a thin web-boundary test proving web hydration calls the core normaliser.

Core test cases:

1. Unversioned graph with `play` leaf normalises to `version: 3`, `effect`, exactly one `output`, and leaf-to-output wire.
2. Legacy scoped `output` node normalises to `scope`, then adds terminal `output`.
3. Gen3 graph with duplicate Output anchors returns one canonical Output and reports `duplicate-output`.
4. Gen3 graph with persisted `play` becomes `effect` and reports `persisted-play-in-gen3`.
5. Duplicate node ids are removed deterministically and all invalid edges are removed.
6. Dangling, self, and duplicate-connection edges are removed.
7. Re-running normalisation returns an equal graph and no new issues.

### 2. Make `play` a legacy persisted alias, not a Gen3 graph concept

Current problem:

- `packages/core/src/voice/types.ts` still has `BlockKind = 'play' | 'effect' | ...` and `NodeKind` includes both `BlockKind` and `'effect'`.
- Removing `play` from every type may be too large for this stabilisation branch because the legacy block-tree model still has `PlayBlock`.

Implementation decision:

- Do not try to delete the legacy block-tree `PlayBlock` in this slice.
- Do introduce a clearer split:

```ts
export type LegacyGraphNodeKind = 'play';
export type CanonicalGraphNodeKind =
  | 'trigger'
  | 'effect'
  | 'all'
  | 'random'
  | 'sequence'
  | 'switch'
  | 'chance'
  | 'toggle'
  | 'delay'
  | 'modifier'
  | 'mix'
  | 'scope'
  | 'output'
  | 'envelope'
  | 'lfo'
  | 'cc'
  | 'note'
  | 'osc'
  | 'randomMod';

export type NodeKind = CanonicalGraphNodeKind | LegacyGraphNodeKind;
```

- Add comments that `play` is migration-only for persisted graph input and must not be emitted by Gen3 authoring.
- Make validators flag `play` in any `version: 3` graph.
- Confirm these creation paths emit `effect`, not `play`:
  - `apps/web/src/lib/trigger-lab/sim.graph-compilation.ts` (`treeToGraph()` already fixed);
  - `apps/web/src/lib/trigger-lab/store.svelte.ts` node creation / paste / duplicate paths;
  - `apps/web/src/lib/app/views/add-node-taxonomy.ts` and `add-pane.ts`;
  - any clipboard/import path in `apps/web/src/lib/trigger-lab/clipdoc.ts`.

Tests:

- Store add-node tests should prove user-created content nodes use `effect`.
- Clipboard/import tests should prove pasted legacy `play` nodes normalise to `effect` before entering live state.

### 3. Fix Mix evaluation using active forward route propagation

Current problem:

- `packages/core/src/voice/eval-graph.ts` currently has `draftFromUpstream()` and `mixInputsFor()` that walk backwards from Mix inputs and reconstruct static drafts.
- This can include branches that did not actually fire for the current trigger context.
- Example bug: `trigger -> switch(value bands) -> lowEffect -> mix` and `highEffect -> mix`; when velocity selects low, the current static reconstruction can still include high if it is wired into Mix.
- Mix also chooses `mixInputs[0]` as the host draft, so branch order controls effect id, scope, and target semantics.

Required semantic decision:

Mix is buffer-level route composition. It should not choose a content-producing branch as its semantic host. Branch scopes apply while rendering each branch buffer. Downstream Scope/Output applies to the composite buffer after Mix.

Preferred implementation approach:

- Introduce a Gen3-specific forward graph evaluator rather than adding more backwards reconstruction to the current recursive evaluator.
- Keep the existing recursive evaluator for legacy/unversioned graphs if that reduces risk.
- For `graph.version === 3`, evaluate active flow edges forward from Trigger.

Suggested types:

```ts
type RouteDraft =
  | { kind: 'empty' }
  | { kind: 'effect'; play: PlayDraft }
  | { kind: 'mix'; mix: MixDraft };

interface MixDraft {
  blendMode: BlendMode;
  inputs: MixInputDraft[];
  // The route-level mask after downstream Scope nodes. Do not steal this from the first input.
  scope: Scope;
  targetId?: string;
}
```

Alternative acceptable implementation:

- If introducing `RouteDraft` is too invasive, keep `PlayDraft` but add an explicit neutral route-carrier for Mix and remove the first-input-host assumption.
- The key requirement is that Mix output scope/target must not be inherited from `mixInputs[0]`.

Forward-eval rules:

- Flow edges are edges with `toPort == null || toPort === 'in'`.
- Trigger starts the active traversal.
- Effect creates a branch draft from node params/modifiers/modulations, then continues downstream.
- Scope intersects the current route mask with its target. Empty intersection stops the route.
- Switch/Chance/Random/Sequence/Toggle/Delay continue to behave deterministically with existing state maps.
- Mix waits for all active incoming branches for this trigger evaluation, then emits exactly one mixed route downstream if at least one active input arrived.
- Inactive branches never appear in `mixInputs`.
- A Mix with zero active inputs emits nothing.
- Output emits the current route as an action only when reached.

Important implementation note:

Depth-first recursion emits downstream actions too early for Mix because the first branch to reach a Mix cannot know whether later branches will also reach it. Use either:

1. A two-phase Gen3 evaluator:
   - Phase A: propagate active drafts through the graph into per-node input buckets.
   - Phase B: when a node's active incoming buckets are complete for the current trigger, evaluate the node and propagate downstream.
2. A topological/worklist evaluator over active flow edges:
   - Sort nodes/edges deterministically by `x`, then `y`, then id.
   - Accumulate active inputs per node.
   - Evaluate route nodes once their active predecessors have been processed.
   - Use cycle guards and the existing deterministic PRNG/state maps.

Tests to add in `packages/core/src/voice/eval-graph.mix.test.ts`:

1. Switch selects only one branch into Mix; Mix action contains only that active input.
2. Chance gate fails on one incoming branch; failed branch is absent from Mix.
3. Disconnected effect wired into Mix but not reachable from Trigger is absent from Mix.
4. Two active branches both reach Mix; Mix contains both inputs sorted by source node `y`, then id.
5. Per-edge opacity is preserved on the matching incoming active edge.
6. Mix with zero active inputs emits no action.
7. Mix output does not inherit scope/target from the first input.
8. Downstream Scope after Mix filters the composite route.
9. Delay feeding Mix still snapshots context and eventually contributes only when the delayed branch fires.

### 4. Fix compositor support for scoped Mix inputs

Current problem:

- The current compositor/render path can use the host voice scope as the final copy mask for the mixed buffer.
- If the host draft came from the first Mix input, branch order can wrongly constrain the output.

Required behavior:

- Each Mix input renders into its own scoped branch buffer using that input's `scope` and `targetId`.
- The Mix node blends those branch buffers according to Mix blend mode and per-input opacity.
- Downstream route scope after Mix applies to the mixed buffer as a final mask.
- If there is no downstream scope, the composite route should not be narrowed solely because the first Mix input happened to target a drum/hoop.

Files to inspect:

- `packages/core/src/voice/compositor.ts`
- `packages/core/src/voice/compositor.test.ts`
- `packages/core/src/voice/voice-pool.ts`
- `apps/web/src/lib/trigger-lab/render.ts`

Tests to add/update:

1. Mix input A targets snare and input B targets kick; both appear in output when Mix reaches whole-kit Output.
2. Same graph with downstream Scope to snare emits only snare pixels after Mix.
3. Reversing input vertical order does not change final target mask, only layer order/blending order.
4. Per-input opacity applies before blend.
5. Empty scope intersection produces no pixels, not fallback to whole kit.

### 5. Fix Gen3 migration leaf detection for flow edges only

Current problem:

- In `apps/web/src/lib/trigger-lab/store/hydrate.ts`, `migrateGen3Graph()` determines leaves using a set of all outgoing edges.
- A render node with only outgoing `mod` or `param:<key>` wires can be misclassified as non-leaf and therefore not connected to Output during migration.

Implementation:

- Move this to core normalisation if task 1 is done first.
- Leaf detection should consider only trigger/effect-flow outgoing edges:

```ts
function isFlowEdge(edge: GraphEdge): boolean {
  return edge.toPort == null || edge.toPort === 'in';
}

const hasOutgoingFlow = new Set(edges.filter(isFlowEdge).map((edge) => edge.from));
const leaves = nodes.filter((node) =>
  node.id !== OUTPUT_ANCHOR_ID &&
  isLegacyRenderLeafCandidate(node) &&
  !hasOutgoingFlow.has(node.id),
);
```

- Do not treat `param:<key>` modulation edges as route continuation.
- Do not treat `mod` modifier-chain edges as route continuation.
- Be careful with source ports from value-band switches; `fromPort` is still a flow source when the target input is the default flow input.

Tests:

1. Legacy effect with only `param:<key>` outgoing wire still gets effect-to-output migration wire.
2. Legacy effect with only `mod` outgoing wire still gets effect-to-output migration wire.
3. Legacy effect with actual flow child does not get an extra direct Output wire unless it is also a terminal render leaf.
4. Value-band switch child edges remain flow edges even though they use `fromPort: 'band-i'`.

### 6. Formalise authored setlist versus runtime show boundary

Current problem:

- Web authoring now uses songs -> sections -> ordered graph key lists.
- Core/runtime comments and some types still describe older slot-grid semantics.
- `show-builder.ts` bridges these concepts, but the boundary is not explicit enough for future agents.

Implementation:

- Update comments/types in `packages/core/src/voice/types.ts` around `Section`, `Song`, and setlist/runtime structures.
- Consider naming the two shapes explicitly:
  - `AuthoredSong` / `AuthoredSection` in web setlist if they remain web-only.
  - `RuntimeSong` / `RuntimeSection` or clear comments in core if the current core shape remains runtime-only.
- Update `apps/web/src/lib/trigger-lab/show-builder.ts` comments to state it is the only bridge from authored flat graph lists to runtime graph slots/section recalls.
- Add a small test in `apps/web/src/lib/trigger-lab/show-builder.test.ts` if one exists, or create one, proving:
  - graph list order is preserved where it matters;
  - graph keys resolve to the intended runtime entries;
  - reused graph keys across sections share graph definitions rather than copy divergent graph bodies.

### 7. Run full verification and add UI-shot evidence

Required commands from repo root:

```bash
pnpm test
pnpm check
pnpm ui-shot
```

If `pnpm check` or `pnpm test` is not the current project command, use the commands from `AGENTS.md` and note the actual command names in the PR/commit message.

Because this branch touches the graph authoring UI, update or attach evidence for:

- Add pane category + Stage 2 node previews.
- Scope inspector preview and effective readout.
- Mix node input rows and layer ordering.
- Slider numeric input surface.
- Sections drag/drop / duplicate shortcut surface.

If `docs/design-system.html` is regenerated by the UI-shot/design-system workflow, commit it with the implementation.

## Acceptance Criteria

The implementation is complete when all of the following are true:

1. A pure core Gen3 normaliser/validator exists and is exported.
2. Web hydration delegates Gen3 invariant repair to the core normaliser or is provably identical via shared tests.
3. Runtime/show graph entry points normalise or validate graphs before eval, without adding hot-path render-loop allocation.
4. Gen3 graphs never persist `play` after normalisation.
5. Gen3 graphs always have exactly one terminal Output anchor.
6. Duplicate ids, duplicate Output anchors, dangling edges, self edges, and duplicate connections are repaired or rejected deterministically.
7. Mix includes only active branches for the current trigger context.
8. Mix no longer uses the first input as the semantic host for final route scope/target.
9. Scoped branch Mix rendering works for at least two different drum targets in one Mix.
10. Migration leaf detection ignores `mod` and `param:<key>` wires when deciding whether to connect a render leaf to Output.
11. Authored setlist shape and runtime show shape are documented and tested at the bridge.
12. The full relevant test suite passes.
13. UI-shot/design-system evidence is generated or the PR explains exactly why it was not possible.

## Out of Scope

- Adding new node kinds beyond those already in the Gen3 PRD.
- Redesigning the Add pane visual language beyond fixes required by tests/UI-shot.
- Removing the legacy block-tree `PlayBlock` type entirely.
- Supporting multiple terminal Output anchors.
- Allowing one Scope node to target hoops across multiple drums.
- Changing the public persisted graph schema beyond deterministic Gen3 normalisation.

## Suggested Commit Order

1. `feat(core): add trigger graph Gen3 integrity normalizer`
2. `fix(web): delegate graph hydration to core integrity normalizer`
3. `fix(core): evaluate Gen3 mix from active flow branches`
4. `fix(core): preserve branch scopes through mix composition`
5. `fix(gen3): migrate render leaves using flow edges only`
6. `docs(show): formalise authored setlist runtime bridge`
7. `test(gen3): cover graph integrity mix and migration regressions`
8. `test(ui): update graph authoring ui-shot evidence`

## Notes for the Implementation Agent

- Do not treat the existing backwards `draftFromUpstream()` Mix path as a reliable source of truth. It is the core of the remaining Mix bug.
- Avoid a quick patch that filters Mix inputs by reachability from Trigger only. Reachability is not enough; the branch must be active for the current trigger context after Switch/Chance/Random/Sequence/Toggle/Delay behavior.
- Keep graph normalisation pure and deterministic.
- Keep render-loop code allocation-conscious. Normalise at load/build/update boundaries where possible.
- Preserve existing deterministic PRNG and per-node state keys when refactoring eval.
- Run tests before and after the Mix refactor; Mix is likely to affect compositor, voice-pool, and web preview expectations.

---
name: add-a-graph-node-kind
description: Add a new node kind to the Gen3 trigger graph, end to end — core types, eval, render, the web mirror, and the UI.
triggers:
  - "new node kind"
  - "add a node to the trigger graph"
  - "NodeKind"
  - "graph node"
edges:
  - target: ../context/conventions.md
    condition: before writing core or store code
  - target: add-an-effect.md
    condition: when the node hosts or produces effects
last_updated: 2026-08-15
---

# Add a Gen3 trigger-graph node kind

## Context
A node kind is not one file — it is a spine through core (types → render plan → eval → voice →
compositor), the web offline mirror, and the UI. Delay, Reset, Mix, Scope and Splice all took the
same path. The **typecheck is your checklist**: several `Record<NodeKind, …>` maps are exhaustive,
so `pnpm typecheck` names the UI files you would otherwise forget.

Decide two things before writing code:
- **Is it a producer or a router?** A producer seeds a layer (`effect`, `splice`) and must appear
  in `nodeCategory`, `reachability-lint.isProducer`, `scope-lint`'s producer walk, and
  `graph-integrity.isRenderLeafCandidate`. A router (`delay`, `reset`, `random`) passes the route
  through and touches none of those.
- **Does it need per-frame render behaviour?** If yes it needs a `Voice` carrier + a compositor
  branch + a mirrored branch in the web preview. If no (it only shapes eval), it stops at eval.

## Steps
1. **Core types** (`packages/core/src/voice/types.ts`): add to `CanonicalGraphNodeKind` (and
   `BlockKind` if it takes part in flow eval). Add the node's own optional fields to `GraphNode` —
   ALL optional + additive, so a persisted graph authored before them still resolves. Add any
   runtime-resolved config type and its `Voice` carrier beside `MixInput`.
2. **Pure module** (`voice/<kind>.ts`): every default, every clamp, and all the maths. Export a
   `resolve<Kind>(node, bpm)` returning `null` when the node has nothing to do — eval then emits
   nothing, which is how an unconfigured node stays silent instead of throwing. Resolve any
   bpm-derived timing HERE so it is snapshot-stable for the voice's life (`computeDelayMs` is the
   one source for musical divisions — do not reimplement note values).
3. **Render plan** (`render-plan.ts`): add the kind to `nodeCategory`. The `switch` is exhaustive,
   so this is compulsory, not optional.
4. **Eval** (`eval-graph.ts`): add a `case`. Producers mirror the `effect` case (guard with
   `firedEffects` so fan-in coalesces to one firing per trigger); routers mirror `all`/`delay`.
5. **Voice pool** (`voice-pool.ts`): realise the action into voice state, and **reset the new
   fields on every spawn** — a pooled slot inherits whatever the last voice left. If you carry an
   index-aligned member list, remap the index table when a member is dropped.
6. **Compositor** (`compositor.ts`): add the render branch, ahead of `mixInputs` if the two are
   mutually exclusive. Cache anything expensive by a signature that excludes what MOVES.
7. **Web mirror**: `trigger-lab/sim.ts` (Voice fields + spawn) and `trigger-lab/render.ts` (the
   compositor branch, in Uint8 RGB). Import the core pure module rather than porting the maths —
   the mirror exists to avoid drift, so it must not contain a second copy of the rules.
8. **UI** — the exhaustive maps typecheck will name: `views/trigger-node-meta.ts` (`kindIcon`,
   `tint`, `kindLabel`, plus a `kindSummary` case), `views/add-node-taxonomy.ts` (palette group),
   `styleguide/sections/SectionComposites.svelte` (`faceSubs`). Then the store (defaults in
   `addNode`, mutators, auto-wire if it produces light) and a `docks/inspectors/<Kind>NodeInspector.svelte`
   registered in `Inspector.svelte`.
9. **Tests**: pure maths, an engine-level render suite (drive `createVoiceBusEngine` — eval tests
   structurally cannot prove pixels), the offline preview mirror, store mutators, and the palette.

## Gotchas
- **`effectId` on a node is an `EffectDef` id, not a generator id.** The web mints them as
  `gen:<generatorId>`; core must never assume that shape. If your node needs an effect the author
  did not choose, register a reserved def in `engine.setShow` (and the sim constructor) — see
  `spliceFillEffectDef`.
- **Multi-option controls overflow the Node editor at `layout="row"`.** Hit four times now: a
  3-up SegmentedControl (reset node, splice), a 4-up (splice wait mode), a wordy 4-up (splice
  order — that one became a `Select`), and `EasePicker`, which is a Select PLUS a direction
  control. Use the default stacked `Field` layout for anything wider than one control.
- **An empty-string option value reads as UNSET to `Select`**, which then shows its placeholder
  instead of the option's own label. Use a sentinel (`@none`) for "nothing selected" entries.
- Two controls side by side in an inspector row truncate at the panel's real width — one per line.
- Seed new nodes with working CONTENT in `addNode`. A node that renders nothing on its first hit
  reads as broken, not as unconfigured.
- Store mutators need the `isViewer` guard, the kind guard, and `pushUndoSnapshot()` — a node with
  many settings is better served by ONE patch-based setter than fifteen near-identical ones.
- The single-client lock makes a second browser a VIEWER, and every authoring mutator silently
  no-ops there. When driving the app live, check `store.isViewer` first and call `store.takeover()`.
  **`takeover()` STEALS the slot from whoever holds it — including Trent's own open window**, which
  then goes read-only with no obvious cause (`<fieldset disabled={!store.canEdit}>` greys the whole
  inspector and node deletion). Close the automation tab when finished; the human's window reclaims
  the slot on reload or via the TopBar's Takeover. Prefer headless `pnpm ui-shot` over driving the
  live app precisely because it does not fight over this lock for long.
- A store mutator's KIND GUARD is the easiest place to break a new node kind: `setScope` /
  `setTargetId` / `setMode` and friends enumerate the kinds they accept, so a new kind is silently
  read-only until it is added to each list. Symptoms look like an engine bug (the control does
  nothing) while the engine is fine. Test that the STORE can set it, not just that the engine
  honours it.

## Verify
- [ ] `pnpm typecheck` (the exhaustive maps are the checklist).
- [ ] `pnpm test`, including a prove-it-fails-first pass: neuter the new behaviour and watch the
      new tests go red.
- [ ] `pnpm design-system` regenerated if the palette/styleguide changed.
- [ ] `pnpm ui-shot` of the node card + its inspector, `--strict`.
- [ ] Live `:5173` check that it renders on the kit.

## Update Scaffold
- [ ] Record the slice in `.mex/ROUTER.md` "Current Project State".
- [ ] Bump `last_updated` on changed scaffold files.

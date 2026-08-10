# Reset node — re-spec as a wired modulator

**Status:** ready-for-agent · supersedes PR #156 (closed unmerged)
**Original author:** Tim (feature request + first implementation)
**Decision date:** 2026-08-10 (Trent)

## What the node does

A **Reset** node returns a `sequence` node's step position to its first child. A footswitch
fires it. The next hit plays step 1.

## The shape

The Reset node is a **modulator**. It does not sit in trigger flow.

1. The Reset node lives in the **same graph** as the `sequence` node it resets.
2. A **wire** connects the Reset node to that `sequence` node, on a new `reset` port.
3. The Reset node carries its **own input source** (a MIDI note or an OSC address).
4. The Reset node fires only from that source. Trigger flow never reaches it.

Target the node by **wire**. Do not store a target on the node.

## Why not the cross-graph design

PR #156 stored `targetGraphKey` + `targetNodeId` on the node. That is a cross-graph
reference. Two faults follow.

**Fault 1 — copies break.** `cloneSongGraphs` (song duplicate) and `clipdoc.remapGraph`
(copy/paste) copy graph nodes verbatim. Neither rewrites the target. A duplicated song
therefore resets the **source** song's sequencer. The old graph key still exists, so the
screen shows no error. Confirmed by test on 2026-08-10.

**Fault 2 — the design needs an escape.** A Reset node inside trigger flow fires on every
pad hit, so the sequence can never advance. PR #156 escaped this with an entry licence
(`ownSourceEntryIds`) threaded through the evaluator.

A wire is graph-internal. `structuredClone`, `cloneSongGraphs` and `clipdoc.remapGraph`
copy edges correctly today. Fault 1 disappears. A modulator is outside trigger flow, so no
hit can reach it. Fault 2 disappears.

This also matches the project rule: reuse is **visible wiring**, not a hidden link.

## Locked decisions

| Question | Decision |
|---|---|
| Target | A wire to the `sequence` node, on a `reset` port |
| Cross-graph targets | Removed. Same graph only |
| Input | The Reset node has its own source (MIDI or OSC) |
| Trigger flow | The Reset node stays outside it |
| Scope | Sequence step position only. `lastPick` and `latched` stay unchanged |
| A Reset node with no wire | The lint flags it |
| Layered slots | One fire resets **all** slot counters of that node |
| One pedal, many graphs | Put one Reset node in each graph. Bind each to the same note |

## Keep this work from PR #156

Tim built this correctly. Carry it over:

1. `evalFromNodes` — enter eval at a node instead of at the Trigger.
2. `resolveDirectResetNodes` — route an input to a node's own source.
3. The `direct-reset` resolution path and `ResolvedGraph.entryNodeId`.
4. The `reset-node` MIDI-learn target.
5. `isResetStateKey` — the state-key sweep. See the note below.
6. **The sim parity fix.** `sim.ts` passed the constant `'preview'` as the state prefix for
   every graph. This pooled all sequence, random and toggle state into one bucket. It is an
   independent fault. Keep the fix whatever happens to the Reset node.

## Delete this work from PR #156

1. `targetGraphKey` and `targetNodeId` on `GraphNode`.
2. `ownSourceEntryIds` threading through `evalGraphGen3From` and `evalGraphGen3FromPlan`.
3. The bound/unbound asymmetry and its tests.
4. The "runs before its children" ordering rule.
5. `views/reset-target.ts` and the cascading Graph/Sequence dropdowns.
6. The `target missing` dangling state.

## The state-prefix requirement

Eval state uses the key `` `${statePrefix}#${nodeId}` ``. The prefix encodes the firing
path:

- pad fallback or direct binding → the bare graph key → `<key>#<nodeId>`
- section slot → `<key>#<slotIndex>` → `<key>#<slot>#<nodeId>`

One graph layered into two slots gives its `sequence` node **two** step counters. The Reset
node fires under the bare graph key. So a sweep is still necessary: clear every prefix the
target node runs under.

Keep `isResetStateKey`. Change one thing: **derive the graph key from the firing context**
(the engine holds `resolved.graphKey`). Do not read it from the node. A derived key cannot
go stale when a song is copied.

## Acceptance

1. A Reset node wired to a `sequence` node in the same graph, bound to a MIDI note, returns
   that sequence to step 1.
2. Pad hits do not fire the Reset node.
3. Duplicate a song that holds a Reset node. The copy's Reset node resets the **copy's**
   sequence node. The source song stays unchanged. **Add a test for this.**
4. Copy and paste that song into a second show. The Reset node still resets its own graph.
5. A graph layered into two section slots resets both counters on one fire.
6. A Reset node with no wire is flagged by the lint.
7. `pnpm typecheck` gives 0 errors. `pnpm test` exits 0.
8. `pnpm ui-shot` captures the node and the inspector. Regenerate `docs/design-system.html`.

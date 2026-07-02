# 09 — Trigger-graph "blank nodes" bug (2026-07-01 incident)

> Part of the 2026-07-02 "rock solid" initiative. See [INDEX.md](INDEX.md).

## Incident report

With a node **selected**, connecting a wire to it wouldn't take. Then **all node cards went
blank**, the blank state persisted across switching to other graphs, and a page refresh fixed it.
Stack: Svelte 5 runes + @xyflow/svelte 1.6, after PR #37 (graph-scoped projection reuse).

## Status: NOT reproduced/confirmed — ranked hypotheses + an instrumentation plan

The exploration produced candidates, not a confirmed root cause. The PRD slice should be
**instrument-first**: land the diagnostics + defensive hardening below, then fix whichever
candidate the telemetry convicts (or accept that the hardening itself was the fix — several
candidates are eliminated by it wholesale).

### Candidate 1 — module-level projection cache goes stale on an error path (most likely)

`apps/web/src/lib/app/views/trigger-flow-projection.ts:29-36` holds a **module-level**
`projectionCache` (graphKey + per-node signatures). It is only written at the successful end of a
projection (`TriggerGraphView.svelte:128-131`, `projectionCache = projected.cache` at :130). Any
throw between projection start and that assignment leaves cache and rendered `nodes` array
disagreeing; every subsequent projection then reuses/rebuilds against stale signatures. Blankness
persisting **across graphs** fits module-level state surviving graph switches (both graphs share
the `'trigger'` root node id); refresh resetting it fits module reload.

### Candidate 2 — uncaught throw inside an xyflow event handler kills the effect chain

`TriggerGraphView.svelte:167-194` — `onConnect`/`onReconnect`/`onConnectEnd` call
`store.connect(...)` / `store.reconnect(...)` (validation in `store/graph-wiring.ts:25-35`) with
**no try/catch**. A throw propagates into xyflow's internal handler and can break Svelte's effect
tracking — the `$effect` at :140 stops re-running `rebuildNodes()`, the `nodes` array freezes, and
`NodeCard`s that derive display data via store lookups by node id
(`store.selectedGraph?.nodes.find(...)`) render blank when the frozen flow-nodes reference ids the
current graph no longer resolves. The failed wire-connect Trent saw immediately before the
blanking is consistent with a validation/DOM-hit-test edge (the drop-anywhere-on-node hit-test
path) throwing mid-gesture with a node selected.

### Candidate 3 — nodes/store desync during graph switch mid-gesture

`TriggerGraphView.svelte:122-132` projects inside `untrack()` (the anti-snap design); if a
connect-gesture failure interleaves with `selectedGraph`/`selectedPadKey` changing, a projection
can run against a stale graph reference, caching flow-nodes whose ids don't exist in the now-
current graph → blank lookups. (:140-145 `$effect` triggers.)

### Candidates 4-6 (lower)

Shared `'trigger'` root id reuse across graphs interacting with the reuse map; selection state
(`wantSel`, `trigger-flow-projection.ts:34-37`) marking a same-id node selected across a switch
(`openGraph`/`shell.clearSelection`, TriggerGraphView :56-60); xyflow 1.6 internal state
corruption after an optimistically added edge is reverted by `rebuildEdges()`
(`GraphCanvas.svelte:111-115`) — check the @xyflow/svelte changelog for connection-handling fixes
before assuming.

## Hardening plan (do all of these regardless of which candidate is guilty)

1. **Error boundaries on every xyflow callback** (`onConnect`, `onReconnect`, `onConnectEnd`,
   drag/drop hit-test): try/catch → `console.error` + a Monitor `error` event (the bus exists) so
   a live-show failure is visible in Monitor instead of silently corrupting the canvas. After the
   catch, force a full projection rebuild (cache reset) — self-heal instead of refresh.
2. **Exception-safe cache discipline**: reset `projectionCache` to the empty sentinel at the START
   of a projection for a new graphKey, and write-through only on success; add a
   `resetProjectionCache()` export used by the error path and by `openGraph`.
3. **Dev-mode desync assertion** in `rebuildNodes`: if any rendered flow-node id is missing from
   `store.selectedGraph.nodes`, log the full diagnostic object (cache graphKey, current graphKey,
   both id sets) — this is the telemetry that convicts candidate 1 vs 3.
4. **Blank-proof NodeCard**: derive node display data from the flow-node's own `data` payload
   (already carried by `graph-to-flow.ts`) rather than a secondary store lookup by id where
   possible; where a lookup is required, render a visible "stale node" placeholder instead of an
   empty card (a blank card told us nothing for a day).

## Repro attempt script (for verification)

Select a play node → drag a wire from another node's output and drop it on the selected node's
body (DOM hit-test input path) → repeat rapidly; also try dropping onto the selected node while
its inspector has focus, and mid-drop graph-switch via the section list. Watch console + Monitor
with hardening step 3 active.

## Touch list

- `apps/web/src/lib/app/views/TriggerGraphView.svelte` (:56-60, :122-145, :167-194, :226-230)
- `apps/web/src/lib/app/views/trigger-flow-projection.ts` (cache lifecycle)
- `apps/web/src/lib/app/views/GraphCanvas.svelte` (:111-115), `graph-to-flow.ts`, `NodeCard`/
  `TriggerNode` data derivation
- `apps/web/src/lib/trigger-lab/store/graph-wiring.ts` (validation must return, never throw)

## Tests

- graph-wiring: all invalid connects/reconnects return (never throw) — fuzz the input space
  (unknown ids, self-connect, cross-graph ids, port mismatches) as pure tests.
- Projection: error-injected projection leaves cache reset; next projection rebuilds cleanly;
  same-id nodes across graph switch rebuild from the new graph (extends PR #37's regression suite).
- Component (jsdom): a NodeCard whose id is missing from the store renders the placeholder, not
  an empty card.

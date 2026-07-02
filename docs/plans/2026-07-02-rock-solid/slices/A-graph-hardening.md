# Group A — Graph editor hardening

Context: [doc 09](../09-trigger-graph-blank-bug.md) · Parent PRD: #45 · Stories: 51–52

## S01 — Graph editor hardening `ui-significant`

**Blocked by:** none — land this before any graph-model slice (H/I build on it).

**What to build:** Instrument-first hardening of the trigger-graph view so editor faults can
never silently blank the canvas until refresh. Wrap every xyflow event callback (connect,
reconnect, connect-end, drag/drop hit-test) in error boundaries that report to the Monitor as
error events and self-heal by resetting the projection cache and forcing a full rebuild. Make the
projection-cache lifecycle exception-safe (reset at projection start for a new graph, write-through
only on success, exported reset used by error paths and graph-open). Add a dev-mode desync
assertion (rendered flow-node ids vs store graph ids, with full diagnostic logging). Render a
visible "stale node" placeholder instead of an empty card when node data fails to resolve.
Wiring validation must return rejections, never throw (fuzz the invalid-input space).

**Acceptance criteria:**
- [ ] An injected throw inside any flow event handler produces a Monitor error event and the next
      projection rebuilds cleanly (no stale cache, no blank cards)
- [ ] Projection error paths leave the cache reset; same-id nodes across graph switches rebuild
      from the new graph (extends the PR #37 regression suite)
- [ ] A NodeCard whose id is missing from the store renders the placeholder (jsdom component test)
- [ ] Wiring validation never throws for unknown ids, self-connects, cross-graph ids, or port
      mismatches (pure fuzz tests)
- [ ] Full sweep green (typecheck + tests)

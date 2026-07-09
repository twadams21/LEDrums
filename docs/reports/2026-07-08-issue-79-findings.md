---
title: Issue 79 implementation findings
last_updated: 2026-07-08
---

# Issue 79 Implementation Findings

## Opportunistic Notes

- `packages/core/src/voice/eval-graph.ts` already had Gen3 token-propagation semantics embedded directly in the evaluator. Extracting graph categorisation/adjacency into a compiled render plan should reduce future traversal patches without changing the public `evalGraph(...)` seam.
- The new Mix-to-Mix acceptance test exposed a remaining scheduler issue: a downstream Mix could collect before an upstream pending Mix emitted, producing a partial first action. The evaluator now waits only on pending upstream Mix collectors, avoiding both partial nested mixes and broad collector deadlocks.

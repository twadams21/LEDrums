# R18 — Render-plan compile caching keyed by structure signature (GH #97)

Read first: `docs/prompts/gen3-remediation/CONVENTIONS.md`, then
`gh issue view 97 -R twadams21/LEDrums`, then the parent spec's Phase 4.3
(`docs/plans/2026-07-09-gen3-ux-remediation-spec.md`).

Cache the compiled render plan across trigger hits so fast rolls don't
recompile the graph per hit. Key by a structure signature invalidated on
edit — in-place store mutation makes object-identity caching unsafe.
Determinism preserved; parity test proves output identical with and
without the cache.

Context:
- Phase 3 semantics are settled AND post-review-fixed: R13 (overlap
  re-composition), R14 (fan-in coalescing), and the P3 fix (superseded-
  voice release) are all in your branch history — read
  `docs/reports/2026-07-09-gen3-p3-{review,fix-overlap}.md` so you know
  the eval/engine state you're caching around. The cache is for the
  COMPILE step (`compileRenderPlan`), not eval state.
- Core purity: the cache must be engine-owned/injected state (like
  `mixMemberSnapshots`), not a module-level global — keep eval pure and
  deterministic given (time, inputs, model).
- Prior art for structure signatures: the web projection's
  `triggerNodeSignature` (R01 folded edge sets into it) shows the shape
  of signature-invalidation thinking, but yours lives in core and must
  cover everything compile reads (nodes, edges, params that affect plan
  structure).

Core-seam tests: unchanged graph reuses the plan (identity or
counter-based proof), each structural edit class invalidates, parity.
No UI → no ui-shot.

Sibling note: R06 (lint badges) MAY add an issue code inside
compileRenderPlan and R12 (canvas) is running — coordinate-free rule:
don't change the issues emission logic, only wrap/ cache compile results;
avoid web files entirely unless the sim needs a mirror.

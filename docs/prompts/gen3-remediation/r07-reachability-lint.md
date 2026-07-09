# R07 — Reachability lint rules: no path to Output, dead branches (GH #86)

Read first: `docs/prompts/gen3-remediation/CONVENTIONS.md`, then
`gh issue view 86 -R twadams21/LEDrums`, then the parent spec's Phase 1.5
(`docs/plans/2026-07-09-gen3-ux-remediation-spec.md`).

Third and final slice of the lint surface. A pure reachability pass in
core feeds two new issue codes: an Effect/branch with **no path to the
terminal Output anchor**, and a transform/collector with **no possible
layer input** — strip entry + node badge each, with copy like "Not
reaching Output — wire this to Output to render". After this, every
wired-but-renders-nothing state is explained.

Build on (in your branch history — read these first):
- **R06** just landed the full pattern you extend: `scope-lint.ts` (pure
  core pass, non-fatal issue code from `compileRenderPlan`),
  `GraphLintIndex` (strip↔badge fed by one issue list), badge treatment on
  the node face, `lintEntries` copy table, `empty-scope` seam state.
  Yours is the same shape: one pure pass in core (`reachability-lint.ts`),
  codes registered in `compileRenderPlan` (non-fatal), copy entries in
  `graph-lint.ts`. NO new UI machinery should be needed.
- **R04 auto-wire** means a fresh Effect usually IS wired — your lint
  catches the states users still reach (deleted wires, spliced-out
  branches, imported/older graphs).
- **Cache note:** R18 caches compiled plans keyed by a STRUCTURE
  signature (nodes/edges). Reachability is pure structure — so unlike
  empty-scope, your issues can never go param-stale in the cache. See the
  invariant comment on `renderPlanSignature`; keep your pass reading
  structure only (ids/kinds/edges), and note it in your report.

Core-seam unit tests for the pass; component-seam test for the surfaced
rules; ad-hoc ui-shot of a no-path-to-Output badge+strip (extend the lint
seam state; NO shots.json entries).

Sibling note: R20 (store split) is running in the trigger-lab store —
stay out of `store.svelte.ts`.

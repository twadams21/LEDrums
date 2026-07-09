# R06 — Node lint badges + empty-scope promoted to node face and Output inspector (GH #85)

Read first: `docs/prompts/gen3-remediation/CONVENTIONS.md`, then
`gh issue view 85 -R twadams21/LEDrums`, then the parent spec's Phase 1.5
(`docs/plans/2026-07-09-gen3-ux-remediation-spec.md`).

Second slice of the lint surface. Lint findings anchor to the offending
node as a badge — strip entry ↔ node badge agree on the same finding. The
effective-scope-empty flag is promoted to the node face and shown as a row
in the Output inspector with actionable copy.

Build on (all in your branch history — read these first):
- **R05** landed `graph-lint.ts` (`lintEntries(issues)` with `nodeId?`
  already in its shape), `GraphLintStrip`, `lint-preview.svelte.ts`, and
  the `lint-issues` seam op. Extend that seam — one lint model, two
  surfaces (strip + badges). Note R05's finding: today's three compiler
  codes can't occur in authored graphs, so the empty-scope signal is
  likely YOUR ticket's first real, user-reachable lint. If empty-scope
  isn't yet a `compileRenderPlan` issue code, decide where it's computed
  (core compile vs web derivation) — prefer surfacing core truth; if you
  add an issue code to core, keep core pure and unit-test it.
- **R27** landed `AnchorHeader` + the current `OutputNodeInspector` shape
  (R26's Field rows). Add the empty-scope row per its conventions.
- Node faces: `TriggerNode.svelte` / node-card treatment — badge must
  respect the locked interaction contract (no motion, instant).

Component-seam tests (badge↔strip agreement, empty-scope derivation);
ad-hoc ui-shot states (badge on node face + Output inspector row); design
system regenerated if the badge is a new primitive.

Sibling note: R17 (sim type imports — touches sim.ts type lines) and R12
(canvas drag-over highlight + graph-row grips) are running. Coordinate-free
rule: you own the lint model, node-face badge, and Output inspector; don't
touch AddPalette, sections rows, or sim's type declarations.

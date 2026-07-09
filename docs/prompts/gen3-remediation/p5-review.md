# Phase 5 review — inspector polish (R25 #104 · R26 #105 · R27 #106)

You are the Phase 5 review gate for the Gen3 UX remediation initiative.
All three Phase 5 tickets are merged into `codex/gen3-graph-authoring`.

## Scope
- **R25** (#104) live signal previews in Random/Note/OSC inspectors — merge `ea2f0a8`-parented, report `docs/reports/2026-07-09-gen3-r25.md`
- **R26** (#105) inspector label rows → shared Field primitive (+`unit` prop) — merge `d39a39a`, report `...-r26.md`
- **R27** (#106) protected-anchor header (AnchorHeader) — merge `f197859`, report `...-r27.md`

Surfaces: `apps/web/src/lib/app/docks/inspectors/*`, `apps/web/src/lib/ui/
{Field,AnchorHeader}.svelte`, `apps/web/src/lib/app/views/NodeSignalPreview.svelte`,
`apps/web/src/lib/trigger-lab/signal-preview.ts`, styleguide sections.
NOTE: later tickets have since touched inspectors (R06 added an empty-scope
row to OutputNodeInspector; R13 added Mix y-order copy) — confine findings
to Phase 5's concerns; flag cross-ticket interactions rather than
re-reviewing other phases.

## How
Run `/code-review` over that scope, judged against the spec's Phase 5
(`docs/plans/2026-07-09-gen3-ux-remediation-spec.md`) + issue ACs:
- Previews truthful: `randomDistributionTrace` samples the SAME core
  distribution the engine uses; previews ride the shared ticker
  (viewport-gated, reduced-motion → static frame) — no per-frame compute
  in `$derived`, no leaks (rAF cleanup on unmount).
- Field migration behaviour-preserving: `unit` prop row-only; no regressed
  label rhythm; R26's documented out-of-scope rows genuinely out of scope
  (not half-migrated).
- AnchorHeader: output branch ordering in Inspector.svelte can't shadow
  other kinds; remove-button absence only for anchors.
- Design system: styleguide entries exist for Field `unit`, AnchorHeader,
  NodeIconChip usage in previews if any; design-system.html current
  (regenerate to CHECK drift only — do not commit a regen; report drift).
- A11y: previews have text/readout equivalents (not canvas-only meaning).

Do NOT modify code. Scoped tests only (workers capped per CONVENTIONS);
own dev-server port for ui-shot checks.

## Deliverables
1. Committed review report `docs/reports/2026-07-09-gen3-p5-review.md` on
   branch `gen3r/p5-review-report` (blocking / should-fix / nit, each with
   file:line + concrete failure scenario).
2. `twux send-message --session parent --status done --body "P5 review:
   <counts>. Branch ..., report ..."`

# R05 — Graph lint strip fed by render-plan compile issues (GH #84)

Read first: `docs/prompts/gen3-remediation/CONVENTIONS.md`, then
`gh issue view 84 -R twadams21/LEDrums`, then the parent spec's Phase 1.5
(`docs/plans/2026-07-09-gen3-ux-remediation-spec.md`).

A lint strip on the trigger-graph surface renders the render-plan
compiler's issues — `compileRenderPlan().issues` is computed today but
consumed nowhere in the web app. Each entry's copy is short, plain, and
says what to do next. The strip is absent when there are no issues.

Notes:
- Find where the web app already calls (or should call) `compileRenderPlan`
  — surface the existing issues, don't invent a second linter. If issue
  variety is thin, that's fine: render what exists; R06/R07 (queued behind
  you) extend the lint surface.
- Recent graph-surface changes in your branch history: R03 (in-drag
  validation + toasts), R08 (wire-splice arming). The lint strip is a
  separate, persistent surface — complementary to R03's transient toasts;
  don't reuse toasts for lint.
- Design system: compose from existing primitives; if the strip is a new
  reusable composite, add a styleguide entry + regenerate
  `docs/design-system.html` in the same change. Apply
  `/make-interfaces-feel-better`.
- ui-shot: a state op for a graph WITH lint issues (extend the shot seam;
  NO shots.json entries) + capture with --strict.

Component-seam test per acceptance criteria. Sibling note: R27
(Output/Trigger inspectors) and a P3 review agent are running — stay out
of the inspector components and packages/core eval.

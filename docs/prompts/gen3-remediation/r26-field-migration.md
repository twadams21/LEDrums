# R26 — Inspector label rows migrate to the shared Field primitive (GH #105)

Read first: `docs/prompts/gen3-remediation/CONVENTIONS.md`, then
`gh issue view 105 -R twadams21/LEDrums`, then the parent spec's Phase 5.2
(`docs/plans/2026-07-09-gen3-ux-remediation-spec.md`).

Mechanical, behaviour-preserving sweep: every hand-rolled inspector label
row migrates to the shared Field primitive so label rhythm is one
implementation. R25 just landed (live previews in the Random/Note/OSC
inspectors — in your branch history), so migrate its new rows too if any
are hand-rolled.

Watch-outs:
- Behaviour-preserving means pixel-faithful: ui-shot spot-check each
  migrated inspector before/after (ad-hoc captures, NO shots.json entries).
- If the Field primitive needs a variant to absorb an existing row shape,
  extend the primitive + its styleguide entry and regenerate
  `docs/design-system.html` in the same change (AGENTS.md non-negotiable).
- Sibling agents are running: R13 (packages/core eval + Mix inspector copy)
  and R03 (graph canvas / wiring). R13 may touch the Mix inspector's copy —
  if the Mix inspector is in your sweep, keep your change purely structural
  (row markup only) to minimize conflict surface, and note it in your report.

Acceptance criteria are on the issue: no visual regression, full gates
green (`pnpm gates`), design system regenerated.

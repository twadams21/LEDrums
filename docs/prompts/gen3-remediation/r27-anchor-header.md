# R27 — Protected-anchor header treatment for Output/Trigger inspectors (GH #106)

Read first: `docs/prompts/gen3-remediation/CONVENTIONS.md`, then
`gh issue view 106 -R twadams21/LEDrums`, then the parent spec's Phase 5.3
(`docs/plans/2026-07-09-gen3-ux-remediation-spec.md`).

Output (and Trigger) anchor nodes stop rendering a kind selector with no
valid option — protected anchors get a proper header treatment in the
inspector instead. Non-anchor nodes keep the kind selector unchanged.

Context that matters:
- A recent fix kept `output` a protected anchor in `KIND_OPTS`
  (`apps/web/src/lib/app/views/node-options*`) — read that code + its test
  first; your change is the UI half of that story.
- **R26 just landed** (in your branch history): inspector label rows use
  the shared `Field` primitive, and `OutputNodeInspector` was one of the
  migrated files — build on its current shape, don't regress the Field
  rows.
- Design language: tabbed-header style is the reference title treatment
  (memory `ui-design-language`); compose from the design system, and if the
  header treatment is new + reusable, add a styleguide entry and regenerate
  `docs/design-system.html` in the same change.

Acceptance criteria are on the issue: header instead of empty kind
selector on Output/Trigger, non-anchors unchanged, component test, ad-hoc
ui-shot of the Output inspector (NO shots.json entries).

Sibling note: R08 (graph canvas splice) and a P3 review agent are running
in parallel — stay out of GraphCanvas/wiring and packages/core.

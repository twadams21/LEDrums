# R09 — Add pane search across all node categories (GH #88)

Read first: `docs/prompts/gen3-remediation/CONVENTIONS.md`, then
`gh issue view 88 -R twadams21/LEDrums`, then the parent spec's Phase 2.1
(`docs/plans/2026-07-09-gen3-ux-remediation-spec.md`).

A search field in the Add pane filters the whole node vocabulary (all
categories, not just the open one). Active query → flat list grouped by
category, same NodeCard previews as browse; cleared query → the existing
two-stage category browse. Reuse the shared SearchField primitive from
`apps/web/src/lib/ui/`.

This is UI work: apply `/make-interfaces-feel-better`, take a `pnpm ui-shot`
of the search state, and regenerate the design system if the styleguide
gains anything. Prior art: existing Add pane component tests.

Sibling note: R10 (category tile chips) is queued behind you on the same
pane — don't restyle the category tiles or empty state.

# R10 — Add pane category tiles get node-style icon chips; empty state de-carded (GH #89)

Read first: `docs/prompts/gen3-remediation/CONVENTIONS.md`, then
`gh issue view 89 -R twadams21/LEDrums`, then the parent spec's Phase 2.2
(`docs/plans/2026-07-09-gen3-ux-remediation-spec.md`).

Two visual fixes in the Add pane (`AddPalette` area, same pane R09
reworked — R09's search across categories is in your branch history; don't
regress it):
1. Stage-1 category tiles carry the same icon-with-tinted-background
   treatment as the node icon chips (see the NodeCard / kind-icon chip
   treatment — `trigger-node-meta` tint/kindIcon are the existing source of
   node visual language). Categories should read as part of that language.
2. The empty-state text loses its card chrome — plain text, not an empty
   box presented as content.

Apply `/make-interfaces-feel-better`. Compose from the design system; if
the tinted chip becomes a shared primitive rather than local styles, add a
styleguide entry + regenerate `docs/design-system.html` in the same change.

ui-shot the Add pane states (default tiles, search results via the
existing `search:` seam op, empty state via a nonsense query) --strict;
NO shots.json entries.

Sibling note: R27 (Output/Trigger inspectors) and a P3 fix agent
(packages/core voice) are running — stay out of the inspector components
and core.

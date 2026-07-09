# R11b — Sections DnD polish: drag visuals + vertical section insert-line (Trent feedback)

Read first: `docs/prompts/gen3-remediation/CONVENTIONS.md`, then R11's report
(`docs/reports/2026-07-09-gen3-r11.md`) and the P2 review
(`docs/reports/2026-07-09-gen3-p2-review.md`). This is direct user feedback
from Trent on the shipped R11 Sections DnD, with a screenshot-verified
repro. Three items:

## 1. Kill the blue/cyan outline-wash on the section while dragging
While dragging (graph or section), the active section column wears a
cyan/blue focus-ish outline + background wash. Trent: "I don't like the
blue background when I'm dragging a section." Find where that treatment
comes from (likely the active-section outline or a drag-over state on
`.col` in `SectionColumn`/`SectionsView`) and remove/neutralize it during
drags — drag indicators should be the accent-green language R11 built
(insert line / target treatment), not the blue selection language.

## 2. Fix the dragged-graph-row visuals
Dragging a graph row looks broken: the native HTML5 drag ghost renders the
full row (grip + icon + labels + status dot + a stray ✕ button) semi-
transparent and OVERLAPPING the original row, which is still visible at
full layout — double "Tom1" text, misaligned. Fix direction (pick what
reads best, verify by eye with ui-shot + your own judgment):
- Give the drag a clean custom drag image (e.g. a compact card: icon +
  name only) via `setDragImage`, or suppress the ghost and pin a styled
  preview; and
- While a row is the drag source, collapse/dim the original row (e.g.
  `opacity` + no layout jump) so there's one clear "this is moving"
  representation, not two.
- The ✕ (remove) affordance must not render in the ghost.

## 3. Section reorder: vertical insert-line INSTEAD of target highlight
Trent: when dragging a SECTION (column reorder), show a **vertical
insert-line in the gap between columns** (the vertical twin of R11's
horizontal graph insert-line) rather than highlighting the section column
that would be displaced. Replace the `.section-target` outline treatment
for section drags; graph drags keep their horizontal line. Update the
`sections-reorder` preview rune/seam op to pin the new state (R11's
`sectionsDndPreview` — adjust its `section` variant to carry the gap
index).

Notes:
- Trent ruled the 120ms insert-line enter animation is FINE (P2-S1) —
  keep that treatment for both lines.
- Design language: accent-green, same stroke/glow family as the existing
  graph insert-line. Apply `/make-interfaces-feel-better`.
- ui-shot all three states ad-hoc (`sections-insert`, updated
  `sections-reorder`, and a pinned drag-source row if reachable) with
  --strict; NO shots.json entries. Design-system regen only if you touch
  styleguide-covered primitives.
- Component tests where the logic is testable (gap-index derivation).

Sibling note: R21 (trigger-lab store split) and R07 (core lint) are
running — stay inside the Sections view components + their preview runes.

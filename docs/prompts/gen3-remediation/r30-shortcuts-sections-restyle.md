# R30 — App keyboard-shortcut interception + Sections view restyle (Trent, 2026-07-09)

Read first: `docs/prompts/gen3-remediation/CONVENTIONS.md`. Two scoped items.

## 1. Keyboard shortcut interception seam
Build one app-level shortcut seam that CLAIMS browser-default shortcuts for
the app: a capture-phase `keydown` listener on `window` that matches
registered combos, calls `preventDefault()` + `stopPropagation()`, and
dispatches the app action. Facts to respect:
- Interceptable in a normal tab: Ctrl/Cmd+D, Ctrl/Cmd+S, Ctrl/Cmd+K,
  Ctrl/Cmd+O, Ctrl/Cmd+P, F-keys, etc. NOT interceptable (browser
  reserves): Ctrl/Cmd+W, Ctrl/Cmd+T, Ctrl/Cmd+N, Ctrl+Tab. Document this
  in the module header.
- Never intercept while focus is in a text input/textarea/contenteditable
  (existing typing must win) unless the combo is explicitly marked
  global.
- Registry is data (combo → action + description), so a future shortcut
  help sheet can render it. Wire the EXISTING undo/redo path through it
  (don't duplicate its handler — relocate it), and claim **Ctrl/Cmd+D =
  duplicate selected node** in the trigger graph (store has node add/
  clone machinery; if no clean duplicate mutator exists, implement the
  minimal one: same kind+params, offset position, wired to nothing —
  auto-wire will handle effects). If duplicate turns out non-trivial
  (>~an hour), ship the seam + undo/redo migration + Ctrl+D reserved
  with a toast "duplicate coming", and say so in your report.
- Unit-test the matcher (combo parsing, input-focus guard, mac/win
  modifier normalization).

## 2. Sections view restyle → match Objects view + trigger-graph thumbs
Trent: "update the colours and style of the Sections view to match the
Objects view (square, different background colour), and the surface colour
from the graph thumbs from the trigger graph view."
- Study `ObjectsView`'s card/tile treatment (corner radius — square(r),
  background tokens) and the trigger graph view's graph-thumbnail surface
  colour. Apply that language to the Sections view: section columns +
  graph rows adopt the Objects-style geometry/background family; the
  graph row/thumb surfaces use the trigger-graph thumb surface colour.
- Design-system tokens only — no new hex values; if a token is missing,
  add it to the styleguide + regenerate `docs/design-system.html` in the
  same change. Apply `/make-interfaces-feel-better`.
- Do NOT regress the R11/R11b DnD affordances (insert lines, grips, drag
  image) — re-capture their states after restyling.
- ui-shot before/after of Sections view (+ the DnD pinned states)
  --strict; NO shots.json entries.

Full `pnpm gates` before reporting. Report: docs/reports/2026-07-09-gen3-r30.md.
No sibling agents are running — the store and views are all yours, but keep
the two items in SEPARATE commits.

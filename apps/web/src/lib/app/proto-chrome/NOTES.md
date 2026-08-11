# PROTOTYPE — tabbed chrome exploration (throwaway)

**Question:** should the app chrome move from the left-rail layout to a tabbed layout —
views as a top tab bar, setlist songs + sections as sticky header bars, transport/status
at the bottom — and can the Patch Graph leave the workspace entirely (into Settings)?

**Run:** `pnpm dev`, then open `http://localhost:5173/?proto=chrome`.
Variants switch via the floating pill (bottom-centre) or `?proto=chrome&variant=B|C`.

- **A — current layout**: the pill's "A" just navigates to `/` (the real app).
- **B — tabbed chrome, Patch Graph in Settings**: 3 sticky bars (nav tabs · songs ·
  sections), bottom transport + status bar, Trigger tab gets the Graphs list as a left
  pane. Settings is a large sectioned modal; Patch section has an **Open Patch Graph**
  button → large modal hosting the real canvas; **double-click a node** there → its
  Inspector opens as a stacked modal.
- **C — same chrome, no patch graph**: Settings expresses the entire patch as
  lists/forms (Drums & Hoops · Outputs & Chains · Controller). Edit controls are
  rendered but inert (toast) — the question is "can the format express it", not wiring.

Real where cheap: real `TriggerLab` store + engine link, real views (Perform / Objects /
Sections / Trigger / Monitor), real songs/sections/graphs data, real PatchGraphView in
the B modal. Static/inert: variant C's patch forms, a few chrome affordances.

**Known simplifications (not design verdicts):**

- The persistent right column (Kit visualizer + Buses/Layers) has no home in the tabbed
  chrome yet — it is simply absent here. Open question for D/E variants.
- Presence/takeover indicator and Backups/ShowBrowser entry points are not carried over.
- Global perform hotkeys (1–9 fire, ←/→ section) are not wired on the proto route.
- B's patch modal hides the canvas-side Inspector dock (`.idock`) via CSS and re-routes
  editing to the double-click modal.

## Verdict

_(fill in after review — which variant won, what D/E should change, then fold into the
real shell and delete this directory + the `?proto=chrome` mount in `main.ts`)_

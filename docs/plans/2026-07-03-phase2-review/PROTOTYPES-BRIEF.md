# Prototype brief — 4 design-decision mockups (throwaway)

**For:** a one-off opus/low agent. **Output:** 4 self-contained plain HTML files in `~/TWA/ledrums-prototypes/` (Trent's vault). **Quality bar:** throwaway prototypes to make decisions with — fast, annotated, honest about trade-offs. NOT production code, NOT app code; do not touch any repo.

## Context

LEDrums is a Linear-inspired, dark (Resend-dark) real-time lighting app. Its Trigger graph is a node editor (play/effect nodes, modifier nodes, modulation nodes: envelope/LFO/CC) on an xyflow canvas, with a right-side dock: 3D visualiser on top (~300px), tabbed Inspector/Monitor below (currently cramped, ~200px). Trent must choose between design directions; each file shows the options side by side (or with a variant switcher) so he can compare and pick.

Design language for all mockups:
- Very dark: page bg ≈ `#0A0A0B`, surfaces `#101012` / `#141417`, borders `#232329` (1px), text `#EDEDEF` / muted `#8A8A93`.
- Accent ≈ `#5E6AD2` (Linear indigo). Coloured chips/pills/badges like Linear/Resend (small, rounded, tinted bg + saturated icon/text).
- Icons + tooltips, never text-label buttons. Inter/system-ui, 12–13px UI text, tight letter-spacing on uppercase micro-labels.
- Node cards: rounded-lg, 1.5px border, subtle header row with kind icon + name, small param rows. Wires: bezier curves, accent when active.
- Fake all content with plausible LEDrums data (nodes named "Chase", "Confetti", "Delay", "Envelope", "LFO"; drums: Kick/Snare/Tom 1/Tom 2; hoops).

Each file: `<title>`, a header explaining the decision in one paragraph, then the variants, each with a caption listing 2-3 pros/cons. Pure HTML+CSS (inline `<style>`); tiny vanilla JS allowed for variant toggles/hover. No external assets/CDNs. Desktop-width layouts (~1440px) but don't break at 1100px.

## File 1 — `decision-1-add-flow.html`

How should nodes be added to the graph? Today: top-bar "Add" buttons open a type-picker modal, and new nodes drop at viewport centre, stacking/overlapping (hated). Show three variants as full-app-shell mockups (static canvas with a few nodes):

- **A. Modal (status quo, improved):** keep top-bar buttons + the modal Trent likes (category filter chips, grid of node types with mini-previews), but new nodes spawn at a smart free position (show a ghost landing slot).
- **B. Drag-and-drop drawer:** a sticky right slide-over drawer (collapsible rail of node types, grouped: Sources / Effects / Modifiers / Modulation), drag a type onto the canvas, node lands where dropped (show a mid-drag ghost).
- **C. Hybrid:** drawer for browse+drag, but clicking a drawer item still opens the modal's richer detail/preview. Note chrome implications (drawer coexisting with the inspector rail).

## File 2 — `decision-2-inspector.html`

The Inspector is too short (visualiser eats the dock) and sometimes covers too little. Show the same selected play-node inspector content (name, params with sliders, modulation rows) in three shells:

- **A. Full-height right rail:** inspector owns a full-height right column; visualiser relocates (show it docked bottom-centre or as a floating resizable panel).
- **B. Slide-over sticky drawer:** canvas gets full width; selecting a node slides a drawer over the right edge (sticky while selection exists, dismissable); visualiser stays top-right.
- **C. Status quo (reference):** current stacked visualiser-over-inspector dock, drawn honestly cramped, for comparison.

## File 3 — `decision-3-modifier-order.html`

Chained/parallel modifiers apply in y-position order (top→bottom) — currently invisible; moving a node vertically silently changes the render. Show on a small graph (play node + 3 modifiers):

- **A. Numbered order chips:** each modifier node wears a small numbered chip (①②③) showing execution order derived from y-position; hovering the play node highlights the chain in order.
- **B. Explicit reorder list:** the play node's inspector shows a drag-to-reorder "Modifier chain" list; canvas y-position becomes purely cosmetic. Chips still show the explicit order.
- Note the trade-off: spatial-implicit (A) vs explicit-model (B).

## File 4 — `decision-4-envelope-trigger.html`

NOT a UI-chrome mockup — a semantics diagram page. Trent wants envelopes to be trigger-startable with a delay offset. Two candidate semantics; draw each as horizontal timelines (CSS boxes/gradients fine, or inline SVG):

- **A. Delay shifts phase start:** trigger fires → delay D elapses → envelope starts its 0→1 phase; the mapping outputs the envelope's value from its own t=0. Show 2 overlapping retriggers (voices overlap, each envelope runs full course).
- **B. Delay gates the whole mapping:** the mapping contributes nothing until D elapses, then the envelope phase is computed from the ORIGINAL trigger time (envelope may already be mid-flight when it becomes audible/visible).
- Show both against the same drum-hit timeline, annotate the perceptible difference (A = everything feels shifted later; B = late "join in progress"), and include a small mock of what the envelope node's extra inputs would look like (trigger-in handle + delay param row).

## Report

When all 4 files exist, report back:
`twux send-message --session parent --status done --body "<one line per file: path + what it shows>"`
Do not commit anything anywhere; the vault files are the deliverable.

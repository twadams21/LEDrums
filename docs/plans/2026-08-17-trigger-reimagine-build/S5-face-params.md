# S5 — Face params: on-canvas controls riding the modulation param rows

**Effort: opus/high (rides the modulation seam) · branch `feat/face-params` off S3's branch
tip (the inspector interactions it unifies with live in S3's drawer world) · PR into main
(stacks above S3).** Visual reference: `docs/proto/trigger-canvas-controls.html` option 1 on
`proto/trigger-reimagine` @ `e06b726`.

## The verdict (doc §4) — the mechanism IS the point

Trent: "go with 1, but ride along the existing add parameters to the node to allow control
with modulation nodes." The params promoted onto the node face must be the **same exposed-param
rows the modulation system already uses** — `node.modInputs`, rendered in `TriggerNode.svelte`'s
`paramFooter`, each carrying a `param:<key>` wire handle, managed by
`ModulationParamsSection.svelte`. NOT a new bespoke row type.

So after this slice: **one gesture, one list.** "Add a param to the node face" ≡ "expose this
param for modulation". The row shows on the card, is **editable in place** (inline value
control on the face), and is wireable (its `param:<key>` handle unchanged). The prototype's
open question ("do promoted params duplicate the Inspector?") is answered: it's ONE list —
the inspector's expose-management and the face rows are two views of `node.modInputs`.

## What to build

- In-place editing on the face rows: the right control per declared param type (number →
  drag/wheel field per G3's `wheel-step.ts` conventions, one undo per gesture; enum → cycle
  chip; bool → toggle). Keep rows compact — the card must stay legible at graph zoom; verify
  against the existing card metrics (thumbnails grew cards to ~208px in the proto agent's
  measurement — measure the real one).
- The "add to face" gesture: from the effect inspector's param rows (an expose affordance per
  row — coordinate placement with S4's layout via the orchestrator if both land tonight) AND
  the existing ModulationParamsSection management stays working. Removing from the face =
  unexposing (with the existing guard if a wire is attached — verify what happens today when
  a wired modInput is removed; preserve that behaviour exactly).
- A modulation-wired row shows its value as driven (live value, control disabled or showing
  the modulated readout — match how the app displays modulated params elsewhere; if there is
  no precedent, driven rows show the live value read-only with the base value editable via
  the inspector, and NOTE this decision in your report).
- Graph interaction prefs (standing, from memory): NO lift/click animations on nodes; instant
  hover highlight; wires stay grey. Nothing you add may animate node cards on hover/click.
- Fires through the same store mutation path param edits use today (undo parity, server
  write) — no new mutation route.

## Anchors to verify

- `TriggerNode.svelte` `paramFooter` + `param:<key>` handle wiring; `ModulationParamsSection.svelte`;
  the `node.modInputs` model + its mutations in the store.
- How a param edit flows store→server today (one gesture = one undo/write, per G3).
- The xyflow node-card sizing/zoom behaviour post-#179 (tinted thumbnails live there now).

## Scope fence

May touch: `TriggerNode.svelte`, `ModulationParamsSection.svelte`, the modInputs store
mutations ONLY as needed for the unified gesture (no model reshape), new face-row control
subcomponents + tests, ui-shot presets, styleguide entry + regen for any new reusable
control. Non-goals: S4's inspector layout (different files — the expose affordance in the
inspector is a single small insertion point; if it collides with S4's rewrite, coordinate
through the orchestrator), the drawer shell, core/protocol, modulation evaluation itself.

## Evidence

- Typecheck 0 + targeted vitest (store mutation tests for the unified gesture; row control
  tests), committed HEAD pushed. **Do NOT run the full `pnpm test` sweep — orchestrator-only
  rule; the orchestrator sweeps at review.**
- ui-shot: card with two exposed params (one number, one enum), one wired to a modulation
  node showing driven state; the add-to-face gesture surface — `--strict`, pinned to your
  worktree's TWUX_DEV_PORT.
- Report: commit body <30 lines; one-line completion message with sha + branch.

## Escalate if

- The unified gesture requires reshaping `modInputs` (ordering, metadata) — propose, wait.
- Removing a wired row's guard behaviour is inconsistent today (report what you find).
- Face editing of a driven param is ambiguous beyond the default above.

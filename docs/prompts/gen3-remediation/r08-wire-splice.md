# R08 — Wire-splice on node drop with pre-release arming + splice-only undo (GH #87)

Read first: `docs/prompts/gen3-remediation/CONVENTIONS.md`, then
`gh issue view 87 -R twadams21/LEDrums`, then the parent spec's Phase 1.6
(`docs/plans/2026-07-09-gen3-ux-remediation-spec.md`).

Dragging a node over an existing wire arms a splice — the wire visibly
indicates the pending insert before release. Releasing wires
source→node→target. Ctrl/Cmd+Z undoes the splice **wiring only**; the node
stays where it was dropped (the wiring mutation is its own undo entry,
recorded after the position commit).

Build on what's landed (all in your branch history):
- **R03** built the in-drag feedback layer you extend: `WireDragValidity`
  tracker under `GraphCanvas`, read-only `validateDrop` predicate,
  `classifyConnection` reason-returning validator, `wire-preview.svelte.ts`
  pin-a-drag-state pattern for ui-shot. Route splice wiring through the
  validated connect path.
- **R04** added `batchIntoCurrentUndo()` / `suppressUndoSnapshot` in the
  store — the tool for shaping what folds into one undo entry. Note your
  requirement is the opposite shape: position commit and splice wiring must
  be SEPARATE undo entries (undo pops the wiring, keeps the position).
- The locked graph interaction contract applies (no lift/click motion,
  instant hover — memory `graph-interaction-prefs`).

Store-seam tests: splice wiring + splice-undo-keeps-position. Ad-hoc
ui-shot of the armed-splice indication (extend the wire-preview pin or add
ONE seam op; NO shots.json entries). Design system regenerated only if you
add reusable styles.

Sibling note: R27 (Output/Trigger inspectors) and a P3 review agent are
running in parallel — stay out of the inspector components and
packages/core eval.

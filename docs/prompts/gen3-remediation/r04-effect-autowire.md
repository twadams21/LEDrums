# R04 — Auto-wire a newly added Effect to Output (+ toast, single undo) (GH #83)

Read first: `docs/prompts/gen3-remediation/CONVENTIONS.md`, then
`gh issue view 83 -R twadams21/LEDrums`, then the parent spec's Phase 1.2
(`docs/plans/2026-07-09-gen3-ux-remediation-spec.md`).

Adding an Effect node auto-wires it to the terminal Output anchor so it
makes light on the next hit instead of sitting silent. The auto-wire is
ONE undoable action (Ctrl/Cmd+Z reverts add+wire together — check how the
store's undo history batches; the add and the wire must not be two undo
steps) and announces itself with a toast.

Build on what's landed (all in your branch history):
- **R02** toast conventions (`lib/ui/ToastHost` / `toast.svelte.ts`) — reuse.
- **R03** just made `store.connect` reason-returning and added
  `classifyConnection` (`store/graph-wiring.ts`) — route the auto-wire
  through the same validated path; if the auto-wire would be rejected
  (shouldn't happen for a fresh Effect → Output, but belt-and-braces),
  skip it silently rather than toast an error.
- **R01** made the projection attach wires immediately — no refresh dance.

Store-seam tests: auto-wire on add + single-step undo. Ad-hoc ui-shot if
you add visible UI (toast is covered by existing conventions; NO
shots.json entries).

Sibling note: R14 (packages/core eval) and R26 (inspector components) are
running in parallel — stay out of core eval and the inspectors.

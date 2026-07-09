# R03 — Connection-time validation: invalid wire feedback in-drag + reason toast (GH #82)

Read first: `docs/prompts/gen3-remediation/CONVENTIONS.md`, then
`gh issue view 82 -R twadams21/LEDrums`, then the parent spec's Phase 1.1
(`docs/plans/2026-07-09-gen3-ux-remediation-spec.md`).

While dragging a wire, the wire-in-progress turns **red, dotted, and dull**
the moment the pointer is over an invalid target; releasing over an invalid
target shows a toast naming the reason: **direction / cycle / duplicate**.
No silently vanishing wires.

Build on what just landed (both are in your branch's history):
- **R01** fixed the projection so a valid wire into any node attaches
  immediately — the store connection validator (`store.connect`/`reconnect`
  path in `apps/web/src/lib/trigger-lab/store/`) is now the single source of
  rejection. Surface *its* verdicts; don't invent a parallel validator.
- **R02** established the toast conventions (`lib/ui/ToastHost` /
  `toast.svelte.ts`, plain language, one toast per user-visible event). Reuse
  them for the rejection reasons.

Mechanism hints: xyflow's `isValidConnection` / connection-in-progress state
drives the in-drag styling (the custom `WireEdge` + connection-line styling
on `GraphCanvas`); the locked graph interaction contract still applies (no
lift/click motion, instant hover, drop-anywhere-on-node → its input — see
`.mex/ROUTER.md` graph UX notes and memory `graph-interaction-prefs`).

Acceptance criteria are on the issue: store-seam tests for each rejection
reason (direction, cycle, duplicate) + ad-hoc ui-shot of the invalid-drag
state (extend the shot seam if needed — NO shots.json entry) + design system
regenerated only if you add reusable styles.

Sibling note: R13 (core eval) and R25 (inspectors) are running in parallel —
stay out of `packages/core` eval code and the inspector components.

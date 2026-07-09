# R14 — Fan-in to one Effect coalesces to a single firing (GH #93)

Read first: `docs/prompts/gen3-remediation/CONVENTIONS.md`, then
`gh issue view 93 -R twadams21/LEDrums`, then the parent spec's Phase 3.2
(`docs/plans/2026-07-09-gen3-ux-remediation-spec.md`). **Tests first.**

Multiple flow edges converging into one Effect coalesce into a single
firing per trigger — fan-in no longer doubles the brightness. A delayed
branch arriving later is a **separate temporal firing** under the R13
timeline model, not a duplicate.

R13 just landed (in your branch history) and settled the temporal model
you are defined against — read its report first:
`docs/reports/2026-07-09-gen3-r13.md`. Key facts:
- Voices are tagged `pad` + `originNodeId`; the engine owns per-(pad,mix)
  member snapshots; `isLayerLive(pad, origin)` gives origin-keyed liveness.
- R13 explicitly left you the overlap **double-count**: during overlap the
  re-composed drained Mix voice and the still-live immediate voice both
  exist. Coalescing that is your job.
- `delay 0` parity and R13's 9 delay-timeline tests must stay green —
  they are your regression floor.

Scope: `packages/core/src/voice/` (eval-graph, voice-pool, engine) and the
offline sim must match core (it delegates eval to core). Core stays pure
and deterministic. No UI work expected; if none, no ui-shot needed.

Sibling note: R26 (inspector Field migration) and R04 (store auto-wire)
are running in parallel — stay out of the inspector components and the
web store wiring layer.

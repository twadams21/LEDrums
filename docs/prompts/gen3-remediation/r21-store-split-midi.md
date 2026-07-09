# R21 — Store split 2/5: extract the MIDI input/learn controller (GH #100)

Read first: `docs/prompts/gen3-remediation/CONVENTIONS.md`, then
`gh issue view 100 -R twadams21/LEDrums`, then the parent spec's Phase 4.5
(`docs/plans/2026-07-09-gen3-ux-remediation-spec.md`).

Second slice of the trigger-lab store split. Extract MIDI input + MIDI-learn
concerns from `store.svelte.ts` into a constructor-injected controller.
**API-preserving** — store public surface unchanged, existing tests pass
UNMODIFIED (if you must edit an existing test, the split isn't
API-preserving — stop and reconsider).

Prior art (in your branch history — follow it exactly):
- **R20 just landed slice 1/5**: `controller-monitor.svelte.ts`
  (ControllerMonitor — constructor-injected, runes-owned state, store
  delegates via getters + thin forwarders). Read its report
  (`docs/reports/2026-07-09-gen3-r20.md`) — it names the seam and pattern
  you continue. Match its conventions (file naming, injection, delegation
  style) so the five slices read as one design.
- R20's report notes engine event-log/feeds were deliberately left
  (entangled, no seam) — that judgment call stands; don't drag them into
  the MIDI slice either.

When ambiguous whether something is "MIDI" (e.g. pad-trigger routing fed
by MIDI events vs the MIDI device/learn machinery), leave it in place —
slices 3–5 keep carving.

Full `pnpm gates` before reporting; no UI change → no ui-shot. Name the
seam slice 3 (R22) should start from in your report.

Sibling note: R07 (reachability lint — core + lint views) is running;
stay out of packages/core and the lint/view files.

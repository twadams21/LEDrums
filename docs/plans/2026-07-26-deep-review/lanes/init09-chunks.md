# INIT-09 ui-component-dedup — chunked dispatch plan (/slicing-work shape)

One initiative (~1900 LOC), two STRICTLY SEQUENTIAL chunk dispatches — both
churn the shared UI seam (scripts/ui-shot/shots.json, docs/design-system.html,
styleguide sections), so no parallelism between them. Fresh agent + cross-model
review gate + orchestrator merge per chunk. Plan of record:
`09-synthesis/INIT-09-ui-component-dedup.json`; `11-decisions.md` overrides.

## Chunk 09A — baseline + primitive extractions (S0–S4)

S0 FIRST (freeze the visual baseline, close the capture gap — the controller
panel's takeover/presence shot-seam ops landed in INIT-02 02C, use them), then
ActionButton (S1), InspectorHeader retiring the five .ihead copies (S2),
MidiLearnRow target-agnostic (S3), shared canvas-visibility + reduced-motion
runes (S4). Resting state: primitives extracted, every retired copy's surface
byte-checked or explained against the S0 baseline.

## Chunk 09B — structural collapses + styleguide (S5–S8)

Overlays.svelte inlined into App.svelte (S5), ControlProps<T> contract across
the eight design-system primitives (S6), ControllerStatusPanel split along its
five change axes with scoped CSS carried (S7), styleguide registration + sweep
+ design-system regeneration (S8).

## Every chunk

`lanes/COMMON.md` binds. Re-measure baseline at starting HEAD. UI work: apply
/make-interfaces-feel-better; design system regenerated in the same change
(`pnpm design-system`); ui-shot evidence with UI_SHOT_BASE pinned to THIS
lane's dev port (lane-c pool port 4326 — never :5173, never another lane's).
ANCHOR WARNING: the plan predates INIT-02/07 — PatchZoneInspector.svelte in
its file list was DELETED (D5); the store is decomposed (controller surfaces
live on store.controllerMonitor / store.controllerTest / store.midi). Verify
every anchor; report corrections. Review gate per chunk, reviewer model ≠
implementer.

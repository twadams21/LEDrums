# Lane: INIT-09 chunk 09A — baseline + primitive extractions (S0–S4)

Read `lanes/COMMON.md` and the **Chunk 09A** section of `lanes/init09-chunks.md` —
both bind. Branch: `init/09a-primitives` off `review/impl` (start at origin
HEAD; re-measure baseline at your starting HEAD, expect ~3265).
Steps from `09-synthesis/INIT-09-ui-component-dedup.json`: S0→S1→S2→S3→S4
(S1/S5 and S2/S4 are dependency tiers in the plan, not parallel lanes — work
in step order; S5 belongs to chunk 09B, not you).

- S0 FIRST: freeze the visual baseline + close the capture gap. The
  controller panel's takeover/presence renders are capturable via the
  shot-seam ops INIT-02 landed (`presence`/`takeover`, plus `patch-wired`).
  Archive the baseline OUTSIDE the repo (scratchpad), like 02A did.
- S1: ui/ActionButton.svelte — the soft text-button vocabulary, with exactly
  the two variants the call sites actually differ on. No speculative props.
- S2: ui/InspectorHeader.svelte — retire the five .ihead copies.
- S3: ui/MidiLearnRow.svelte — target-agnostic by design (midi-learn now goes
  through `store.midi.startLearn/cancelLearn` — the store forwarders are gone).
- S4: share the canvas-visibility + reduced-motion runes.
- Every retired copy: surface byte-checked against the S0 baseline via
  ui-shot, or the visual delta explained in the commit body.
- UI non-negotiables: /make-interfaces-feel-better applies; anything new and
  reusable gets a styleguide entry + `pnpm design-system` regeneration IN THE
  SAME CHANGE (S1/S2/S3 are exactly such components).
- ui-shot: pin UI_SHOT_BASE to THIS lane's dev port (lane-c pool port 4326;
  never :5173, never another lane's port). If you start a dev stack, kill it
  when done.
- Gates green per committed step (foreground `pnpm gates`).
- Report: per-step shas, gates numbers, baseline archive path, per-copy
  byte-check table, deviations.

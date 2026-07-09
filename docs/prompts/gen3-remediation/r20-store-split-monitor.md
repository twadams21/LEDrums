# R20 — Store split 1/5: extract the monitor controller (GH #99)

Read first: `docs/prompts/gen3-remediation/CONVENTIONS.md`, then
`gh issue view 99 -R twadams21/LEDrums`, then the parent spec's Phase 4.5
(`docs/plans/2026-07-09-gen3-ux-remediation-spec.md`).

First slice of the trigger-lab store split
(`apps/web/src/lib/trigger-lab/store.svelte.ts`): extract monitor concerns
into a constructor-injected controller, following the existing controller
prior art in the store area. **API-preserving** — the store's public
surface is unchanged, existing tests pass UNMODIFIED (that is the proof of
API preservation; if you need to edit an existing test, your split isn't
API-preserving — stop and reconsider).

Watch-outs:
- The store gained members recently: R04's `suppressUndoSnapshot` /
  `batchIntoCurrentUndo`, R08's `canSplice`/`spliceOnDrop`,
  `controllerStatus` (R29's monitor-adjacent state). Take the file as it
  is on your branch; decide what is genuinely "monitor" (controller
  status/watch, engine monitoring feeds) vs graph authoring — when
  ambiguous, leave it in place; slices 2–5 (R21–R24) will keep carving.
- Svelte 5 runes class semantics: state fields moved to a controller must
  keep reactivity (runes in the controller class, store delegates via
  getters) — verify with the existing tests, don't add compat shims.
- You are the ONLY agent in the store file this wave, but R06 (lint
  badges, views + maybe core) and P2 review (read-only) are running —
  stay out of views/inspectors.

Full `pnpm gates` before reporting. No UI change → no ui-shot. Your report
should name what moved, what deliberately stayed, and the seam R21 (undo
history) should start from — it dispatches next against your landed state.

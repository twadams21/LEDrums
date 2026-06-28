# Section-aware engine playback

You are an implementer agent on the LEDrums project. Make the **active section's slotted, layered
graphs** actually fire on a hit — today a hit fires a flat per-pad graph and the Sections arrangement
(P2) is authoring-only. This is the highest-value gap.

Report back to your parent orchestrator (`--session parent`) when done or blocked. Work on branch
**`feat/unified-shell`** (already checked out). Keep `pnpm typecheck` + `pnpm test` green. Commit
milestones. **Do NOT push, open a PR, or merge.** If you hit the 5h usage limit mid-edit, commit WIP
and stop (it resumes after the reset).

## First, read (ground truth)
- `docs/plans/2026-06-21-ui-redesign.md` — design log + the "Sections-as-graph-slots (P2)" + follow-up
  notes (this is the documented gap).
- `apps/web/src/lib/app/setlist.ts` — the web setlist model (Song → SetlistSection → per-drum graph
  SLOTS referencing graphs by key; reuse-by-reference; stacked slots = layers). 8 unit tests.
- `packages/core/src/voice/engine.ts` — `processEvent` → `this.show.graphs[padKey(drumId,zone)]` →
  `fireGraph`. The flat resolution you are replacing. Note `sectionIndex` already tracked.
- `packages/core/src/voice/types.ts` — `Show`, `TriggerGraph`, `Section`(looks), `padKey`.
- `packages/core/src/model/integrity.ts` — `assertShowIntegrity` (already validates slot refs).
- `apps/web/src/lib/trigger-lab/show-builder.ts` (+ `.test.ts`) — `buildShow(ShowSource)` (already
  runs `assertShowIntegrity`; the ShowSource already carries `songs` + `drums`).
- `apps/web/src/lib/trigger-lab/store.svelte.ts` — `hit()`, `recall()`, `buildShow` send, the setlist
  rune state (`songs`/`activeSongId`/`arrangeSectionId`).

## Design (apply /codebase-design)
The engine is the brain (deterministic, can run headless/live without the web). So the **arrangement
lives in the `Show`** and the **engine resolves the active section itself** — do NOT have the web
pre-compute active graphs and push them.

1. **Core types (`types.ts`):** add the setlist to `Show`. Port the web setlist shape into core types
   (structurally identical so `show-builder` keeps assembling by pass-through):
   - `Show.songs: Song[]` where `Song = { id, name, sections: SetlistSection[] }`,
     `SetlistSection = { id, name, slots: Record<drumId, (string|null)[]> }` (slot = a graph key into
     `Show.graphs`, or null). Keep `Show.graphs` (the reusable library) and `Show.sections` (looks).
   - Add an `activeSongId?`/`activeSectionId?` to `Show` OR (preferred) keep active-section as engine
     STATE set via a command (see 2). Decide with the deep-module lens; document the choice.
2. **Engine (`engine.ts`) — section-aware resolution + recall:**
   - Add a way to set the active section: extend `InputEvent` with `{ kind: 'recallSection',
     songId?, sectionId }` (drained like other inputs, deterministic) OR a `setActiveSection` method on
     the `RenderEngine` seam. Track `activeSongId`/`activeSectionId` in engine state; `setShow` seeds
     them (first song / its first section) and clears cleanly.
   - On a pad hit: if there is an active section, resolve `section.slots[drumId]` → the non-null graph
     keys → fire EACH referenced graph (layered, in slot order) via the existing `fireGraph`. If there
     is no setlist/active section (or the drum has no slots), FALL BACK to the current
     `graphs[padKey(drumId,zone)]` behavior (back-compat; keeps existing tests green).
   - Zone note: the grid is per-drum; firing all of a drum's active slot graphs on any zone hit is the
     intended v1 semantic (zone-specific behavior lives inside a graph). Document it.
   - Keep determinism (seeded PRNG; per-node state keys already include the pad — make sure layered
     graphs from one hit get distinct state keys so they don't collide).
3. **Web wiring (`store.svelte.ts` + `show-builder.ts`):**
   - `buildShow` already passes `songs`; ensure `Show.songs` is populated + integrity-checked.
   - On `recall`/section change, send the engine the active-section command (new client WS message, e.g.
     `{ t: 'recallSection', songId, sectionId }` → server `voice-engine-host.applyInput`/method).
   - `hit()` local sim must mirror the engine: fire the active section's slot graphs (layered) so the
     offline preview + voice lanes match the server. Reuse a shared pure resolver if practical.
   - The Sections view: activating a section column should drive playback (recall), not just focus.
4. **Server (`apps/server/src/voice-engine-host.ts` + `main.ts`):** wire the new `recallSection`
   client message to the engine. Add the message to the web+server protocol types.

## Tests (where the bug lives)
- Core `engine.test.ts`: a hit in an active section fires that section's per-drum slot graphs, LAYERED
  (N filled slots → N graphs' voices); switching the active section changes what fires; empty slots /
  no-setlist falls back to the flat per-pad graph (back-compat). Determinism preserved.
- If you add a pure resolver (active section + drum → graph keys), unit-test it (node).
- Keep `assertShowIntegrity` coverage green.

## Verify + report
Run `pnpm typecheck` and `pnpm test` (paste the final output — do not claim green otherwise). Sanity
check against the running dev stack (web :5173, voice server :4321, `LEDRUMS_ENGINE=voice`) if usage
allows. Then:

```
twux send-message --session parent \
  --slice-status "<short status>" \
  --body "<design choice (Show.setlist + engine resolution), what changed across core/web/server, the layering+fallback semantics, tests added, and the pasted typecheck/test results>"
```

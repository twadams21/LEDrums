# Show document model — multi-show persistence + store API (no UI)

PRD: `docs/plans/2026-06-27-crud-context-perform-prd.md`. Branch base `feat/unified-shell`
(worktree — read `docs/prompts/_worktree-note.md`). **Runs AFTER the CRUD batch
(crud-section/song/graph) is merged** — this restructures persistence + store init (high
blast radius), so it wraps a settled authored-state surface rather than racing it. **This
slice is the MODEL + STORE API + PERSISTENCE only — NO UI** (the `show-browser-ui` slice
builds the UI on top).

## What this delivers
The "show" (the whole setlist document — `graphs`, `graphNames`, `songs`, `buses`,
`presets`, `effects`) becomes a **named, first-class document** with a full lifecycle:
new / open / save / save-as / close / rename / delete, and switching between multiple saved
shows. The server `Project` (routing/geometry/output) is **orthogonal and untouched** —
shows are authored-state documents in localStorage only.

## Seam / shape (decision-level; adapt names to the code)
A **show** = the existing authored content given identity:
```ts
type Show = { id: string; name: string; authored: AuthoredState };
// persisted library shape:
type ShowLibrary = { shows: Record<string, Show>; activeShowId: string };
```
The store's live authored content == the **active show's** `authored`. Autosave writes the
active show back into the library. `AuthoredState` is the existing serialized authored
shape in `persistence.ts` — reuse it as the show payload; do not duplicate its fields.

## Scope
- `apps/web/src/lib/trigger-lab/persistence.ts` —
  - Introduce the `ShowLibrary` persisted shape (a new localStorage key, e.g.
    `ledrums.shows.v1`).
  - **Migration (idempotent, defensive — same spirit as existing hydrate migrations):** on
    load, if the new library key is absent but the **existing single `AuthoredState`** key
    is present, wrap that state as one show (`name: 'Default Show'` or any existing name),
    generate an id, set it active, and write the library. If neither exists, seed one empty
    "Untitled Show". Never throw on malformed input — fall back to a fresh library.
  - `serialize`/`deserialize` for the library; keep the single-state serializer available
    for the per-show payload (reuse).
- `apps/web/src/lib/trigger-lab/store.svelte.ts` —
  - Hydrate from the library: load `activeShow.authored` into the store's authored runes
    (graphs/graphNames/songs/buses/presets/effects), exactly as today's single-state
    hydrate does — but sourced from the active show.
  - Autosave now persists the active show (debounced, as today).
  - **Show API:** `shows` (derived list of `{id,name}` for the UI), `activeShow` /
    `activeShowId`; `newShow(name?)` (create blank, switch to it), `openShow(id)` (save
    current → load that show's authored into the runes), `saveShow()` (explicit flush;
    autosave already covers it — make it a deliberate write/confirmation),
    `saveShowAs(name)` (clone current authored under a new id+name, switch),
    `renameShow(id, name)`, `deleteShow(id)` (drop; re-point active sensibly; never leave
    zero shows — seed an Untitled if the last is deleted), `closeShow()` (switch to a fresh
    blank Untitled show; current is already saved in the library).
  - Switching shows must fully swap the authored runes (no bleed between shows) and keep the
    server in sync if the existing code re-sends `setShow` on authored change (verify the
    show switch triggers that path).

## Tests
- `persistence.test.ts` — migration: single `AuthoredState` → one-show library (idempotent,
  re-running is a no-op); empty/malformed → fresh library, no throw; library
  serialize/deserialize roundtrip.
- store tests — `newShow` creates+activates a blank; `openShow` swaps authored content (and
  the previous show retains its edits); `saveShowAs` clones under a new id; `renameShow`;
  `deleteShow` re-points active + never zero; `closeShow` → fresh Untitled. Assert no
  cross-show authored bleed.

## Gate discipline
Per-package typecheck/test during work; full `pnpm typecheck && pnpm test` on your
committed clean tree. This is the highest-risk slice — keep web green continuously; do not
regress the existing single-state behavior (it's now the one-show case).

## Acceptance
- Shows are named documents with new/open/save/save-as/close/rename/delete + switching;
  existing implicit work migrates to one named show; no authored bleed between shows; server
  `Project` untouched; full sweep green. (Live `:5173` spot-check owed; UI is the next
  slice.)

## Report back
Report to parent with commit SHA(s), files, the final `Show`/`ShowLibrary`/store API, the
migration approach + localStorage keys, gate totals, deviations. Commit before reporting;
leave ROUTER to the orchestrator.

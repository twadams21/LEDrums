# 07 — Remove "linked" instances; canonical Song Library across shows

> Part of the 2026-07-02 "rock solid" initiative. See [INDEX.md](INDEX.md).

Two data-model topics that both reduce to "what is canonical and what is a copy".

## A. Effect instance/linked overhaul → remove `linked`

### Problem

The instance/linked UX "doesn't really work"; Trent would rather just reuse a graph somewhere else
than maintain a live-linked preset mode.

### Current state

- `PlayBlock.linked: boolean` (`apps/web/src/lib/trigger-lab/sim.ts:87-98`; default false,
  `sim.graph-compilation.ts:79`). Semantics in the store
  (`apps/web/src/lib/trigger-lab/store.svelte.ts`):
  - `liveParams` (:1584-1586): linked → read the shared preset's params; else the node's own.
  - `setParam` (:1996-2005): linked → **edits the shared preset** (all linked users change);
    else edits the node's private copy.
  - `toggleLink` (:1983-1994): unlink = copy preset params into `node.params` (:1989) — i.e. the
    materialize-on-unlink path already exists.
  - `selectPreset` (:1973-1981): non-linked selection forks preset params into the node.
- UI: `PlayNodeInspector.svelte:60-67` SegmentedControl linked/instance; help text :130.
- Preset guards: `store/objects.ts:74-96` (`presetUsageCount`, `canDeletePreset` — only unused,
  non-`:default` presets deletable); Objects view rows `views/objects-view.ts:49-77`.
- Graph reuse is already the good pattern: sections hold **references** to graph keys
  (`apps/web/src/lib/app/setlist.ts:15-20`, comments at :1-12), one graph appears in many
  sections, `cloneSection` copies the key list not the graphs (:94-98).

### Design

1. Delete `linked` from the model. Every play node owns its params (instance semantics, the
   current default). Migration: hydrate-time migrator materializes params for `linked:true` nodes
   (exactly `toggleLink`'s unlink branch), then drops the field — idempotent, follows the
   `foldVelocitySwitch` pattern.
2. Presets become plain snapshots: **Apply** (copy params onto the node) and **Save as preset**
   (snapshot node params). `selectPreset` keeps only its fork branch. Preset CRUD in Objects view
   unchanged; `presetUsageCount` becomes advisory display (nodes no longer *depend* on presets at
   runtime — decide whether `presetId` remains as provenance label or is dropped; recommend keep
   as label for "based on X" display + re-apply).
3. UI: remove the linked/instance SegmentedControl; PlayNodeInspector gets Apply/Save-preset
   actions beside the preset select. "Reuse the whole thing elsewhere" = reuse the graph (already
   works via sections) or duplicate the graph (`duplicateGraph` exists).

### Tests

Migrator (linked nodes materialize params; idempotent; unlinked untouched); setParam now always
node-local (regression: editing node A never changes node B); persistence round-trip without
`linked`; preset apply/save semantics.

## B. Song Library — canonical songs imported into shows ("Setlist manager")

### Problem

No way to grab a song from another show. Desired: a Song **library**; songs are canonical; a show's
setlist imports library songs; updating a song's effects propagates to every show using it.

### Current state — shows are total silos (by design)

- `Show { id, name, authored: AuthoredState }` (`apps/web/src/lib/trigger-lab/persistence.ts:213-219`);
  `AuthoredState` (:29-54) contains **everything**: `graphs`, `graphNames`, `songs` (→ sections →
  graph-key lists), `buses`, `presets`, `effects`, transport + UI state.
- `ShowLibrary { shows, activeShowId }` at localStorage `ledrums:shows:v1` (:206, :222-225),
  server-persisted as an opaque versioned blob (`apps/server/src/show-library.ts:1-55`,
  `projects/default.shows.local.json`), cold-load reconcile in `store/show-library-sync.ts:52-58`.
- Isolation is guaranteed and tested: `store.shows.test.ts:95-117` "no cross-show bleed" — opening
  a show swaps the entire authored rune state.
- A song is playable only with its **dependency closure**: sections reference graph keys → graphs'
  play nodes reference `effectId` + `presetId` + `params` + `env` → effects/presets live in the
  same show's arrays. No cross-show reference mechanism, no import operation, no propagation.
- Migration machinery to follow: `deserializeShowLibrary` (:246-269), `migrateSongs` (:167-180),
  legacy single-blob migration (:281-293) — versioned, defensive, idempotent.

### Design — a library layer above shows

Trent's canonical requirement inverts the isolation guarantee, so make the new layer explicit
rather than poking holes in show isolation:

1. **`SongLibrary`** (new persistence doc, sibling to ShowLibrary): 
   `LibrarySong { id, name, sections, graphs: Record<key,TriggerGraph>, effects: EffectDef[],
   presets: Preset[], version }` — each library song **carries its own dependency closure**,
   namespaced by song (no cross-song key collisions). Stored at `ledrums:songs:v1` + a second
   opaque server blob (`default.songs.local.json`, same autosave/broadcast pattern as
   show-library — the server code generalizes trivially).
2. **Shows reference, engine resolves**: `AuthoredState.songs` entries become either local songs
   (today's shape, unchanged) or `{ ref: librarySongId }`. On show open / library change, a pure
   resolver materializes the referenced song's closure into the runtime view (graphs/effects/
   presets union with per-song key prefixes). Editing a referenced song edits the **library** copy
   → every show sees it (the canonical propagation Trent wants). "Detach to local copy" is the
   escape hatch (clone closure into the show, re-key).
3. **Operations** (store API + pure helpers, mirroring show CRUD):
   `exportSongToLibrary(showId, songId)` (extract closure — pure function, heavily tested),
   `importSongRef(librarySongId)` (add reference to active show's setlist),
   `detachSong(songId)`, library CRUD (rename/duplicate/delete with usage guard).
4. **UI**: extend `ShowBrowser`/Objects view with a **Library** source: Songs master-detail lists
   "This show" + "Library"; song row ContextMenu gains "Add to library" / "Import from library" /
   "Detach copy". Naming for the PRD: call the whole surface **Setlist** (a show's ordered songs)
   fed by the **Song Library** — retire "Show Song Setlist manager".
5. **Conflict rules** (LOCKED 2026-07-02): deleting a library song used by shows is **blocked
   while in use** (Trent's call — mirrors the existing preset-delete guard,
   `store/objects.ts:87-96`): the delete action is disabled with "Used by N shows" and lists the
   shows; the user detaches or removes references first. Kit-geometry-dependent bits (scope
   `targetId`s reference drum ids): library songs should avoid hard drum-id targets or map through
   the kit at import — flag hard targets in the export step.
6. **Naming** (LOCKED): the canonical store is the **Song Library**; a show's ordered songs are
   its **Setlist**. Use exactly these terms in rail labels, UI copy, code identifiers, and the
   PRD; retire "Show Song Setlist manager".

### Tests

Closure extraction (pure): captures exactly the graphs/effects/presets a song reaches, no more;
re-keying collision-free; import→resolve→render parity with the source show; propagation (edit
library song → other show's resolved view updates); detach isolation; persistence version
migration (existing libraries unaffected); server blob round-trip; "no cross-show bleed" test
updated to state the new exception explicitly.

## Touch list

- `apps/web/src/lib/trigger-lab/sim.ts` (drop `linked`), `store.svelte.ts` (:1584-2005 region),
  `PlayNodeInspector.svelte`, `store/objects.ts`
- `apps/web/src/lib/trigger-lab/persistence.ts` (+`SongLibrary` doc, migrators),
  new `store/song-library.ts` (pure closure/resolve helpers), `store` wiring,
  `apps/server/src/show-library.ts` (generalize to N named blobs), protocol `setSongLibrary` msg
- `apps/web/src/lib/app/` ShowBrowser / ObjectsView / SectionsView song rows

## Ordering

A (remove linked) **before** B — the library closure is much simpler when params are always
node-local (no live preset indirection to resolve across shows).

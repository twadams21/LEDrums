# Group J — Presets & Song Library

Context: [doc 07](../07-linked-presets-song-library.md) · Parent PRD: #45 · Stories: 40–43

## S39 — Remove linked presets `plumbing` `ui-light`

**Blocked by:** none.

**What to build:** Delete the linked/instance mode: hydrate-time idempotent migrator materializes
preset params onto formerly-linked nodes, the flag leaves the model, param edits are always
node-local. Presets become snapshots: Apply (copy onto node) and Save-as-preset (snapshot node
params) actions beside the preset select; the linked/instance toggle is removed. Preset CRUD and
usage counts remain as display.

**Acceptance criteria:**
- [ ] Migrator: linked nodes keep their exact params post-migration; idempotent
- [ ] Editing node A can never change node B (regression test)
- [ ] Apply/Save actions work; persistence round-trips without the flag

## S40 — Library persistence + closure extraction `plumbing`

**Blocked by:** S39.

**What to build:** The Song Library persistence document (client storage + a second opaque
versioned server blob following the show-library pattern — generalize the server store to named
blobs). Pure dependency-closure extraction: a song's sections → graphs → effects/presets (+
names), namespaced per song, collision-free. Test-verified; no UI yet.

**Acceptance criteria:**
- [ ] Closure captures exactly what a song reaches (fixtures incl. modulation/modifier nodes);
      re-keying collision-free
- [ ] Library round-trips client + server blob; cold-load adoption follows the show-library
      pattern; existing show persistence untouched
- [ ] Versioned envelope with defensive load (never throws)

## S41 — Library refs: resolve/detach/guards `plumbing`

**Blocked by:** S40.

**What to build:** Shows reference library songs; a pure resolver materializes referenced songs'
closures into the runtime view (per-song key prefixes); editing a referenced song edits the
library copy (canonical propagation); detach-to-local-copy clones the closure into the show;
deleting an in-use library song is blocked with the list of using shows. Store operations:
export-to-library, import-reference, detach, library CRUD.

**Acceptance criteria:**
- [ ] Import → resolve → render parity with the source show (fixture)
- [ ] Edit library song ⇒ other shows' resolved views update; detach isolates
- [ ] Delete blocked while referenced (guard test); the no-cross-show-bleed test updated to state
      the library exception explicitly

## S42 — Library UI + naming pass `ui-significant`

**Blocked by:** S41.

**What to build:** Library surfaces: Songs master-detail gains "This show" vs "Library" sources;
song row actions (Add to library / Import from library / Detach copy); library song rows show
used-by counts; delete disabled with reason while in use. Vocabulary pass: "Song Library" and
"Setlist" across rail labels, UI copy, and identifiers touched by this initiative.

**Acceptance criteria:**
- [ ] Full flow demoable: author song in show A → add to library → import ref into show B →
      edit propagates → detach in B isolates
- [ ] Delete-in-use disabled with "Used by N shows" listing
- [ ] Naming consistent (no "Show Song Setlist manager" remnants)
- [ ] Applies `/make-interfaces-feel-better`

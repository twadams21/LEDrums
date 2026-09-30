---
last_updated: 2026-09-30
---

# Section graph ownership

> **Superseded (2026-09-30):** the trigger graph is being replaced by Effect chains (`docs/plans/2026-09-30-effect-chains/spec.md`, GH #237; decisions Trent's). This pattern applies only to graph code until effect-chains S08 deletes it. Do not add new graph placement behaviour.


## Contract

Treat a graph key as the linked-group identity. A fresh section seed, section duplicate, section
copy/paste, and existing-graph placement by Copy mint a key and deep-copy the graph. A repeated
key in persisted data is an intentional link across sections/songs and must not be split during
load; the same key is still forbidden twice inside one section. Link is an explicit placement
operation; unlink replaces one exact `(songId, sectionId, graphKey)` placement with a deep copy under
a fresh key. Do not add placement IDs to support a duplicate that the model forbids.

## Implementation seam

Keep graph closure copying pure in `store/graphs.ts`; keep section list changes pure in `app/setlist.ts`;
put history, id minting, rune snapshots, viewer guards, canonical-library boundaries, and atomic
create/copy/delete commands in the store/controller layer. Do not infer ownership from the selected
graph or add copy-on-write hooks. Canonical sections are playback references, not local mutation
targets; detach is the narrow existing escape hatch.

The authored flat graph list must cross into the core runtime through
`voice.runtimeSectionFromGraphKeys()`. It preserves `performanceGraphKeys` and derives the
backward-compatible drum slot grid in one place; both web `buildShow()` and server cold restore
must use this helper so direct MIDI/OSC graphs remain selectable without changing pad routing.

## Verification

Cover fresh seed keys, ordered-set sanitization, repeated-key copy closure, explicit linking across
sections/songs, 2/3/4/N placement counts, self/no-op and reverse links, linked edit propagation,
unlink isolation + undo, collision-safe IDs, failed-placement no-mint behavior, legacy load,
ClipDoc graph copies, canonical library references, atomic graph/name undo, and strict Sections UI
captures with console-error inspection.


## Section and zone authoring

Source: Trent's six authoring requests, 2026-09-25.

- `app/section-actions.ts` supplies section overflow and context actions. `moveSection` takes an
  original-list gap index; moving right one position uses `index + 2`, not `index + 1`.
- Trigger rail reorder calls `moveGraphPlacement` and shares `gapIndexAt` with Sections. It must
  keep the open graph selected and ignore drops after the active section changes.
- Desktop HTML drag/drop requires `dragDropEnabled: false` on the Tauri app window. Native file
  drops are not used here. Browser success alone is not a packaged macOS interaction test.
- Settings zones come from `zoneSlotsForDrum(inputMap, drumId)`, including declared unbound
  slots. `Select` defaults to segments for short lists; user-authored drum/zone names must opt
  out with `segment={false}`. Source subtitles also need the input map for configured names.
- `zoneGraphUsers` checks trigger and sequence-reset sources across the active graph model,
  inactive shows and canonical songs. `setInputMap` refuses deletion before undo or WS writes.
  Zone binding helpers preserve the zone declaration when clearing its last MIDI/OSC binding;
  only `removeZone` removes its identity. Raw-map test fixtures that only intend to rebind one
  zone must preserve other bindings/declarations.
- Missing-default fill compares actual trigger sources, mints independent graphs, and records
  one undo snapshot. Repeating it must add nothing.
- `UI_SHOT_OFFLINE=1` disables server/MIDI access in captures. The `configured-zones` fixture
  provides custom labels and an unbound zone; `select:trigger` selects the real source node.

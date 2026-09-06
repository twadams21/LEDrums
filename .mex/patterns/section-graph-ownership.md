---
last_updated: 2026-09-06
---

# Section graph ownership

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

## Verification

Cover fresh seed keys, ordered-set sanitization, repeated-key copy closure, explicit linking across
sections/songs, 2/3/4/N placement counts, self/no-op and reverse links, linked edit propagation,
unlink isolation + undo, collision-safe IDs, failed-placement no-mint behavior, legacy load,
ClipDoc graph copies, canonical library references, atomic graph/name undo, and strict Sections UI
captures with console-error inspection.

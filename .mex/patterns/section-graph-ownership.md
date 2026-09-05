---
last_updated: 2026-09-06
---

# Section graph ownership

## Contract

Treat a graph key as the linked-group identity. A fresh section seed, section duplicate, section
copy/paste, and existing-graph placement by Copy mint a key and deep-copy the graph. A repeated
key in persisted data is an intentional link and must not be split during load. Link is an explicit
placement operation; unlink replaces one exact placement with a deep copy under a fresh key.

## Implementation seam

Keep graph closure copying pure in `store/graphs.ts`; keep section list changes pure in `app/setlist.ts`;
put history, id minting, rune snapshots, viewer guards, and canonical-library boundaries in the
store/controller layer. Do not infer ownership from the selected graph or add copy-on-write hooks.

## Verification

Cover fresh seed keys, repeated-key copy closure, explicit linking across sections/songs, linked
edit propagation, unlink isolation, undo, collision-safe IDs, legacy load, ClipDoc graph copies,
canonical library references, and strict Sections UI captures with console-error inspection.

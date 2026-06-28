# Fix: every zone fires the drum's first graph (lost per-zone trigger mapping)

Implementer agent (opus, xhigh). Use **/diagnose** to confirm, then fix. Apply **/codebase-design**.
Branch **`feat/unified-shell`**. Report to parent (`--session parent`). No push/PR/merge.

## The regression (user-reported)
"Tom 1 Edge and Tom 1 Rim fire the Tom 1 Centre graph; same for Kick/Snare — only the FIRST zone in
the list fires. It was working before." Confirmed root cause: section-aware playback resolves hits
**per-drum**. `packages/core/src/voice/engine.ts` `resolveHitGraphs(drumId, zone)` looks up
`section.slots[drumId]` and IGNORES `zone`; the seed (`store.svelte.ts seedSongs`) fills slot 0 of
every drum with that drum's FIRST pad graph (zone 0). With a section always active, every zone hit on a
drum fires zone-0's graph. Before sections, a hit fired `graphs[padKey(drumId,zone)]` — the specific
zone's graph. Per-zone trigger mapping must be restored.

## The fix — make the arrangement per (drum, zone)
A trigger graph belongs to a specific `(drum, zone)` pad (that's how `graphs` is keyed and how the
Trigger view authors them). The Sections arrangement must preserve that. Design with codebase-design;
the intended shape:
- **Setlist slots keyed by pad, not drum.** Change `apps/web/src/lib/app/setlist.ts` so a section's
  slots are keyed by **padKey `"drumId:zone"`** (not `drumId`). `SectionSlots = Record<padKey, Slot[]>`.
  Update the pure ops + tests accordingly (reuse-by-reference + layering semantics unchanged, just
  per-pad).
- **Engine resolution per (drum,zone).** `resolveHitGraphs(drumId, zone)` resolves
  `section.slots[padKey(drumId,zone)]`; fallback to the flat `graphs[padKey(drumId,zone)]` when no
  active section / no slots for that pad (so each zone fires ITS graph — restoring the old behaviour).
  Keep the per-slot state-prefix fix from commit c311e81 (`${key}#${slotIndex}`).
- **Show plumbing**: `Show.songs` sections carry per-pad slots; `buildShow` + `assertShowIntegrity`
  follow the new keying (a slot ref still points at a graph key; integrity unchanged in spirit).
- **SectionsView grid**: rows become **pads (drum · zone)**, visually grouped under each drum
  (drum header, then its zone rows), columns = sections, L1..L3 slots per pad. Keep the picker +
  reuse dot + edit/clear. The seed should fill slot 0 of each pad with that pad's OWN graph (so the
  default arrangement reproduces the pre-section per-zone behaviour exactly).
- **store**: `assignSlot/clearSlot` + `seedSongs` + any per-drum assumptions updated to per-pad; the
  local-sim `resolveHitGraphsLocal` mirrors the engine.

## Verify
Reproduce on the running stack (web :5173, server :4321): hit Tom1 Edge vs Centre vs Rim and confirm
each fires its OWN graph again, with a section active. Add/adjust tests: engine fires the per-(drum,
zone) slot graph (Edge ≠ Centre); fallback to the pad's own graph when no slot; existing layered/dup
tests still pass. Full `pnpm typecheck` + `pnpm test` green (paste output).

## IMPORTANT — sequencing (shared tree)
This touches `store.svelte.ts`, `lib/app/setlist.ts`, `lib/app/views/SectionsView.svelte` and
`packages/core/src/voice/engine.ts`. The orchestrator will only launch you AFTER the persistence/
new-graph/resize agent (which owns store + app/) has finished and committed, so you have a clean base.
Pull the latest `feat/unified-shell` state first. Edit those files; do not stomp unrelated work.

## Report
```
twux send-message --session parent --slice-status "<short>" --body "<root cause confirm, per-pad keying change (setlist+engine+SectionsView+store), how the old per-zone behaviour is restored, tests, pasted typecheck+test output>"
```

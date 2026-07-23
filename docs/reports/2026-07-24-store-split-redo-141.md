# Store split redo (#141) — reslice ControllerTest / Shows / Sections

**Branch:** `refactor/store-split-2` · **Issue:** #141 (replaces closed #101/#102/#103)

## Context
The R22–R24 store-split extractions had landed only on the never-merged
`gen3r/final-wave` (PR #117, closed stale — 114 behind, 8 conflicts). Main's
`store.svelte.ts` had re-accreted to **3941 lines**. This redoes the three
extractions against today's main, API-preserving, using the landed
`ControllerMonitor` (R20) / `MidiController` (R21) controllers as the pattern
and the old `gen3r/r22–r24` branches as **technique reference only**.

The named brief `docs/prompts/2026-07-24-reslice-store-split.md` referenced by
the issue was never written; the issue body + the old branches' briefs/reports
(`docs/prompts/gen3-remediation/r2{2,3,4}-*.md`, `docs/reports/…-gen3-r2{2,3,4}.md`)
supplied the full spec and technique. Technique: each of the three old code
commits cherry-picked with `-n` as a starting point, then reconciled against
today's re-accreted store (drift fixes below).

## What shipped (3 controllers + 1 drift fix)

| Slice | Commit | New module | Store Δ |
|---|---|---|---|
| **R22** ControllerTest (S49) | `d7899f2` | `controller-test.svelte.ts` (+54) | carved out of `controller-monitor.svelte.ts` |
| **R23** Shows/setlist/song-library (S40–S42) | `122daca` | `shows-controller.svelte.ts` (+661) | big reduction |
| **R24** Section-arrangement (S16/U4) | `0ce8ae9` | `sections-controller.svelte.ts` (+201) | final slice |
| `$derived.by` fix | `ed3b583` | — | resolvedView host-init |

`store.svelte.ts`: **3941 → 3564 lines** (−377).

- **R22** — extracts the S49 test-pattern takeover (drive/exit + reactive view)
  out of `ControllerMonitor` into a constructor-injected `ControllerTest`, so
  the spec's two named controllers exist separately. Store surface
  (`controllerTakeover` / `setControllerTestData` / `backToLive`) unchanged —
  thin forwarders re-pointed `monitor` → `controllerTest`.
- **R23** — moves the authored show/setlist/song-library document model into
  `ShowsController`: show library + deriveds, setlist songs + resolved runtime
  view, canonical song pool + ref CRUD, the two server-library sync controllers,
  and the localStorage write-through persistence. Store keeps its exact surface
  as thin accessor delegators + forwarders.
- **R24** — moves the section-arrangement authoring model (`activeSectionId` +
  `sectionClipboard`, the `activeSection`/`sections` deriveds, and the 12
  section-CRUD ops funnelled through `updateActiveSong`) into
  `SectionsController`, mutating the `songs` rune through the store's delegators.
  The play surface (`hit` / `fireSectionGraph` / `setActiveSection`) stays in
  the store.

## Drift vs the old branches (why this is a reslice, not a replay)
The old branches were cut before ~2 weeks of feature work re-grew the store, so
two of the old diffs' assumptions no longer held:

1. **`nid` import (R24).** The old R24 dropped `import { nid }` from
   `./store/ids`, because on that base `nid` was used only by the section code
   it moved. Today's store uses `nid()` in **15 places** (node creation —
   `addNode`, etc.). Blindly replaying the drop broke `store.node-clipboard`.
   **Fix:** kept `nid` in the import.
2. **`resolvedView` derived (R23).** The old R23 report *claimed* `$derived.by`,
   but the committed diff used plain `$derived(…)` reading `this.host.*` in a
   field initializer. Today's stricter `svelte-check` flags 4× "Property 'host'
   is used before its initialization". **Fix (`ed3b583`):** wrapped in
   `$derived.by(() => …)` — the lazy-closure idiom the other host-reading
   deriveds already use.

`SECTIONS` (fixtures) and `import * as setlist` were correctly droppable — today's
store has 0 real uses (the 2 remaining `setlist.` mentions are doc comments).

## Gates — `pnpm gates` (machine-locked) GREEN, exit 0
- **Typecheck:** svelte-check 2493 files, **0 errors / 0 warnings**.
- **Full suite:** **2792 tests pass** — core 857, web 1553, server 318, io 54,
  protocol 10.
- **API-preservation proof** — every store contract suite passes **UNMODIFIED**:
  `store.controller` (15), `store.shows` (14), `store.songs` (13),
  `store.song-library` (11), `store.server-library` (16), `store.sections` (25),
  `store.clipboard` (9), `store.looks` (4), `section-looks.parity` (1),
  `store.node-clipboard` (5), `store.patch-clipboard` (6), `store.persistence`
  (12), `persistence` (39), `store.autosave` (2). No test moved or edited.
- No UI change → no ui-shot. `derived_inert` warnings in `ShowBrowser.test.ts`
  are pre-existing/unrelated (noted since R20).

## Deviations / notes
- Named brief file never existed; reconstructed from the issue + old branch
  artifacts (see Context).
- No behaviour change; internal structure only.
- `#12` (ids factory) / `#13` (legacy-sections cleanup) from the older
  `comp-S3.2` framing are **not** part of #141 — out of scope here.

## Follow-ups (orchestrator)
- Merge → close #141 → Notion Status. The remaining `store.svelte.ts` (3564) is
  the reactive bridge + integration core (runes/sim lifecycle, graph model, the
  authored-state swap machinery, WS link, S44 clipboard, routing/undo/autosave) —
  the god-file's separable domain clusters are now all extracted.

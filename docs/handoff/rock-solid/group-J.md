# Group J — Presets & Song Library (#53) — lane-3 orch report

Branch `group/J` (S39→S40→S41→S42, merged serially, latest `rock-solid` synced in — Trent's
styling merge eb97243 auto-merged clean). Full sweep after every merge; final sweep on the
synced branch green. **Review verdict: PASS** (3 non-blocking notes below).

## Per-slice
- **S39 — remove linked presets** (`c629579`): `linked` gone from core+web model; idempotent
  alias-stable hydrate migrator materializes formerly-linked params (render unchanged); params
  always node-local; Apply/Save-as-preset actions. Launch hiccup: assignment doc wasn't visible
  in the worktree (untracked in main repo) → impl started on a detached S35 leftover; corrected
  in flight, base was an ancestor, nothing lost. Fixed for S40+ by writing assignments into the
  impl worktree.
- **S40 — library persistence + closure extraction** (`f539656`): pure `extractSongClosure`
  (namespaced `lib:<id>/` closures), `SongLibrary` versioned envelope + defensive load, server
  named-blob store generalization (`show-library.ts` now a thin wrapper — exports unchanged),
  `setSongLibrary`/`songLibrary` protocol, `SongLibrarySync`. **Review bounce:** closure aliased
  live graph objects → fixed (structuredClone + mutation-isolation test) before merge.
- **S41 — refs/resolve/detach/guards** (`4e0194c`): pure resolver (inverse of extraction),
  detach-to-fresh-namespace, delete guard reporting using shows (live refs for the active show),
  `songRefs` on AuthoredState, song-library rune + autosave + cold-load adopt/viewer follow.
  **Review bounce:** adopted pool ids weren't reserved → cross-process id collision in
  `resolvedSongs`; fixed (reserveIds on boot + adopt, counter-proof tests) before merge.
- **S42 — library UI + naming + consumption** (`69cbedb`): Songs source split ("This show" /
  "Song Library"), row actions, used-by counts, delete disabled with reason, naming pass
  (Setlist / Song Library; no "Show Song Setlist manager" remnants). **Review bounce:** refs were
  listed but not selectable/playable — fixed: activeSong/SongRail/firing/selection/engine-push all
  read `resolvedView`; `buildShow` sends RESOLVED content while `toAuthored` persists refs;
  referenced-graph edits write through to the library copy (tested); `removeSongReference` added.
  Required minimal core change: `assertShowIntegrity` exempts `lib:` keys (pure, tested).

## Non-blocking notes (doc 07 refinements, not slice-file requirements)
1. Doc 07 §B.3 lists **duplicate** among library CRUD — not shipped (rename/delete/export/
   import/detach/remove-ref are). Trivial to add later via existing pure helpers.
2. Doc 07 §B.5 (LOCKED): "flag hard drum-id targets in the export step" — extraction carries
   drum-scoped `targetId`s but no export-step flagging. Benign while shows share one kit.
3. S42 deviation: STRUCTURAL edits of a referenced section (add/remove/dup its graphs) require
   detach; param/preset edits + renames propagate canonically. In-place structural editing of
   library copies needs id-minting-into-namespace rules — deferred deliberately.

## Gates (final, on synced branch)
typecheck 0 (6 pkgs) · tests 1691 / 0 failed / 0 skipped (core 533 / io 13 / protocol 1 /
server 185 / web 959) · every slice also swept green pre- and post-merge by impl + orch.

## Context pack for dependent work (K, and Lane 4's L)
- **S43 (clipdoc)** builds on S40's `extractSongClosure` + `songNamespace` (see
  `docs/handoff/rock-solid/S40.md` context pack) — closures deep-clone, re-key-by-default;
  S43 adds identical-content reuse dedup on top.
- Engine push now sends RESOLVED shows (`store.svelte.ts:showSource`); anything consuming
  `setShow` sees `lib:<id>/…` graph keys — routed by trigger source, exempt in integrity checks.
- The named-blob seam (`apps/server/src/named-blob-store.ts`) is THE pattern for any third
  server-persisted library.

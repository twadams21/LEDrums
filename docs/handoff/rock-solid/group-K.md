# Group K — Clipboard portability (#55) — lane-3 orch report

Branch `group/K` (S43 → S44∥S45, latest `rock-solid` synced). Full sweep after every merge.
**Review verdict: PASS** (2 of 3 slices bounced once each; both fixed+tested pre-merge).
This completes LANE 3 (J #53 + K #55, 7 slices).

## Per-slice
- **S43 — clipdoc module** (`9f69fd9`): pure `clipdoc.ts` — versioned envelope (graph/section/
  song/patch), defensive parse (typed `ClipParseError`, never throws), remap-on-materialize
  (re-key by default, content-equal reuse, built-in effect ids verbatim, `:default` preset ids
  track their effect). Closure via SHARED S40 `extractSongClosure` then un-namespaced —
  equivalence by construction + test. A→B→A no-dup and double-paste-one-dup-set proven.
  **Bounce:** same-pass effect-id mint collision (name-derived ids, two same-name effects in one
  closure) → fixed (mint tracks pass-local emissions) + regression test.
- **S45 — patch setProject + diff dialog** (`d33b0c6`, no bounce): core `projectPatchSchema`
  (kit+inputMap+output, excludes authored content); protocol `setProject`; server validate →
  apply-once (single `reloadKit`, no granular replay) → persist → broadcast, editor-gated
  (deny-by-default confirmed), invalid = error reply + monitor, ZERO partial apply; voice-host
  `adoptPatch`; pure `patch-diff` + `PatchDiffDialog` (drums/pixels/hosts/protocol, explicit
  confirm) + toolbar. No optimistic local write — server-authoritative.
- **S44 — clipboard copy/paste UI** (final merge, after S45): copy graph/section/song from the
  RESOLVED view (S42) → system clipboard (+ in-app section clip kept as blocked-read fallback);
  paste = parse → toast on non-ClipDoc → `remapClipDoc` → union+insert; paste-song destination
  dialog (this-show AND library — doc 11's locked recommendation); paste-text fallback dialog.
  New generic **Toast primitive** (`ui/toast.svelte.ts` + `ToastHost`) with styleguide entry +
  `design-system.html` regenerated in the same change (AGENTS.md rule honored).
  **Bounce (defect CLASS, 3 sites):** verbatim node/edge ids inside pasted/adopted closures were
  never counter-reserved → cross-machine paste or referenced-graph edit could mint a duplicate
  node id (ambiguous edges, misrouted modulation ports). Fixed: `applyRemapResult` +
  song→library paste + S41's boot/adopt seam all reserve via new `idsFromLibrarySong`/
  `idsFromSongLibrary`; counter-proof tests.

## Cross-slice seams (group review)
- S44 rejects `kind:'patch'` with a pointer to the Patch view; S45 owns patch end-to-end. The
  parallel pair merged with ZERO conflicts (ownership fences held: S44 = authored kinds +
  generic UI primitives, S45 = patch-specific components).
- Clipboard closure ≡ library closure (shared code, tested) — doc 11's "build once, share" goal.
- Doc 11's two PRD decisions shipped as recommended: destination dialog with both options;
  paste-text fallback where clipboard read is blocked.

## Non-blocking notes
1. No global Cmd+C/V binding (S44 deviation — deliberate; copy/paste via row menus + headers).
2. File export/import adapter (doc 11 "trivial later add") not in scope, seam ready.

## Gates (final, on synced branch)
typecheck 0 (6 pkgs) · tests 1752 / 0 failed / 0 skipped (core 533 / io 13 / protocol 1 /
server 190 / web 1015) · every slice swept green pre- and post-merge by impl + orch.

## Context pack for dependent work
- None of the remaining Lane 4 groups (C, D, L) depends on K. The `setProject` bulk-apply +
  `named-blob-store` seams are the reusable patterns if L's controller work needs them.

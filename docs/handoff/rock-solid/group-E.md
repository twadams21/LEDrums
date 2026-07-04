# Group E — Input routing & section looks (issue #50, lane 1)

Lane-1 orch group report. Branch: `group/E` (off `rock-solid` @ 88c6acf, post group-A merge).
Six slices, all merged `--no-ff`, full sweep after every merge.

## Slices

- **S12 — Kill echo re-fire + offline-gated sim** (`slice/S12` @ 1448c24): the authority
  principle landed — server `input` echo is learn-only (never fires the sim); every outbound
  path (`forwardMidi`, `hit`, `fireSectionGraph`) fires the local sim only when the link is
  closed. One connected MIDI hit = exactly one authoritative fire (count-asserted server test).
- **S13 — Keyboard fireGraph intent message** (`slice/S13` @ 8bd1991): new
  `{t:'fireGraph',graphKey,velocity}` in `packages/protocol`; server fires the exact graph once
  (path `fire-graph`, no re-resolution — kills the old triple-fire); stale key → `graph-missed`
  `no-such-graph`; offline keyboard still fires the sim.
- **S14 — Drum-link indicator + unrouted-input event** (`slice/S14` @ f571b9c): pure
  `zoneLinkForSource`/reverse resolvers; link badge + tooltip on the trigger node face (new
  reusable `NodeCard.badge` slot); cross-reference hints in both inspectors; core
  `input-unrouted` diagnostic → "Unrouted input" Monitor event.
- **S15 — Engine section looks: spawn/release** (`slice/S15` @ 24f15f6): core engine spawns/
  releases per-bus looks on `recallSection` (structural mirror of the sim — release non-oneshot
  then spawn, repeated recall doesn't stack, empty looks no-op); show-builder bridges looks;
  the sim's own section-recall spawn gated on link (the double-spawn S12 deferred here).
  Sim/engine parity + determinism tests in a previously zero-test area.
- **S16 — Looks authoring UI + model** (`slice/S16` @ cc163a8): `SetlistSection.looks`
  (per-bus map) with defensive idempotent persistence coercion (pre-S16 shows load unchanged,
  round-trip untouched); `store.sections` now derives from authored songs so authored looks
  flow through the unchanged S15 bridge; SectionInspector "Looks" group (per-bus effect picker
  + None) with live resync.
- **S17 — LayersDock server truth** (`slice/S17` @ a19ff28): per-voice stats streamed
  (`VoiceStat` in protocol; `stats().voices` in the engine); pure `dock-voices.ts` seam
  normalizes sim `Voice` and wire `VoiceStat` into one `DockVoice` and picks the source by
  link state — dock and visualiser can no longer disagree; `busLevels` clobber fixed.

## Merges

- Dependency order held: S12 first; S13/S14/S15 parallel off it; S17 then S16.
- S17 rebased itself onto post-S14/S15 group/E (one trivial engine.ts import conflict, resolved
  by its impl). S14, S15, S16 merged clean (S16 verified zero overlap with S17's files).
- Full sweep after every merge. Final: typecheck 0 (6 pkgs), **1111 tests / 0 skips**
  (io 13 · core 251 · protocol 1 · server 176 · web 670). Group diff 46 files +2821/−106.

## Group review (full diff vs docs 03+04 + slice file + AGENTS.md)

Verdict: **PASS, no findings requiring fixes.**

- The authority principle is enforced at every seam it was specced for: echo path (S12), fire
  paths (S12/S13), section-recall sim spawn (S15), dock source-selection (S17). Verified in
  code, each gate commented with the doc-03 rationale.
- Core purity verified: `packages/core` changes (engine, diagnostics, types) import only core
  modules; the wire contract lives in `packages/protocol` (fireGraph, VoiceStat); no io/desktop
  files touched anywhere in the group.
- Determinism: look voices are deterministic by construction (release-before-spawn + fixed
  PlayAction; no state-prefix machinery needed — S15's report documents why); hit-path slot
  state prefixes unchanged.
- Migration contract honored (S16): coercion defaults absent looks to `{}`, drops corrupt
  entries, idempotent — with parity + round-trip tests per the PRD rule.
- Design system engaged on UI slices (S14 badge slot, S16 Looks group; design-system.html
  regenerated in-change); `/make-interfaces-feel-better` applied.
- Deviations reviewed + accepted: S13's handler sends no `{t:'input'}` echo (nothing to learn
  from an intent message; monitor coverage via monitorInput + graph diagnostics); S14's
  `input-unrouted` re-labels the raw-miss case (rename, not a duplicate event).

## Context pack for dependent groups/lanes

- **Lane 2 (F–I)**: the authority principle is now load-bearing — any new fire/preview path
  MUST gate local sim work on `link !== 'open'` (see S12's report for the seams). S13's
  `fireGraph` is the template for future intent messages (validate → diagnostics → no echo).
- **S38 (signal previews) + thumbnails (G)**: S17's `VoiceStat` stream + `dock-voices.ts`
  normalization pattern is the reference for surfacing server-side runtime state in UI.
- **Looks model**: authored looks live on `SetlistSection.looks` keyed by bus id, bridged at
  `show-builder.ts` — section ids are shared between `Show.sections` (looks) and
  `Show.songs[].sections` (slots); keep them aligned (S15 report § data model).
- **Owed live spot-check (browser + hardware, rolls into the final gate)**: one-hit-one-fire
  on real MIDI, keyboard fireGraph, look spawn on recall (engine vs visualiser vs dock
  agreement), looks authoring round-trip, drum-link badges, unrouted-input Monitor events.

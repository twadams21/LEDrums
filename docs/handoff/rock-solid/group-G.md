# Group G — Effect timebase & thumbnails (issue #52) — lane-2 orch report

Branch: `group/G` @ 7477b43 (off group/F 8bdb138; integrated with rock-solid b363239 —
which now contains group/F — pre-handoff). Slices S25–S27, all merged.
**Review verdict: PASS — no findings requiring fixes.**
Final sweep: typecheck 0 errors (6 projects) · **1346 tests passed, 0 failed, 0 skipped**
(core 363, web 793, server 176, io 13, protocol 1).

## Per-slice

| Slice | What landed | Report |
|---|---|---|
| S25 timebase infra + chase tracer | `EffectGenerator.timebase` ('voice'\|'absolute', default absolute); bridge feeds voice-timebase gens hit-relative clock (ctx.timeMs=age, beat=age×bpm), zero signature change; chase converted; web bridge mirrors (parity-tested); mono-steal age reset locked with test | S25.md |
| S26 conversion batch | 9 free-running trigger effects → voice (flag-only, restart goldens each); 7 intrinsic age-readers declared voice (byte-parity) so the flag is a complete contract; 41-effect audit + EXECUTABLE audit test (registry pinned to the doc) | S26.md |
| S27 thumbnail fidelity | Thumb renderer loops synthetic hit age (1600ms), timebase-aware, generic over the flag (no id special-cases); transport beat from the same clock; reduced-motion static frame preserved; **fixed real bug: synthetic trigger drumId '' made drum-keyed thumbs render BLACK**; 41-thumb audit: all render, 39 animate | S27.md |

## Merges & conflicts

- S25 → S27 → S26, `--no-ff`, full sweep after each (all green). Zero conflicts — S26/S27
  surface separation held exactly as assigned (verified in both diffs).
- Pre-handoff integration merges of rock-solid: tracker-only, trivial.
- NOTE: group/G was branched **off group/F** (not rock-solid) because S26's conversions edit
  the same effect files as F's colour pass. F is now in rock-solid, so the master's merge of
  G is clean history-wise.

## Review (full diff vs doc 06 §A/§B + slice file + AGENTS.md)

- **Core purity clean** over the 30-file diff (grep: no Node/DOM/IO imports).
- **Determinism**: explicitly tested — S26 goldens identical across separate runs; render loop
  stays a pure function of (time, inputs, model); voice clock derives from trigger age only.
- **The no-phase-snap invariant is now a pinned test**: base + texture looks are birth-time
  independent at fixed engine time (section recall can never phase-snap looks).
- **Executable audit**: registry timebase classification asserted against all 41 effects in
  compositor.test.ts — audit doc and code can't drift.
- No UI components added/changed (S27 is a pure render seam) → no design-system obligations.
- **Deviations reviewed and ACCEPTED** (all documented in S26.md/S27.md):
  1. Textures stay `absolute` — doc 06 wished "voice when trigger-hosted"; a per-effect flag
     cannot express per-hosting timebase, and converting would phase-snap looks (hard
     constraint). Needs voice/bus-level timebase — flagged as future work (doc 06 §C
     modifiers / doc 10 modulation territory).
  2. helix / wipe-3d left absolute for scope discipline (follow-up candidates; asymmetry with
     converted orbit-rings documented).
  3. S27's drumId fix went beyond the literal ask (justified — thumbs were black, worse than
     the frozen-bright the spec assumed).

## Residuals for the tracker (non-blocking)

- Per-hosting (voice/bus-level) timebase for trigger-hosted textures — future slice candidate.
- helix / wipe-3d conversion follow-ups.
- Thumbs: colour-melody + meter-eq static by nature (input-driven); seq-driven effects
  (confetti-burst et al) animate but don't hard-restart at the loop seam; velocity-flames
  hybrid (flame=age, flicker=wall-clock) noted in the timebase audit for any future thumb pass.

## Context pack for dependent groups (H, I; S38)

- **Timebase contract**: `gen.timebase` is now complete over the registry — 'voice' ⇒
  hit-relative ctx (bridge seams: `generator-bridge.ts:115` engine, `render.ts:221` web sim;
  both must stay mirrored). Modifiers (H) that wrap generators inherit the host voice's clock
  through the same bridge — do not re-derive time inside modifier code.
- **Per-voice state rule** (S25 recipe, S26-verified): anything keyed on a voice must reset
  with the voice (spawn stamps bornAtMs; genState is per-voice). Modifier state (H) should
  follow the same lifecycle.
- **Thumbnail renderer** (`effect-thumb-render.ts`) is timebase-generic; if H's modifiers get
  thumbs, the same looping-age drive applies. S38 signal previews: the thumb clock pattern +
  S17's VoiceStat stream (see group-E.md) are the two references.

# Spatial/audio experiment — working tracker

Issue: https://github.com/twadams21/LEDrums/issues/214
Source: Trent's 2026-09-07 session; Fable/low workers requested. Base origin/main fec83bee.

## Ownership

- Integration: `/Users/trent/Documents/dev/ledrums-wt/spatial-audio`, `feat/spatial-audio-lab` (Pi parent).
- F1: `feat/spatial-field` merged at f2d191b5. twux `spatial-field-dab29f` killed and worktree removed after integration.
- A1: `feat/audio-modulation` implementation ca304a0f and report f05924db merged. twux `audio-modulation-2e4362` killed and worktree removed after integration.
- T1: `feat/midi-clock` merged at 75743dbf. twux `midi-clock-2adba1` killed and its worktree removed after integration.

The original `/Users/trent/Documents/dev/ledrums` tree and all unrelated tmux sessions/processes are out of bounds. The CAD agent's dirty .mex/docs files remain untouched.

## Sequence

1. F1 Spatial Field and A1 Audio run concurrently (max two workers).
2. Merge F1, inspect its result and close its twux session when no follow-up remains.
3. Launch T1 MIDI Clock in F1's vacated slot; merge Audio and Clock serially.
4. One integration typecheck/test sweep, one design-system generation and sequential UI captures. Fix actual failures; no mandatory multi-agent review ceremony.
5. PR and cleanup of all task-owned workers/dev servers/finished worktrees. No desktop OTA publication.

## State

- Spec published and user confirmed effect/audio seams.
- F1 merged: generator + 16 new tests; worker targeted core 174/web 33 green, core typecheck green. No formal review pipeline.
- T1 merged before A1 (finished first; no dependency). Targeted core/protocol/server/web tests and typechecks green per report; Rust formatted but compilation deferred to CI. Parent's two correctness observations (tempo-step re-lock, Start-with-no-pulse timeout) fixed by worker with tests.
- A1 merged. Parent's capture-startup observations (cleanup on resume/setup failure, preserve user activation) fixed by worker; parent added immediate partial-resource disposal on Stop during a pending permission/resume. The mounted real-controller Enable/Stop regression passes. No heavy review pipeline.
- Full serial sweep passed: core 1556, IO 98, worker 57, protocol 15, server 627, web 2689; desktop scripts 83. Existing skips: core 5, web 1. The additional mounted AudioInputPanel test and final capture tests pass separately. Integrated typecheck and dead-code verification clean; design system regenerated.
- Connected Chrome smoke used a synthetic MediaStream, not a real microphone: zero getUserMedia calls at boot; Enable produced nonzero analysed features and lit server-rendered Spatial Field pixels; Stop released the stream and returned zero-brightness mapped output to dark. Synthetic WebMIDI reached Running/locked, then Lost/not-playing after pulses ceased. No browser console/page errors.
- Strict pnpm ui-shot captures cover audio Running/permission denied, Audio inspector and manual MIDI Clock. Additional connected smoke captures cover real analysis meters and clock Running/Lost. A clipped band selector was found visually and changed to a stacked Field so all four choices remain visible.
- Final clock reconnect check found an unresolved browser port displayed as Native; the picker now shows an explicit missing browser-input state. Clock helper/store tests: 20 passing. Manual recovery and full unresolved-input captures inspected; use a taller viewport when Settings clips a target.
- All task-owned preview processes stopped; ports 5374/4374/9374 verified closed. Only pre-existing tmux sessions remain. Captures and the synthetic smoke script archived at `/Users/trent/.pi/agent/artifacts/ledrums-spatial-audio-214-20260907` before integration-worktree cleanup.
- Integration PR: https://github.com/twadams21/LEDrums/pull/215 (live check/merge status is on GitHub). No desktop release. See INTEGRATION-RESULT.md for evidence and outstanding human checks. The integration worktree is removed only after its commits are safely merged; worker worktrees are already removed.
- Field full-app and inspector captures verified via connected preview on `http://localhost:5374`, isolated project data under `.ui-shots/projects`, output disabled. Preview stopped after captures (bt-8); ports 5374/4374/9374 confirmed closed. A header-only Kit preview crop is not evidence; use full-app shot or `.viz` container next pass.
- ui-shot gotcha: Vite binds localhost/IPv6 under pnpm dev; `127.0.0.1` was unreachable, causing the screenshot tool to auto-spawn a detached default dev stack. That task-owned orphan was identified by cwd/PIDs and terminated (24769/25006/25047/25281 confirmed gone). Always HTTP-probe the exact UI_SHOT_BASE before capture.
- Dev-only fireEffect seam now records the created effect, so follow-up `select:effect` targets the effect instead of falling back to Output. Confirmed by spatial-field-controls capture.
- Custom `UI_SHOT_BASE` now fails fast without auto-start when unreachable (e8af9583); manual absent-port probe exited 1 and spawned no preview. This prevents the observed orphan path.
- Warm generator-only CPU probe on this Intel Mac, default 2192 pixels / 500 measured frames / no emissions: median 0.844ms, p95 1.356ms. Not an end-to-end latency or worst-case polyphony claim.

## Known limits to preserve

- Ableton audio requires routing to an input/loopback device; not automatic system capture.
- MIDI clock input is new work, not an existing capability.
- Per-voice effect bridge feeds a voice-local synthetic hit; no promise of every subsequent global hit disturbing one looping voice.
- Browser/device behavior and actual kit response need a human drive; synthetic tests cannot establish them.

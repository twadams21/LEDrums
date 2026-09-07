# Spatial/audio experiment — working tracker

Issue: https://github.com/twadams21/LEDrums/issues/214
Source: Trent's 2026-09-07 session; Fable/low workers requested. Base origin/main fec83bee.

## Ownership

- Integration: `/Users/trent/Documents/dev/ledrums-wt/spatial-audio`, `feat/spatial-audio-lab` (Pi parent).
- F1: `feat/spatial-field` merged at f2d191b5. twux `spatial-field-dab29f` killed and worktree removed after integration.
- A1: `/Users/trent/Documents/dev/ledrums-wt/audio-modulation`, `feat/audio-modulation`, twux `audio-modulation-2e4362` (Fable/low).
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
- A1 finishing UI/tests. Parent's capture-startup resource observations (cleanup on resume/setup failure, preserve user activation) fixed by worker with tests. No heavy review pipeline.
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

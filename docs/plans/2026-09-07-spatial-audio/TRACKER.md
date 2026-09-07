# Spatial/audio experiment — working tracker

Issue: https://github.com/twadams21/LEDrums/issues/214
Source: Trent's 2026-09-07 session; Fable/low workers requested. Base origin/main fec83bee.

## Ownership

- Integration: `/Users/trent/Documents/dev/ledrums-wt/spatial-audio`, `feat/spatial-audio-lab` (Pi parent).
- F1: `/Users/trent/Documents/dev/ledrums-wt/spatial-field`, `feat/spatial-field`, twux `spatial-field-dab29f` (Fable/low).
- A1: `/Users/trent/Documents/dev/ledrums-wt/audio-modulation`, `feat/audio-modulation`, twux `audio-modulation-2e4362` (Fable/low).
- T1: not launched; reuse the concurrency slot after F1 closes, separate clock worktree.

The original `/Users/trent/Documents/dev/ledrums` tree and all unrelated tmux sessions/processes are out of bounds. The CAD agent's dirty .mex/docs files remain untouched.

## Sequence

1. F1 Spatial Field and A1 Audio run concurrently (max two workers).
2. Merge F1, inspect its result and close its twux session when no follow-up remains.
3. Launch T1 MIDI Clock in F1's vacated slot; merge Audio and Clock serially.
4. One integration typecheck/test sweep, one design-system generation and sequential UI captures. Fix actual failures; no mandatory multi-agent review ceremony.
5. PR and cleanup of all task-owned workers/dev servers/finished worktrees. No desktop OTA publication.

## State

- Spec published and user confirmed effect/audio seams.
- F1 and A1 dispatched; plans committed in 5c4d63bb.
- T1 detailed plan prepared.
- Dependencies installed in integration tree; no task-owned dev server running.

## Known limits to preserve

- Ableton audio requires routing to an input/loopback device; not automatic system capture.
- MIDI clock input is new work, not an existing capability.
- Per-voice effect bridge feeds a voice-local synthetic hit; no promise of every subsequent global hit disturbing one looping voice.
- Browser/device behavior and actual kit response need a human drive; synthetic tests cannot establish them.

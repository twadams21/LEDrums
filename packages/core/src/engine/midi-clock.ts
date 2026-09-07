/**
 * MIDI Clock transport reducer — pure, injected-time, no wall clock.
 *
 * Standard MIDI beat clock: 24 timing-clock pulses (0xF8) per quarter note, plus Start (0xFA),
 * Continue (0xFB), Stop (0xFC) and Song Position Pointer (0xF2, in 16th notes). The host that
 * receives the bytes stamps each event with ITS monotonic receipt time and feeds it here; the
 * reducer owns beat position, play state and the tempo estimate, and never reads a clock itself,
 * so a synthetic stream drives it deterministically in tests.
 *
 * Position is exact: every counted tick advances the beat by exactly 1/24, so a constant stream
 * never accumulates phase error over bars. Tempo is only ever an estimate used for display and
 * for the render-time interpolation between ticks (`advanceMidiClock`), which is clamped so it
 * can never run past the next tick — a tick that then arrives is never double counted.
 */

export const MIDI_CLOCK_PPQN = 24;

/** No pulse for this long while running ⇒ the clock is lost (engineering default, not a spec). */
export const MIDI_CLOCK_LOST_MS = 1000;

/** Plausible external tempo range. Pulse intervals outside it are noise, not a tempo. */
export const MIDI_CLOCK_MIN_BPM = 20;
export const MIDI_CLOCK_MAX_BPM = 300;

/** Pulse intervals kept for the tempo estimate — one quarter note's worth. */
const INTERVAL_HISTORY = MIDI_CLOCK_PPQN;
/** Intervals needed before the estimate is reported as locked (a quarter of a beat). */
const LOCK_MIN_INTERVALS = 6;
/** An interval this far from the running median is an outlier (a scheduling hiccup, a burst of
    queued pulses) and is not folded into the estimate. */
const OUTLIER_RATIO = 1.6;
/** A run of this many consecutive outliers that agree with EACH OTHER (within
    {@link RELOCK_SPREAD}) is not noise but a tempo step (120 → 240): the history is replaced by
    the run, so an abrupt DAW tempo change re-locks within a quarter of a beat instead of being
    rejected forever. */
const RELOCK_RUN = LOCK_MIN_INTERVALS;
const RELOCK_SPREAD = 1.2;

// 0.5% slack so a stream sitting exactly on a bound is not rejected by float rounding.
const MIN_INTERVAL_MS = (60_000 / (MIDI_CLOCK_MAX_BPM * MIDI_CLOCK_PPQN)) * 0.995;
const MAX_INTERVAL_MS = (60_000 / (MIDI_CLOCK_MIN_BPM * MIDI_CLOCK_PPQN)) * 1.005;

export type MidiClockCommand = 'tick' | 'start' | 'continue' | 'stop' | 'position';

export interface MidiClockEvent {
  command: MidiClockCommand;
  /** Song position in 16th notes (0..16383), `position` only. */
  position?: number;
  /** Monotonic receipt time, ms — whatever clock the host runs its transport on. */
  atMs: number;
}

/**
 * - `waiting`: mode is on, no pulse has been counted yet (or a Start arrived before any pulse).
 * - `running`: pulses arriving and the transport is playing.
 * - `stopped`: a Stop was received; pulses may keep arriving (Ableton keeps sending them) and
 *   refresh the tempo, but the beat is frozen.
 * - `lost`: pulses stopped arriving while running — beat frozen, not playing, tempo retained.
 */
export type MidiClockStatus = 'waiting' | 'running' | 'stopped' | 'lost';

export interface MidiClockState {
  status: MidiClockStatus;
  playing: boolean;
  /** Beat position in quarter notes at the last counted tick (exact, tick-counted). */
  beat: number;
  /** Receipt time of the last pulse; null before the first and after Start/Continue, when the
      next pulse ANCHORS the position (it is the downbeat / resume point) rather than advancing it. */
  lastTickAtMs: number | null;
  /** Accepted pulse intervals, newest last, bounded to {@link INTERVAL_HISTORY}. */
  intervals: readonly number[];
  /** Consecutive intervals rejected as outliers, bounded to {@link RELOCK_RUN}; a consistent run
      replaces the history (tempo step). Cleared by any accepted interval. */
  rejected: readonly number[];
  /** Receipt time of the Start/Continue (or the Lost→resume anchor) we are awaiting the first
      pulse for, so a Start with no clock behind it still becomes Lost rather than running forever. */
  awaitingPulseSinceMs: number | null;
  /** Estimated tempo from the interval history, or null before enough pulses. */
  estimatedBpm: number | null;
  /** Tempo used until the estimate locks (the manual/config bpm at the time of creation). */
  seedBpm: number;
  /** Whether the transport was playing when the clock was lost, so a returning pulse resumes. */
  resumeOnPulse: boolean;
}

export function createMidiClockState(seedBpm: number): MidiClockState {
  return {
    status: 'waiting',
    playing: false,
    beat: 0,
    lastTickAtMs: null,
    intervals: [],
    rejected: [],
    awaitingPulseSinceMs: null,
    estimatedBpm: null,
    seedBpm: Number.isFinite(seedBpm) && seedBpm > 0 ? seedBpm : 120,
    resumeOnPulse: false,
  };
}

/** The tempo the transport should run at: the locked estimate, else the seed. */
export function midiClockBpm(state: MidiClockState): number {
  return state.estimatedBpm ?? state.seedBpm;
}

/** Whether the reported tempo is measured from enough pulses to be trusted. */
export function midiClockLocked(state: MidiClockState): boolean {
  return state.estimatedBpm !== null;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function estimate(intervals: readonly number[]): number | null {
  if (intervals.length < LOCK_MIN_INTERVALS) return null;
  let total = 0;
  for (const v of intervals) total += v;
  const meanMs = total / intervals.length;
  return 60_000 / (meanMs * MIDI_CLOCK_PPQN);
}

interface IntervalHistory {
  intervals: readonly number[];
  rejected: readonly number[];
}

/** Fold one pulse interval into the bounded history, rejecting what cannot be a tempo. A
    consistent run of rejections is a tempo step and replaces the history (bounded re-lock). */
function acceptInterval(history: IntervalHistory, intervalMs: number): IntervalHistory {
  const { intervals, rejected } = history;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return history;
  if (intervalMs < MIN_INTERVAL_MS || intervalMs > MAX_INTERVAL_MS) return history;
  if (intervals.length >= LOCK_MIN_INTERVALS) {
    const ref = median(intervals);
    if (intervalMs > ref * OUTLIER_RATIO || intervalMs < ref / OUTLIER_RATIO) {
      const run = rejected.length >= RELOCK_RUN ? rejected.slice(1) : rejected.slice();
      run.push(intervalMs);
      if (run.length >= RELOCK_RUN) {
        const lo = Math.min(...run);
        const hi = Math.max(...run);
        if (hi <= lo * RELOCK_SPREAD) return { intervals: run, rejected: [] }; // tempo step: re-lock
      }
      return { intervals, rejected: run };
    }
  }
  const next = intervals.length >= INTERVAL_HISTORY ? intervals.slice(1) : intervals.slice();
  next.push(intervalMs);
  return { intervals: next, rejected: [] };
}

/** Expected pulse spacing at the current tempo, ms. */
function pulseIntervalMs(state: MidiClockState): number {
  return 60_000 / (midiClockBpm(state) * MIDI_CLOCK_PPQN);
}

/**
 * A gap this long between pulses means the stream was interrupted rather than merely jittered:
 * the interval history restarts (the old tempo is retained for display until a new one locks).
 * The 4× rule is measured against the pulses actually seen, never the seed tempo, so a slow DAW
 * can lock from a fast seed — and after a reset the empty history re-accumulates at the new rate.
 */
function gapResetsHistory(intervals: readonly number[], gapMs: number): boolean {
  if (gapMs >= MIDI_CLOCK_LOST_MS) return true;
  return intervals.length > 0 && gapMs > median(intervals) * 4;
}

/** Apply one received clock message. Pure: returns the next state. */
export function applyMidiClockEvent(state: MidiClockState, ev: MidiClockEvent): MidiClockState {
  switch (ev.command) {
    case 'start':
      // Start = play from the top. Ableton sends Start, then the first pulse, so the beat is 0
      // until that pulse lands; we are "running" (playing) even before it does.
      return {
        ...state,
        status: 'running',
        playing: true,
        beat: 0,
        // The next pulse starts a fresh interval history — the time since the last pulse of the
        // previous run is not a tempo.
        lastTickAtMs: null,
        awaitingPulseSinceMs: ev.atMs,
        resumeOnPulse: false,
      };
    case 'continue':
      return { ...state, status: 'running', playing: true, lastTickAtMs: null, awaitingPulseSinceMs: ev.atMs, resumeOnPulse: false };
    case 'stop':
      return { ...state, status: 'stopped', playing: false, awaitingPulseSinceMs: null, resumeOnPulse: false };
    case 'position': {
      const position = ev.position;
      if (position === undefined || !Number.isFinite(position) || position < 0 || position > 16383) return state;
      // 16th notes → quarter notes. Ableton sends the pointer while stopped, ahead of Continue.
      return { ...state, beat: Math.floor(position) / 4 };
    }
    case 'tick':
      return applyTick(state, ev.atMs);
  }
}

function applyTick(state: MidiClockState, atMs: number): MidiClockState {
  // Tempo: fold the interval in (or restart the history after a real gap). A duplicate receipt
  // timestamp (the host batched two pulses) is a real pulse for POSITION — it is only excluded
  // from the tempo estimate, since a zero interval is not a tempo.
  let history: IntervalHistory = { intervals: state.intervals, rejected: state.rejected };
  if (state.lastTickAtMs !== null) {
    const gap = atMs - state.lastTickAtMs;
    history = gapResetsHistory(history.intervals, gap) ? { intervals: [], rejected: [] } : acceptInterval(history, gap);
  }
  const { intervals, rejected } = history;
  const estimatedBpm = estimate(intervals) ?? state.estimatedBpm;

  // Lost → a pulse is back. Resume where we froze if we were playing, anchoring this pulse to
  // that position: no catch-up, the pulses that never arrived are not owed.
  if (state.status === 'lost') {
    const resume = state.resumeOnPulse;
    return {
      ...state,
      status: resume ? 'running' : 'stopped',
      playing: resume,
      lastTickAtMs: atMs,
      awaitingPulseSinceMs: null,
      intervals,
      rejected,
      estimatedBpm,
      resumeOnPulse: false,
    };
  }

  // Stopped (or never started): pulses refresh the tempo only. Playback needs Start/Continue.
  if (!state.playing) {
    return { ...state, lastTickAtMs: atMs, intervals, rejected, estimatedBpm };
  }

  // The first pulse after Start/Continue marks the position (Start's first clock IS beat 0);
  // every later pulse advances by one 24th.
  const anchoring = state.lastTickAtMs === null;
  return {
    ...state,
    status: 'running',
    beat: anchoring ? state.beat : state.beat + 1 / MIDI_CLOCK_PPQN,
    lastTickAtMs: atMs,
    awaitingPulseSinceMs: null,
    intervals,
    rejected,
    estimatedBpm,
  };
}

export interface MidiClockSnapshot {
  state: MidiClockState;
  /** Beat position for rendering: the tick-counted beat plus a clamped interpolation. */
  beat: number;
  bpm: number;
  playing: boolean;
}

/**
 * Advance to render time `nowMs`: detect a lost stream, and interpolate the beat between the
 * last pulse and the one expected next (clamped at one pulse so a late tick never double counts).
 */
export function advanceMidiClock(state: MidiClockState, nowMs: number): MidiClockSnapshot {
  let next = state;
  if (next.status === 'running') {
    // Silence is measured from the last pulse, or from the Start/Continue still awaiting its
    // first pulse — a Start with no clock behind it must not run forever.
    const since = next.lastTickAtMs ?? next.awaitingPulseSinceMs;
    if (since !== null && nowMs - since >= MIDI_CLOCK_LOST_MS) {
      // Freeze where the render had reached: the interpolation below had been clamped one pulse
      // ahead of the last counted tick for most of the silence, so that is the honest position.
      const frozenBeat = next.lastTickAtMs !== null ? next.beat + 1 / MIDI_CLOCK_PPQN : next.beat;
      next = { ...next, status: 'lost', playing: false, beat: frozenBeat, resumeOnPulse: true, awaitingPulseSinceMs: null };
    }
  }
  const bpm = midiClockBpm(next);
  let beat = next.beat;
  if (next.status === 'running' && next.playing && next.lastTickAtMs !== null) {
    const fraction = (nowMs - next.lastTickAtMs) / pulseIntervalMs(next);
    beat += Math.min(1, Math.max(0, fraction)) / MIDI_CLOCK_PPQN;
  }
  return { state: next, beat, bpm, playing: next.playing };
}

/** Decode a raw MIDI system byte run into a clock command, or null when it is not one. Shared by
    the browser WebMIDI parser and the server-side tests; the desktop bridge mirrors it in Rust. */
export function midiClockCommandForStatus(status: number): MidiClockCommand | null {
  switch (status) {
    case 0xf8: return 'tick';
    case 0xfa: return 'start';
    case 0xfb: return 'continue';
    case 0xfc: return 'stop';
    case 0xf2: return 'position';
    default: return null;
  }
}

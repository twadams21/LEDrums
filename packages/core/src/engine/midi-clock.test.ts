import { describe, expect, it } from 'vitest';
import {
  advanceMidiClock,
  applyMidiClockEvent,
  createMidiClockState,
  midiClockBpm,
  midiClockCommandForStatus,
  midiClockLocked,
  MIDI_CLOCK_LOST_MS,
  MIDI_CLOCK_PPQN,
  type MidiClockState,
} from './midi-clock';

function pulseMs(bpm: number): number {
  return 60_000 / (bpm * MIDI_CLOCK_PPQN);
}

/** Feed `count` evenly spaced pulses starting at `from` (the first pulse lands AT `from`). */
function pulses(state: MidiClockState, bpm: number, count: number, from: number, jitter: (i: number) => number = () => 0): { state: MidiClockState; at: number } {
  let at = from;
  for (let i = 0; i < count; i++) {
    state = applyMidiClockEvent(state, { command: 'tick', atMs: at + jitter(i) });
    at += pulseMs(bpm);
  }
  return { state, at: at - pulseMs(bpm) };
}

describe('MIDI clock reducer', () => {
  it('starts waiting, not playing, seeded from the manual tempo', () => {
    const s = createMidiClockState(98);
    expect(s.status).toBe('waiting');
    expect(s.playing).toBe(false);
    expect(midiClockBpm(s)).toBe(98);
    expect(midiClockLocked(s)).toBe(false);
  });

  it('the first pulse after Start is beat 0, 24 pulses later is beat 1, phase-exact over bars', () => {
    let s = applyMidiClockEvent(createMidiClockState(120), { command: 'start', atMs: 0 });
    s = pulses(s, 120, 1, 0).state;
    expect(s.beat).toBe(0);
    s = pulses(s, 120, 24, pulseMs(120)).state;
    expect(s.beat).toBeCloseTo(1, 9);
    s = pulses(s, 120, 24 * 4 * 32, 25 * pulseMs(120)).state; // 32 more bars
    expect(s.beat).toBeCloseTo(1 + 4 * 32, 9);
  });

  it.each([20, 60, 120, 174, 300])('locks the tempo estimate at %i bpm', (bpm) => {
    let s = applyMidiClockEvent(createMidiClockState(100), { command: 'start', atMs: 0 });
    s = pulses(s, bpm, 6, 0).state;
    expect(midiClockLocked(s)).toBe(false); // 6 pulses = 5 intervals: not yet
    s = pulses(s, bpm, 24, 6 * pulseMs(bpm)).state;
    expect(midiClockLocked(s)).toBe(true);
    expect(midiClockBpm(s)).toBeCloseTo(bpm, 6);
  });

  it('holds the seed tempo until enough pulses arrive', () => {
    let s = applyMidiClockEvent(createMidiClockState(100), { command: 'start', atMs: 0 });
    s = pulses(s, 140, 4, 0).state;
    expect(midiClockBpm(s)).toBe(100);
  });

  it('smooths jitter and ignores outliers', () => {
    let s = applyMidiClockEvent(createMidiClockState(120), { command: 'start', atMs: 0 });
    // ±2ms jitter around a 20.83ms pulse
    s = pulses(s, 120, 48, 0, (i) => (i % 2 ? 2 : -2)).state;
    expect(midiClockBpm(s)).toBeCloseTo(120, 0);
    // a single burst-delayed pulse (2.5× spacing) does not drag the estimate
    const late = s.lastTickAtMs! + pulseMs(120) * 2.5;
    s = applyMidiClockEvent(s, { command: 'tick', atMs: late });
    expect(Math.abs(midiClockBpm(s) - 120)).toBeLessThan(1);
    expect(s.beat).toBeCloseTo(48 / 24, 9); // still counted as a pulse
  });

  it('tolerates duplicate and non-positive timestamps without corrupting tempo or position', () => {
    let s = applyMidiClockEvent(createMidiClockState(120), { command: 'start', atMs: 0 });
    s = pulses(s, 120, 30, 0).state;
    const at = s.lastTickAtMs!;
    s = applyMidiClockEvent(s, { command: 'tick', atMs: at }); // duplicate timestamp
    s = applyMidiClockEvent(s, { command: 'tick', atMs: at - 5 }); // clock went backwards
    expect(midiClockBpm(s)).toBeCloseTo(120, 6);
    expect(s.beat).toBeCloseTo(31 / 24, 9);
    expect(s.intervals.every((v) => v > 0)).toBe(true);
  });

  it('rejects intervals outside 20..300 bpm', () => {
    let s = applyMidiClockEvent(createMidiClockState(120), { command: 'start', atMs: 0 });
    s = pulses(s, 120, 24, 0).state;
    const n = s.intervals.length;
    s = applyMidiClockEvent(s, { command: 'tick', atMs: s.lastTickAtMs! + 1 }); // 2500 bpm
    expect(s.intervals.length).toBe(n);
  });

  it('Stop freezes the beat, pulses while stopped refresh tempo only, Continue resumes', () => {
    let s = applyMidiClockEvent(createMidiClockState(120), { command: 'start', atMs: 0 });
    let r = pulses(s, 120, 25, 0);
    s = applyMidiClockEvent(r.state, { command: 'stop', atMs: r.at + 1 });
    expect(s.status).toBe('stopped');
    expect(s.playing).toBe(false);
    r = pulses(s, 100, 48, r.at + pulseMs(100));
    s = r.state;
    expect(s.beat).toBeCloseTo(1, 9); // frozen
    expect(midiClockBpm(s)).toBeCloseTo(100, 6); // but the tempo followed the DAW
    s = applyMidiClockEvent(s, { command: 'continue', atMs: r.at + 1 });
    expect(s.status).toBe('running');
    r = pulses(s, 100, 25, r.at + pulseMs(100)); // first pulse anchors the resume point
    expect(r.state.beat).toBeCloseTo(2, 9);
  });

  it('Start resets to beat 0; a song position pointer seeks in 16ths', () => {
    let s = applyMidiClockEvent(createMidiClockState(120), { command: 'start', atMs: 0 });
    s = pulses(s, 120, 48, 0).state;
    s = applyMidiClockEvent(s, { command: 'stop', atMs: 2000 });
    s = applyMidiClockEvent(s, { command: 'position', position: 32, atMs: 2001 }); // 8 beats
    expect(s.beat).toBe(8);
    s = applyMidiClockEvent(s, { command: 'position', position: 20000, atMs: 2002 }); // invalid
    expect(s.beat).toBe(8);
    s = applyMidiClockEvent(s, { command: 'start', atMs: 3000 });
    expect(s.beat).toBe(0);
    expect(s.playing).toBe(true);
  });

  it('a Start before the first pulse is running but not locked', () => {
    const s = applyMidiClockEvent(createMidiClockState(120), { command: 'start', atMs: 0 });
    expect(s.status).toBe('running');
    expect(midiClockLocked(s)).toBe(false);
    const snap = advanceMidiClock(s, 500);
    expect(snap.beat).toBe(0);
    expect(snap.playing).toBe(true);
  });

  it('interpolates between pulses for rendering but never runs past the next pulse', () => {
    let s = applyMidiClockEvent(createMidiClockState(120), { command: 'start', atMs: 0 });
    s = pulses(s, 120, 25, 0).state; // anchor + 24 pulses: beat = 1 at t = 24 * pulse
    const t0 = s.lastTickAtMs!;
    expect(advanceMidiClock(s, t0).beat).toBeCloseTo(1, 9);
    expect(advanceMidiClock(s, t0 + pulseMs(120) / 2).beat).toBeCloseTo(1 + 0.5 / 24, 9);
    // 3 pulses late: clamped at one pulse ahead, so the real pulse is never double counted
    expect(advanceMidiClock(s, t0 + pulseMs(120) * 3).beat).toBeCloseTo(1 + 1 / 24, 9);
    s = applyMidiClockEvent(s, { command: 'tick', atMs: t0 + pulseMs(120) });
    expect(s.beat).toBeCloseTo(1 + 1 / 24, 9);
  });

  it('goes lost after the timeout, freezes and stops, keeps the tempo, resumes on the next pulse', () => {
    let s = applyMidiClockEvent(createMidiClockState(120), { command: 'start', atMs: 0 });
    s = pulses(s, 120, 48, 0).state;
    const t0 = s.lastTickAtMs!;
    const before = advanceMidiClock(s, t0 + MIDI_CLOCK_LOST_MS - 1);
    expect(before.state.status).toBe('running');
    const lost = advanceMidiClock(s, t0 + MIDI_CLOCK_LOST_MS);
    expect(lost.state.status).toBe('lost');
    expect(lost.playing).toBe(false);
    // frozen exactly where the clamped interpolation had been rendering (one pulse ahead)
    expect(lost.beat).toBeCloseTo(before.beat, 9);
    expect(lost.bpm).toBeCloseTo(120, 6);
    // still frozen much later
    expect(advanceMidiClock(lost.state, t0 + 60_000).beat).toBeCloseTo(lost.beat, 9);
    // a returning pulse anchors at the frozen position and resumes — no catch-up
    const back = applyMidiClockEvent(lost.state, { command: 'tick', atMs: t0 + 5000 });
    expect(back.status).toBe('running');
    expect(back.playing).toBe(true);
    expect(back.beat).toBeCloseTo(lost.beat, 9);
    const next = applyMidiClockEvent(back, { command: 'tick', atMs: t0 + 5000 + pulseMs(120) });
    expect(next.beat).toBeCloseTo(lost.beat + 1 / 24, 9);
    expect(back.intervals).toHaveLength(0); // history restarted after the gap
    expect(midiClockBpm(back)).toBeCloseTo(120, 6); // tempo retained for display
  });

  it('re-locks after an abrupt tempo step in either direction', () => {
    for (const [from, to] of [[120, 240], [120, 60], [100, 175]] as const) {
      let s = applyMidiClockEvent(createMidiClockState(from), { command: 'start', atMs: 0 });
      let r = pulses(s, from, 48, 0);
      expect(midiClockBpm(r.state)).toBeCloseTo(from, 3);
      r = pulses(r.state, to, 12, r.at + pulseMs(to));
      s = r.state;
      expect(midiClockBpm(s)).toBeCloseTo(to, 1);
      expect(midiClockLocked(s)).toBe(true);
      expect(s.beat).toBeCloseTo((47 + 12) / 24, 9); // every pulse still counted through the step
    }
  });

  it('a lone burst of outliers does not re-lock, only a consistent run does', () => {
    let s = applyMidiClockEvent(createMidiClockState(120), { command: 'start', atMs: 0 });
    s = pulses(s, 120, 48, 0).state;
    // 5 wildly inconsistent late pulses, then the real tempo resumes
    const spacings = [3, 2.2, 3.5, 2, 2.8];
    for (const k of spacings) s = applyMidiClockEvent(s, { command: 'tick', atMs: s.lastTickAtMs! + pulseMs(120) * k });
    expect(midiClockBpm(s)).toBeCloseTo(120, 3);
    s = pulses(s, 120, 12, s.lastTickAtMs! + pulseMs(120)).state;
    expect(midiClockBpm(s)).toBeCloseTo(120, 3);
  });

  it('a Start with no pulse behind it becomes lost after the timeout instead of running forever', () => {
    const s = applyMidiClockEvent(createMidiClockState(120), { command: 'start', atMs: 100 });
    expect(advanceMidiClock(s, 100 + MIDI_CLOCK_LOST_MS - 1).state.status).toBe('running');
    const lost = advanceMidiClock(s, 100 + MIDI_CLOCK_LOST_MS);
    expect(lost.state.status).toBe('lost');
    expect(lost.playing).toBe(false);
    expect(lost.beat).toBe(0);
    // the same holds for Continue
    const c = applyMidiClockEvent(createMidiClockState(120), { command: 'continue', atMs: 5000 });
    expect(advanceMidiClock(c, 5000 + MIDI_CLOCK_LOST_MS).state.status).toBe('lost');
  });

  it('counts host-batched pulses sharing one receipt timestamp as real pulses', () => {
    let s = applyMidiClockEvent(createMidiClockState(120), { command: 'start', atMs: 0 });
    s = pulses(s, 120, 25, 0).state; // beat 1
    const at = s.lastTickAtMs! + pulseMs(120) * 3;
    for (let i = 0; i < 3; i++) s = applyMidiClockEvent(s, { command: 'tick', atMs: at }); // three delivered at once
    expect(s.beat).toBeCloseTo(1 + 3 / 24, 9);
    expect(midiClockBpm(s)).toBeCloseTo(120, 3);
  });

  it('a lost clock that was stopped stays stopped when pulses return', () => {
    let s = applyMidiClockEvent(createMidiClockState(120), { command: 'start', atMs: 0 });
    s = pulses(s, 120, 30, 0).state;
    s = applyMidiClockEvent(s, { command: 'stop', atMs: s.lastTickAtMs! + 1 });
    const later = advanceMidiClock(s, s.lastTickAtMs! + 5000);
    expect(later.state.status).toBe('stopped'); // stopped is not lost
    const back = applyMidiClockEvent(later.state, { command: 'tick', atMs: s.lastTickAtMs! + 6000 });
    expect(back.playing).toBe(false);
    expect(back.beat).toBeCloseTo(s.beat, 9);
  });

  it('maps system real-time status bytes to commands and nothing else', () => {
    expect(midiClockCommandForStatus(0xf8)).toBe('tick');
    expect(midiClockCommandForStatus(0xfa)).toBe('start');
    expect(midiClockCommandForStatus(0xfb)).toBe('continue');
    expect(midiClockCommandForStatus(0xfc)).toBe('stop');
    expect(midiClockCommandForStatus(0xf2)).toBe('position');
    for (const other of [0x90, 0xb0, 0xf0, 0xf1, 0xf3, 0xfe, 0xff]) expect(midiClockCommandForStatus(other)).toBeNull();
  });
});

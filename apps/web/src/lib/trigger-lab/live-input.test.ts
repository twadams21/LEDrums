import { describe, expect, it } from 'vitest';
import { voice } from '@ledrums/core';
import { LiveInputTables } from './live-input';

/** A LiveInputTables over a hand-driven clock, so note release is deterministic. */
function withClock(): { tables: LiveInputTables; setNow: (ms: number) => void } {
  let now = 0;
  const tables = new LiveInputTables(() => now);
  return { tables, setNow: (ms) => (now = ms) };
}

describe('LiveInputTables', () => {
  it('writes a CC to BOTH the channel key and the omni slot', () => {
    const { tables } = withClock();
    tables.setCc(74, 127, 3);
    expect(tables.cc.get(voice.ccKey(74, 3))).toBe(1);
    expect(tables.cc.get(voice.ccKey(74, null))).toBe(1);
    // The omni slot always carries the LATEST value, whatever channel sent it.
    tables.setCc(74, 0, 9);
    expect(tables.cc.get(voice.ccKey(74, null))).toBe(0);
    expect(tables.cc.get(voice.ccKey(74, 3))).toBe(1); // channel 3's own slot is untouched
  });

  it('samples a CC through the same core function the engine samples with', () => {
    const { tables } = withClock();
    tables.setCc(1, 64, null);
    expect(voice.sampleCc(tables.cc, 1, null)).toBeCloseTo(voice.ccValue01(64), 12);
  });

  it('normalizes an OSC value to 0..1 at its address', () => {
    const { tables } = withClock();
    tables.setOsc('/lab/level', 0.42);
    expect(tables.osc.get('/lab/level')).toBeCloseTo(voice.oscValue01(0.42), 12);
    expect(voice.sampleOsc(tables.osc, '/lab/level')).toBeCloseTo(voice.oscValue01(0.42), 12);
    expect(voice.sampleOsc(tables.osc, '/lab/missing')).toBe(0);
  });

  it('gates a note on, then stamps the release from the injected clock', () => {
    const { tables, setNow } = withClock();
    setNow(1000);
    tables.setNote(60, 127, 1, true);
    const on = tables.notes.get(voice.noteKey(60, 1));
    expect(on).toEqual({ gate: 1, velocity: voice.noteValue01(1), releasedAtMs: null });
    expect(tables.notes.get(voice.noteKey(60, null))).toEqual(on); // omni slot too

    setNow(1500);
    tables.setNote(60, 0, 1, false);
    const off = tables.notes.get(voice.noteKey(60, 1));
    // Release keeps the sounding gate/velocity and records WHEN it let go — the ramp needs both.
    expect(off?.releasedAtMs).toBe(1500);
    expect(off?.gate).toBe(1);
    expect(off?.velocity).toBe(voice.noteValue01(1));
  });

  it('advances a note release against wall time, not transport state', () => {
    const { tables, setNow } = withClock();
    setNow(0);
    tables.setNote(48, 100, null, true);
    setNow(200);
    tables.setNote(48, 0, null, false);
    // Sampled AT the release instant the gate is still full; 300ms into a 400ms release it has
    // fallen. The retired sim clock only advanced while the transport played, so this decay
    // stalled with playback stopped — the wall clock is what makes it honest.
    const atRelease = voice.sampleNote(tables.notes, 48, null, 'gate', 400, 200);
    const later = voice.sampleNote(tables.notes, 48, null, 'gate', 400, 500);
    expect(atRelease).toBeGreaterThan(later);
    expect(later).toBeGreaterThanOrEqual(0);
  });

  it('nowMs reads the same clock setNote stamps with', () => {
    const { tables, setNow } = withClock();
    setNow(4242);
    expect(tables.nowMs()).toBe(4242);
  });
});

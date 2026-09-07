import { describe, expect, it } from 'vitest';
import { createMidiClockState, MIDI_CLOCK_LOST_MS } from '@ledrums/core';
import {
  clockInputOptions,
  clockInputValue,
  LocalMidiClock,
  parseClockInputValue,
  resolveClockStatus,
  shouldForwardClock,
} from './midi-clock';
import type { MidiDeviceInfo } from '../../midi/webmidi';

const DEVICES: MidiDeviceInfo[] = [
  { id: 'p1', name: 'Ableton Out', state: 'connected' },
  { id: 'p2', name: 'Old Pad', state: 'disconnected' },
];

describe('clock input selection', () => {
  it('round-trips native and browser selections through the picker value', () => {
    expect(clockInputValue('native', null)).toBe('native');
    expect(clockInputValue('native', 'p1')).toBe('native');
    expect(clockInputValue('browser', 'p1')).toBe('browser:p1');
    expect(clockInputValue('browser', null)).toBe('native'); // no port ⇒ nothing to read from
    expect(parseClockInputValue('native')).toEqual({ clockInput: 'native', deviceId: null });
    expect(parseClockInputValue('browser:p1')).toEqual({ clockInput: 'browser', deviceId: 'p1' });
    expect(parseClockInputValue('browser:')).toEqual({ clockInput: 'native', deviceId: null });
    expect(parseClockInputValue('garbage')).toEqual({ clockInput: 'native', deviceId: null });
  });

  it('lists native first, every port (disconnected disabled), and a missing selection honestly', () => {
    expect(clockInputOptions(DEVICES, 'p1')).toEqual([
      { value: 'native', label: 'Native LEDrums port' },
      { value: 'browser:p1', label: 'Ableton Out', disabled: false },
      { value: 'browser:p2', label: 'Old Pad', disabled: true },
    ]);
    expect(clockInputOptions(DEVICES, 'gone').at(-1)).toEqual({ value: 'browser:gone', label: 'Selected port (not present)', disabled: true });
  });
});

describe('shouldForwardClock — one selected port owns the clock', () => {
  const ctx = { source: 'midiClock', clockInput: 'browser', deviceId: 'p1', isViewer: false } as const;
  const tick = (deviceId: string) => ({ command: 'tick' as const, deviceId });

  it('forwards only from the selected port', () => {
    expect(shouldForwardClock(tick('p1'), ctx)).toBe(true);
    expect(shouldForwardClock(tick('p2'), ctx)).toBe(false); // a second clock never combines
    expect(shouldForwardClock({ command: 'tick' }, ctx)).toBe(false); // untagged
  });
  it('never forwards in manual mode, on the native route, or as a viewer', () => {
    expect(shouldForwardClock(tick('p1'), { ...ctx, source: 'manual' })).toBe(false);
    expect(shouldForwardClock(tick('p1'), { ...ctx, clockInput: 'native' })).toBe(false); // no duplicate native/browser forwarding
    expect(shouldForwardClock(tick('p1'), { ...ctx, isViewer: true })).toBe(false);
    expect(shouldForwardClock(tick('p1'), { ...ctx, deviceId: null })).toBe(false);
  });
});

describe('resolveClockStatus — never promise sync the host cannot confirm', () => {
  const local = createMidiClockState(120);
  const server = { status: 'running', bpm: 128, locked: true, playing: true } as const;

  it('is off in manual mode whatever the link says', () => {
    expect(resolveClockStatus(true, server, local, { source: 'manual', clockInput: 'browser', manualBpm: 100 }))
      .toEqual({ status: 'off', bpm: 100, locked: false, playing: false });
  });
  it('shows the server truth while connected', () => {
    expect(resolveClockStatus(true, server, local, { source: 'midiClock', clockInput: 'native', manualBpm: 100 })).toBe(server);
  });
  it('offline with a native selection is waiting (this browser reads no clock)', () => {
    expect(resolveClockStatus(false, server, local, { source: 'midiClock', clockInput: 'native', manualBpm: 100 }))
      .toEqual({ status: 'waiting', bpm: 100, locked: false, playing: false });
  });
  it('offline with a browser port follows the local reducer', () => {
    const clock = new LocalMidiClock(100, () => 0);
    clock.apply({ command: 'start', deviceId: 'p1' });
    expect(resolveClockStatus(false, null, clock.state, { source: 'midiClock', clockInput: 'browser', manualBpm: 100 }))
      .toEqual({ status: 'running', bpm: 100, locked: false, playing: true });
  });
});

describe('LocalMidiClock — the offline preview runs the same reducer', () => {
  it('follows a synthetic stream and goes lost on silence', () => {
    let now = 0;
    const clock = new LocalMidiClock(100, () => now);
    clock.apply({ command: 'start' });
    const pulse = 60_000 / (120 * 24);
    for (let i = 0; i <= 48; i++) {
      now = i * pulse;
      clock.apply({ command: 'tick' });
    }
    let snap = clock.advance();
    expect(snap.playing).toBe(true);
    expect(snap.beat).toBeCloseTo(2, 6);
    expect(snap.bpm).toBeCloseTo(120, 3);
    now += MIDI_CLOCK_LOST_MS;
    snap = clock.advance();
    expect(snap.playing).toBe(false);
    expect(clock.state.status).toBe('lost');
    clock.reset(90);
    expect(clock.state.status).toBe('waiting');
    expect(clock.advance().bpm).toBe(90);
  });
});

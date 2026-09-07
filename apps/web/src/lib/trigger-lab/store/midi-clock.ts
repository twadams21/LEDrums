/* MIDI clock — the browser side of external transport sync (no runes/DOM; the store owns the
   reactive fields and the WS link, this module owns the decisions).

   Three concerns, all pure and unit-tested:
     1. Which clock input the operator picked: `native` (the desktop app's own "LEDrums" CoreMIDI
        destination, read by the server) or ONE WebMIDI port of this browser. The port id is
        machine-local (persisted here, never in the show) because a port id means nothing on
        another machine; the server only learns `native` vs `browser`.
     2. Whether a parsed clock event from a given port should be forwarded — only in MIDI Clock
        mode, only from the selected port, only by the editor, only while the link is open. That
        is what stops two ports (or a viewer) from steering the show's timing.
     3. The offline preview's own clock: the SAME core reducer the server runs, fed with the
        browser's monotonic time, so the local sim follows the selected port when the link is
        down. When connected the server's status wins (`resolveClockStatus`). */

import {
  advanceMidiClock,
  applyMidiClockEvent,
  createMidiClockState,
  midiClockBpm,
  midiClockLocked,
  type ClockInput,
  type MidiClockState,
  type TransportSource,
} from '@ledrums/core';
import type { MidiClockStatus } from '../../ws/protocol-types';
import type { MidiClockEvent, MidiDeviceInfo } from '../../midi/webmidi';

/** The native desktop destination as a clock-input selection value. */
export const NATIVE_CLOCK_INPUT = 'native';
const BROWSER_PREFIX = 'browser:';

/** localStorage key for the selected WebMIDI clock port (machine-local, never in the show). */
export const CLOCK_DEVICE_STORAGE_KEY = 'ledrums:midi-clock-device';

export function readStoredClockDevice(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(CLOCK_DEVICE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeStoredClockDevice(deviceId: string | null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (deviceId === null) localStorage.removeItem(CLOCK_DEVICE_STORAGE_KEY);
    else localStorage.setItem(CLOCK_DEVICE_STORAGE_KEY, deviceId);
  } catch {
    /* ignore */
  }
}

/** The Select's value for a (clockInput, deviceId) pair: `native` or `browser:<port id>`. A
    browser selection whose port is unknown here still round-trips (the port may be unplugged). */
export function clockInputValue(clockInput: ClockInput, deviceId: string | null): string {
  if (clockInput === 'native') return NATIVE_CLOCK_INPUT;
  return `${BROWSER_PREFIX}${deviceId ?? ''}`;
}

/** Decode a Select value back into what to persist: the route for the server, the port for us. */
export function parseClockInputValue(value: string): { clockInput: ClockInput; deviceId: string | null } {
  if (value.startsWith(BROWSER_PREFIX)) {
    return { clockInput: 'browser', deviceId: value.slice(BROWSER_PREFIX.length) || null };
  }
  return { clockInput: 'native', deviceId: null };
}

export interface ClockInputOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** Options for the clock-input picker: the native destination first, then every WebMIDI port
    (a disconnected port stays listed but disabled so a selection made while it was plugged in
    still shows where the clock is expected from). */
export function clockInputOptions(
  devices: readonly MidiDeviceInfo[], selectedDeviceId: string | null, clockInput: ClockInput = 'native',
): ClockInputOption[] {
  const options: ClockInputOption[] = [{ value: NATIVE_CLOCK_INPUT, label: 'Native LEDrums port' }];
  // The project's browser route can outlive this machine's local port selection. Never label
  // that unresolved route as native: choosing Native must remain a real, explicit change.
  if (clockInput === 'browser' && selectedDeviceId === null) {
    options.push({ value: BROWSER_PREFIX, label: 'Choose a browser MIDI input', disabled: true });
  }
  let selectedListed = false;
  for (const d of devices) {
    if (d.id === selectedDeviceId) selectedListed = true;
    options.push({ value: `${BROWSER_PREFIX}${d.id}`, label: d.name, disabled: d.state === 'disconnected' });
  }
  if (selectedDeviceId !== null && !selectedListed) {
    options.push({ value: `${BROWSER_PREFIX}${selectedDeviceId}`, label: 'Selected port (not present)', disabled: true });
  }
  return options;
}

export interface ForwardContext {
  source: TransportSource;
  clockInput: ClockInput;
  /** The selected WebMIDI port, or null when none / native. */
  deviceId: string | null;
  isViewer: boolean;
}

/** Whether a parsed clock event from `ev.deviceId` should reach the server. The selected port
    OWNS the clock: any other port's pulses are dropped here, so two clocks are never combined,
    and a viewer never forwards (the server refuses it anyway — this saves 48 messages/s). */
export function shouldForwardClock(ev: MidiClockEvent, ctx: ForwardContext): boolean {
  if (ctx.source !== 'midiClock' || ctx.clockInput !== 'browser') return false;
  if (ctx.deviceId === null || ev.deviceId !== ctx.deviceId) return false;
  return !ctx.isViewer;
}

/** The status to show: the server's while the link is open (it owns the transport), else the
    local reducer's — but only when this browser actually READS the clock (a browser port). A
    native selection offline has no clock here, so it is honestly `waiting`, never "synced". */
export function resolveClockStatus(
  linkOpen: boolean,
  server: MidiClockStatus | null,
  local: MidiClockState,
  ctx: { source: TransportSource; clockInput: ClockInput; manualBpm: number },
): MidiClockStatus {
  if (ctx.source !== 'midiClock') return { status: 'off', bpm: ctx.manualBpm, locked: false, playing: false };
  if (linkOpen && server) return server;
  if (ctx.clockInput !== 'browser') return { status: 'waiting', bpm: ctx.manualBpm, locked: false, playing: false };
  return { status: local.status, bpm: midiClockBpm(local), locked: midiClockLocked(local), playing: local.playing };
}

/** The offline preview's clock: the core reducer under the browser's monotonic time. */
export class LocalMidiClock {
  state: MidiClockState;
  constructor(seedBpm: number, private readonly now: () => number = () => performance.now()) {
    this.state = createMidiClockState(seedBpm);
  }
  reset(seedBpm: number): void {
    this.state = createMidiClockState(seedBpm);
  }
  apply(ev: MidiClockEvent): void {
    this.state = applyMidiClockEvent(this.state, { command: ev.command, position: ev.position, atMs: this.now() });
  }
  /** Advance to now; returns the render-time beat/bpm/playing for the sim. */
  advance(): { beat: number; bpm: number; playing: boolean } {
    const snap = advanceMidiClock(this.state, this.now());
    this.state = snap.state;
    return { beat: snap.beat, bpm: snap.bpm, playing: snap.playing };
  }
}

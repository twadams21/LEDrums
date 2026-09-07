import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultProject } from '@ledrums/core';
import { TriggerLab } from './store.svelte';
import { CLOCK_DEVICE_STORAGE_KEY } from './store/midi-clock';
import type { WSClient, WSCallbacks } from '../ws/client';
import type { MidiEvent } from '../midi/webmidi';
import type { ClientMessage, OscListenInfo, OutputStatus, SerializedModel } from '../ws/protocol-types';

/* Store-level coverage for external MIDI clock: the selected WebMIDI port owns the clock (other
   ports and viewers never forward), the mode/input setters persist the route on the server and
   the port locally, the server's clock truth from `stats` drives the panel while connected, and
   the offline preview follows the same core reducer. */

class MemStorage {
  private m = new Map<string, string>();
  get length(): number { return this.m.size; }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null; }
  getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string): void { this.m.set(k, String(v)); }
  removeItem(k: string): void { this.m.delete(k); }
  clear(): void { this.m.clear(); }
}

interface Harness {
  cb: WSCallbacks | null;
  sent: ClientMessage[];
}
const harnessClient = (h: Harness): (() => WSClient) => () =>
  ({ on(cb: WSCallbacks) { h.cb = cb; }, connect() {}, close() {}, send(m: ClientMessage) { h.sent.push(m); } }) as unknown as WSClient;

const MODEL: SerializedModel = { count: 0, positions: [], tangents: [], normals: [], segmentLengths: [], drums: [], bounds: { center: [0, 0, 0], size: 0 } };
const OUTPUT: OutputStatus = { state: 'disabled', protocol: 'artnet', host: '', packetsSent: 0, lastError: null, universeCount: 0 };
const OSC_LISTEN: OscListenInfo = { status: 'listening', port: 9000, hosts: [] };
const STATS = { timeMs: 0, beat: 0, bar: 0, activeTriggers: 0, tickCount: 0, pixelCount: 0 };

const raf = globalThis.requestAnimationFrame;
const caf = globalThis.cancelAnimationFrame;
beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
  // No render loop in node: start()/stop() need the RAF pair to exist but never run it.
  globalThis.requestAnimationFrame = (() => 1) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
  globalThis.requestAnimationFrame = raf;
  globalThis.cancelAnimationFrame = caf;
});

function forward(store: TriggerLab, ev: MidiEvent): void {
  (store as unknown as { forwardMidi(e: MidiEvent): void }).forwardMidi(ev);
}

/** A store wired to a capturing client, with the handshake driven and the server project's
    transport set to the given source/input (what a `state` broadcast would carry). */
function connected(source: 'manual' | 'midiClock', clockInput: 'native' | 'browser', deviceId: string | null = 'p1') {
  const h: Harness = { cb: null, sent: [] };
  if (deviceId !== null) localStorage.setItem(CLOCK_DEVICE_STORAGE_KEY, deviceId);
  const store = new TriggerLab(harnessClient(h));
  store.start();
  h.cb!.onConnection!('open');
  const project = defaultProject();
  project.composition.transport.source = source;
  project.composition.transport.clockInput = clockInput;
  h.cb!.onState!(project, MODEL, [], [], OUTPUT, null, null, null, OSC_LISTEN);
  h.sent.length = 0;
  const clockSent = () => h.sent.filter((m) => m.t === 'midiClock');
  return { store, h, clockSent, project };
}

describe('clock forwarding — the selected port owns the clock', () => {
  it('forwards pulses from the selected port only, as compact midiClock messages', () => {
    const { store, clockSent } = connected('midiClock', 'browser', 'p1');
    forward(store, { kind: 'clock', command: 'start', deviceId: 'p1' });
    forward(store, { kind: 'clock', command: 'tick', deviceId: 'p1' });
    forward(store, { kind: 'clock', command: 'tick', deviceId: 'p2' }); // a second clock: dropped
    forward(store, { kind: 'clock', command: 'position', position: 64, deviceId: 'p1' });
    expect(clockSent()).toEqual([
      { t: 'midiClock', command: 'start' },
      { t: 'midiClock', command: 'tick' },
      { t: 'midiClock', command: 'position', position: 64 },
    ]);
    store.stop();
  });

  it('forwards nothing in manual mode or on the native route (no duplicate forwarding)', () => {
    const manual = connected('manual', 'browser', 'p1');
    forward(manual.store, { kind: 'clock', command: 'tick', deviceId: 'p1' });
    expect(manual.clockSent()).toEqual([]);
    expect(manual.store.clockStatus.status).toBe('off');
    manual.store.stop();

    const native = connected('midiClock', 'native', 'p1');
    forward(native.store, { kind: 'clock', command: 'tick', deviceId: 'p1' });
    expect(native.clockSent()).toEqual([]);
    native.store.stop();
  });

  it('a viewer never forwards the clock', () => {
    const { store, h, clockSent } = connected('midiClock', 'browser', 'p1');
    h.cb!.onPresence!('someone-else', false, 2);
    expect(store.isViewer).toBe(true);
    forward(store, { kind: 'clock', command: 'tick', deviceId: 'p1' });
    expect(clockSent()).toEqual([]);
    store.stop();
  });

  it('leaves note / CC / program change forwarding untouched', () => {
    const { store, h } = connected('midiClock', 'browser', 'p1');
    forward(store, { kind: 'note', note: 38, velocity: 100, on: true, channel: 1 });
    forward(store, { kind: 'cc', controller: 7, value: 64, channel: 1 });
    forward(store, { kind: 'programChange', value: 2, channel: 1 });
    expect(h.sent.map((m) => m.t)).toEqual(['midi', 'cc', 'programChange']);
    store.stop();
  });
});

describe('setters — route on the server, port on this machine', () => {
  it('setTimingSource sends only the source (never the mirrored bpm/playing tuple)', () => {
    const { store, h } = connected('manual', 'native', null);
    store.setTimingSource('midiClock');
    expect(h.sent).toEqual([{ t: 'setTransport', source: 'midiClock' }]);
    expect(store.timingSource).toBe('midiClock'); // optimistic until the state broadcast confirms
    store.stop();
  });

  it('setClockInput stores the port locally and sends the route to the server', () => {
    const { store, h } = connected('midiClock', 'native', null);
    store.setClockInput('browser:p9');
    expect(store.clockDeviceId).toBe('p9');
    expect(localStorage.getItem(CLOCK_DEVICE_STORAGE_KEY)).toBe('p9');
    expect(h.sent).toEqual([{ t: 'setTransport', clockInput: 'browser' }]);
    h.sent.length = 0;
    store.setClockInput('native');
    expect(store.clockDeviceId).toBeNull();
    expect(localStorage.getItem(CLOCK_DEVICE_STORAGE_KEY)).toBeNull();
    expect(h.sent).toEqual([{ t: 'setTransport', clockInput: 'native' }]);
    store.stop();
  });

  it('a viewer cannot change the timing source or clock input', () => {
    const { store, h } = connected('manual', 'native', null);
    h.cb!.onPresence!('someone-else', false, 2);
    store.setTimingSource('midiClock');
    store.setClockInput('browser:p1');
    expect(h.sent).toEqual([]);
    store.stop();
  });

  it('adoptClockBpm freezes the clock tempo into the authored manual bpm', () => {
    const { store, h } = connected('midiClock', 'native', null);
    h.cb!.onStats!(STATS, 0, 60, OUTPUT, { voiceCount: 0, busLevels: {}, voices: [], clock: { status: 'running', bpm: 127.96, locked: true, playing: true } });
    expect(store.clockStatus).toEqual({ status: 'running', bpm: 127.96, locked: true, playing: true });
    store.adoptClockBpm();
    expect(store.bpm).toBe(128);
    store.stop();
  });
});

describe('clock status — server truth connected, local reducer offline', () => {
  it('shows the server status from stats while connected and forgets it on a drop', () => {
    const { store, h } = connected('midiClock', 'native', null);
    expect(store.clockStatus.status).toBe('waiting'); // nothing confirmed yet
    h.cb!.onStats!(STATS, 0, 60, OUTPUT, { voiceCount: 0, busLevels: {}, voices: [], clock: { status: 'lost', bpm: 120, locked: true, playing: false } });
    expect(store.clockStatus.status).toBe('lost');
    h.cb!.onConnection!('closed');
    expect(store.clockStatus).toEqual({ status: 'waiting', bpm: store.bpm, locked: false, playing: false }); // native offline: this browser reads no clock
    store.stop();
  });

  it('offline with a browser port, the same core reducer runs locally', () => {
    const { store, h } = connected('midiClock', 'browser', 'p1');
    h.cb!.onConnection!('closed');
    forward(store, { kind: 'clock', command: 'start', deviceId: 'p1' });
    for (let i = 0; i < 30; i++) forward(store, { kind: 'clock', command: 'tick', deviceId: 'p1' });
    expect(store.clockStatus.status).toBe('running');
    expect(store.clockStatus.playing).toBe(true);
    // 29 pulses after the anchoring one, tick-counted (all delivered at one receipt time, so no
    // interpolation and no tempo lock yet — the seed tempo is reported honestly as unlocked).
    const local = (store as unknown as { localClock: { advance(): { beat: number } } }).localClock;
    const beat = local.advance().beat; // real receipt clock: a hair of interpolation, never a pulse
    expect(beat).toBeGreaterThanOrEqual(29 / 24);
    expect(beat).toBeLessThan(30 / 24);
    expect(store.clockStatus.locked).toBe(false);
    store.stop();
  });
});

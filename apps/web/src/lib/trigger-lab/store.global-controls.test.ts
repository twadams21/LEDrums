import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import { defaultProject } from '@ledrums/core';
import type { WSClient } from '../ws/client';
import type { ClientMessage } from '../ws/protocol-types';

/* Global control bindings, web half: the store mutator plus the two learn arms.

   Everything writes through the ONE `setInputMap` path, so a binding edit inherits the
   viewer guard, the undo snapshot, and the WS resync for free — the parity that keeps a
   second mutation path from appearing. */

class MemStorage {
  private m = new Map<string, string>();
  get length(): number {
    return this.m.size;
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  clear(): void {
    this.m.clear();
  }
}

const capturing = (sent: ClientMessage[]): (() => WSClient) =>
  () =>
    ({ on() {}, connect() {}, close() {}, send(m: ClientMessage) { sent.push(m); } }) as unknown as WSClient;

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

function connected(sent: ClientMessage[]): TriggerLab {
  const store = new TriggerLab(capturing(sent));
  store.project = defaultProject();
  return store;
}

/** The `input` echo the server broadcasts for an inbound OSC packet. */
function echoOsc(store: TriggerLab, address: string, value = 1): void {
  (store as unknown as { receiveInputEcho: (k: 'midi' | 'osc', l: string, v: number, n?: number, c?: number) => void })
    .receiveInputEcho('osc', address, value, undefined, undefined);
}

/** The `input` echo the server broadcasts for an inbound MIDI note. */
function echoNote(store: TriggerLab, note: number, velocity01 = 1): void {
  (store as unknown as { receiveInputEcho: (k: 'midi' | 'osc', l: string, v: number, n?: number, c?: number) => void })
    .receiveInputEcho('midi', `note ${note}`, velocity01, note, undefined);
}

describe('setGlobalControlBinding', () => {
  it('writes the binding locally and sends it through setInputMap', () => {
    const sent: ClientMessage[] = [];
    const store = connected(sent);

    store.setGlobalControlBinding('nextSong', { midiNote: 60 });

    expect(store.globalControls.nextSong).toEqual({ midiNote: 60 });
    const msg = sent.find((m) => m.t === 'setInputMap');
    expect(msg).toBeDefined();
    expect(msg!.inputMap.globalControls.nextSong).toEqual({ midiNote: 60 });
  });

  it('preserves the rest of the input map', () => {
    const sent: ClientMessage[] = [];
    const store = connected(sent);
    const before = store.project!.inputMap.midiNotes.length;

    store.setGlobalControlBinding('nextSong', { midiNote: 60 });

    expect(store.project!.inputMap.midiNotes).toHaveLength(before);
  });

  it('merges rather than replaces, and clears one field at a time', () => {
    const store = connected([]);
    store.setGlobalControlBinding('nextSong', { midiNote: 60 });
    store.setGlobalControlBinding('nextSong', { oscAddress: '/n' });
    expect(store.globalControls.nextSong).toEqual({ midiNote: 60, oscAddress: '/n' });

    store.setGlobalControlBinding('nextSong', { midiNote: undefined });
    expect(store.globalControls.nextSong).toEqual({ oscAddress: '/n' });

    store.setGlobalControlBinding('nextSong', { oscAddress: undefined });
    expect(store.globalControls.nextSong).toBeUndefined();
  });

  it('is a no-op for a read-only viewer', () => {
    const sent: ClientMessage[] = [];
    const store = connected(sent);
    (store as unknown as { isViewer: boolean }).isViewer = true;

    store.setGlobalControlBinding('nextSong', { midiNote: 60 });

    expect(store.globalControls.nextSong).toBeUndefined();
    expect(sent.some((m) => m.t === 'setInputMap')).toBe(false);
  });

  it('reads as empty before a project loads', () => {
    const store = new TriggerLab(capturing([]));
    expect(store.globalControls).toEqual({});
  });
});

describe('offline consumption parity', () => {
  /** Drive the local WebMIDI forward path with a note-on, counting local pad fires. */
  function offlineNoteOn(store: TriggerLab, note: number): void {
    (store as unknown as { forwardMidi: (ev: unknown) => void }).forwardMidi({
      kind: 'note',
      note,
      velocity: 100,
      channel: 1,
      on: true,
    });
  }

  function stubLocalFire(store: TriggerLab): () => number {
    let fired = 0;
    (store as unknown as { fireRawMidiLocal: (n: number, v: number) => void }).fireRawMidiLocal = () => {
      fired++;
    };
    return () => fired;
  }

  it('fires a pad graph locally for an UNBOUND note while offline', () => {
    const store = connected([]);
    store.link = 'offline';
    const fires = stubLocalFire(store);

    offlineNoteOn(store, 60);

    expect(fires()).toBe(1);
  });

  it('does NOT fire locally for a globally-bound note — same consumption the server pins', () => {
    const store = connected([]);
    store.link = 'offline';
    const fires = stubLocalFire(store);
    store.setGlobalControlBinding('nextSong', { midiNote: 60 });

    offlineNoteOn(store, 60);

    expect(fires()).toBe(0);
  });
});

describe('MIDI learn — global control', () => {
  it('binds the next heard note to the armed action, then disarms', () => {
    const store = connected([]);
    store.startMidiLearn({ kind: 'global-control', action: 'nextSection' });
    expect(store.midiLearnTarget).toEqual({ kind: 'global-control', action: 'nextSection' });

    echoNote(store, 64);

    expect(store.globalControls.nextSection).toEqual({ midiNote: 64 });
    expect(store.midiLearnTarget).toBeNull();
  });

  it('binds nothing while unarmed', () => {
    const store = connected([]);
    echoNote(store, 64);
    expect(store.globalControls).toEqual({});
  });

  it('replaces an existing note without dropping the OSC address', () => {
    const store = connected([]);
    store.setGlobalControlBinding('nextSection', { midiNote: 60, oscAddress: '/s' });
    store.startMidiLearn({ kind: 'global-control', action: 'nextSection' });

    echoNote(store, 64);

    expect(store.globalControls.nextSection).toEqual({ midiNote: 64, oscAddress: '/s' });
  });

  it('cancel disarms without binding', () => {
    const store = connected([]);
    store.startMidiLearn({ kind: 'global-control', action: 'nextSong' });
    store.cancelMidiLearn();
    echoNote(store, 64);
    expect(store.globalControls.nextSong).toBeUndefined();
  });

  it('a viewer cannot arm', () => {
    const store = connected([]);
    (store as unknown as { isViewer: boolean }).isViewer = true;
    store.startMidiLearn({ kind: 'global-control', action: 'nextSong' });
    expect(store.midiLearnTarget).toBeNull();
  });
});

describe('OSC learn — global control (the app’s first OSC learn)', () => {
  it('binds the next heard address to the armed action, then disarms', () => {
    const store = connected([]);
    store.startOscLearn({ kind: 'global-control', action: 'prevSong' });
    expect(store.oscLearnTarget).toEqual({ kind: 'global-control', action: 'prevSong' });

    echoOsc(store, '/ledrums/prev');

    expect(store.globalControls.prevSong).toEqual({ oscAddress: '/ledrums/prev' });
    expect(store.oscLearnTarget).toBeNull();
  });

  it('binds nothing while unarmed', () => {
    const store = connected([]);
    echoOsc(store, '/ledrums/prev');
    expect(store.globalControls).toEqual({});
  });

  it('binds on a zero-valued packet too — a button release still names its address', () => {
    const store = connected([]);
    store.startOscLearn({ kind: 'global-control', action: 'prevSong' });
    echoOsc(store, '/ledrums/prev', 0);
    expect(store.globalControls.prevSong).toEqual({ oscAddress: '/ledrums/prev' });
  });

  it('keeps the MIDI note when learning an address', () => {
    const store = connected([]);
    store.setGlobalControlBinding('prevSong', { midiNote: 60 });
    store.startOscLearn({ kind: 'global-control', action: 'prevSong' });

    echoOsc(store, '/p');

    expect(store.globalControls.prevSong).toEqual({ midiNote: 60, oscAddress: '/p' });
  });

  it('the two arms are INDEPENDENT — arming OSC does not disarm MIDI', () => {
    const store = connected([]);
    store.startMidiLearn({ kind: 'global-control', action: 'nextSong' });
    store.startOscLearn({ kind: 'global-control', action: 'prevSong' });

    expect(store.midiLearnTarget).toEqual({ kind: 'global-control', action: 'nextSong' });
    expect(store.oscLearnTarget).toEqual({ kind: 'global-control', action: 'prevSong' });

    echoOsc(store, '/p');
    expect(store.midiLearnTarget).not.toBeNull(); // the MIDI arm survived the OSC bind
    echoNote(store, 70);
    expect(store.globalControls.nextSong).toEqual({ midiNote: 70 });
  });

  it('cancel disarms without binding', () => {
    const store = connected([]);
    store.startOscLearn({ kind: 'global-control', action: 'nextSong' });
    store.cancelOscLearn();
    echoOsc(store, '/n');
    expect(store.globalControls.nextSong).toBeUndefined();
  });

  it('a viewer cannot arm', () => {
    const store = connected([]);
    (store as unknown as { isViewer: boolean }).isViewer = true;
    store.startOscLearn({ kind: 'global-control', action: 'nextSong' });
    expect(store.oscLearnTarget).toBeNull();
  });
});

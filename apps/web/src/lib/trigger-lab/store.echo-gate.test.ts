import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import type { WSClient } from '../ws/client';
import type { ClientMessage } from '../ws/protocol-types';
import type { MidiEvent } from '../midi/webmidi';

/* S12 — the authority principle: the web sim resolves + renders ONLY when the engine link is
   closed. When connected the server is the sole resolver/renderer and streams frames/levels
   back, so:
     - the `input` echo (a server broadcast of our own / another client's hit) never fires the
       sim — that was the echo loop — but MIDI-learn still runs from it;
     - the outbound paths (forwardMidi / hit / fireSectionGraph) fire the local sim only offline;
       connected, they forward to the server and return.
   `start()` is never called (no live socket); a capturing fake client records the sends and
   `link` is set directly to model connected vs offline. */

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

/** The MIDI-hardware forward + the server echo have no public wrapper — reach them directly. */
type Internals = {
  forwardMidi(ev: MidiEvent): void;
  receiveInputEcho(input: import('../ws/client').InputEcho): void;
};
const internals = (store: TriggerLab): Internals => store as unknown as Internals;

/** Local-sim resolution events — added only by the sim-firing paths, so their presence is a
    faithful "the sim fired locally" signal. */
const effectEvents = (store: TriggerLab) => store.monitorEvents.filter((e) => e.type === 'effect');

const noteOn = (n: number, velocity = 100): MidiEvent => ({ kind: 'note', note: n, velocity, on: true, channel: 0 });

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe('onInput echo never fires the sim (S12)', () => {
  it('an echoed MIDI input does NOT fire the local sim, even for a Cue on that note', () => {
    const store = new TriggerLab(capturing([]));
    // A Cue bound to raw note 60 — the Sim WOULD fire it if the echo reached the local engine.
    const id = store.addEffect({ row: 'kit', column: { kind: 'cue' } }, 'solid')!;
    store.setTrigger(id, { kind: 'cue', source: { midiNote: 60 } });
    store.sim.tick(16);

    internals(store).receiveInputEcho({ kind: 'midi', label: 'C4', value: 0.8, note: 60, channel: 0 });
    store.sim.tick(16);

    expect(effectEvents(store)).toHaveLength(0);
    expect(store.sim.effectFiredAt(id)).toBe(0);
  });

  it('MIDI-learn still works from an echoed input (and does not also fire the sim)', () => {
    const store = new TriggerLab(capturing([]));
    const id = store.addEffect({ row: 'kit', column: { kind: 'cue' } }, 'solid')!;
    store.startCueLearn(id, 'midi');

    internals(store).receiveInputEcho({ kind: 'midi', label: 'E4', value: 1, note: 64, channel: 0 });

    expect(store.effectById(id)!.trigger).toEqual({ kind: 'cue', source: { midiNote: 64 } });
    expect(effectEvents(store)).toHaveLength(0);
  });

  /* The B×E integration seam (S04 × S12): S04's badges record from the ONE place all server-side
     input surfaces (the `input` echo), and S12 rewrote that place. Neither slice tested the
     other's half — these pin the union: the echo records last-heard activity for both kinds,
     while still never firing the sim. */
  it('an echoed MIDI input records last-heard badge activity (S04 seam) without firing', () => {
    const store = new TriggerLab(capturing([]));

    internals(store).receiveInputEcho({ kind: 'midi', label: 'C4', value: 0.8, note: 60, channel: 0 });

    expect(store.inputBadge({ kind: 'midi', note: 60 })).not.toBeNull();
    expect(store.inputBadge({ kind: 'midi', note: 61 })).toBeNull(); // no churn from other notes
    expect(effectEvents(store)).toHaveLength(0);
  });

  it('an echoed OSC input records last-heard badge activity under its address (S04 seam)', () => {
    const store = new TriggerLab(capturing([]));

    internals(store).receiveInputEcho({ kind: 'osc', label: '/kick', value: 0.75 });

    expect(store.inputBadge({ kind: 'osc', address: '/kick' })).not.toBeNull();
    expect(store.inputBadge({ kind: 'osc', address: '/snare' })).toBeNull();
    expect(effectEvents(store)).toHaveLength(0);
  });
});

describe('outbound firing is gated on the engine link (S12)', () => {
  describe('forwardMidi (WebMIDI → server)', () => {
    /** A Cue Effect bound to raw note 60 (the Effect-path twin of a directly-bound graph). */
    const bindDirect = (store: TriggerLab): void => {
      const id = store.addEffect({ row: 'kit', column: { kind: 'cue' } }, 'solid')!;
      store.setTrigger(id, { kind: 'cue', source: { midiNote: 60 } });
    };

    it('offline: fires the local preview AND forwards the note', () => {
      const sent: ClientMessage[] = [];
      const store = new TriggerLab(capturing(sent));
      bindDirect(store);
      expect(store.link).toBe('offline');

      internals(store).forwardMidi(noteOn(60));

      expect(effectEvents(store).length).toBeGreaterThan(0);
      expect(sent).toContainEqual({ t: 'midi', note: 60, velocity: 100, on: true, channel: 0 });
    });

    it('connected: forwards the note WITHOUT firing the local sim', () => {
      const sent: ClientMessage[] = [];
      const store = new TriggerLab(capturing(sent));
      bindDirect(store);
      store.link = 'open';

      internals(store).forwardMidi(noteOn(60));

      expect(effectEvents(store)).toHaveLength(0);
      expect(sent).toContainEqual({ t: 'midi', note: 60, velocity: 100, on: true, channel: 0 });
    });
  });

  describe('hit (pad surface)', () => {
    /** The kick's first zone: the seed's Intro section holds a zone Effect there. */
    const padWithGraph = (store: TriggerLab) => {
      const pad = store.pads.find((p) => p.drumId === 'kick' && p.zone === 0)!;
      expect(store.cellEffects({ row: 'kick', column: { kind: 'zone', slot: 0 } }).length).toBeGreaterThan(0);
      return pad;
    };

    it('offline: fires the local preview and sends nothing', () => {
      const sent: ClientMessage[] = [];
      const store = new TriggerLab(capturing(sent));
      const pad = padWithGraph(store);

      store.hit(pad);

      expect(effectEvents(store).length).toBeGreaterThan(0);
      expect(sent).toHaveLength(0);
    });

    it('connected: forwards a key hit WITHOUT firing the local sim', () => {
      const sent: ClientMessage[] = [];
      const store = new TriggerLab(capturing(sent));
      const pad = padWithGraph(store);
      store.link = 'open';

      store.hit(pad);

      expect(effectEvents(store)).toHaveLength(0);
      expect(sent).toContainEqual({ t: 'key', drumId: pad.drumId, zone: String(pad.zone), velocity: store.velocity });
    });
  });

  describe('fireEffectAt (keyboard audition)', () => {
    it('offline: fires the local preview and sends nothing', () => {
      const sent: ClientMessage[] = [];
      const store = new TriggerLab(capturing(sent));
      expect(store.activeSection!.effects.length).toBeGreaterThan(0);

      store.fireEffectAt(0);

      expect(effectEvents(store).length).toBeGreaterThan(0);
      expect(sent).toHaveLength(0);
    });

    it('connected: sends the fireEffect intent for exactly that Effect and does not fire the sim', () => {
      const sent: ClientMessage[] = [];
      const store = new TriggerLab(capturing(sent));
      store.link = 'open';

      store.fireEffectAt(0);

      expect(effectEvents(store)).toHaveLength(0);
      expect(sent).toHaveLength(1);
      expect(sent[0]!.t).toBe('fireEffect');
    });
  });
});

/* S15 — the same authority principle for SECTION RECALL. The engine plays a section's Always
   Effects on recall, so the Sim must recall ONLY while offline — otherwise the Sim + engine
   double-spawn when connected. `setActiveSection` therefore recalls the Sim only when
   `link !== 'open'`, and always forwards `{t:'recallSection'}` when connected. */
describe('setActiveSection recall is gated on the engine link (S15)', () => {

  it('offline: recalls the local sim (the section’s Always Effect plays) and sends nothing', () => {
    const sent: ClientMessage[] = [];
    const store = new TriggerLab(capturing(sent));
    expect(store.link).toBe('offline');
    store.setActiveSection('verse');
    store.addEffect({ row: 'kit', column: { kind: 'always' } }, 'solid');
    store.setActiveSection('intro');
    store.sim.tick(16);

    store.setActiveSection('verse');
    store.sim.tick(16); // the recall lands on the engine's next tick

    expect(store.sim.effectSelection.sectionId).toBe('verse');
    expect(store.sim.effectVoiceStats().length).toBeGreaterThan(0); // the Always Effect plays locally
    expect(sent).toHaveLength(0);
  });

  it('connected: forwards the recall WITHOUT firing the local sim (no double-spawn)', () => {
    const sent: ClientMessage[] = [];
    const store = new TriggerLab(capturing(sent));
    store.setActiveSection('verse');
    store.addEffect({ row: 'kit', column: { kind: 'always' } }, 'solid');
    store.setActiveSection('intro');
    store.sim.tick(16);
    store.link = 'open';

    store.setActiveSection('verse');
    store.sim.tick(16);

    expect(store.sim.effectSelection.sectionId).toBe('intro'); // the Sim did NOT recall — the server engine is authority
    expect(sent).toContainEqual({ t: 'recallSection', songId: store.activeSongId, sectionId: 'verse' });
  });
});

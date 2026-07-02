import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import { padKey } from './store/seed';
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
  receiveInputEcho(kind: 'midi' | 'osc', value: number, note: number | undefined, channel: number | undefined): void;
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
  it('an echoed MIDI input does NOT fire the local sim, even for a directly-bound graph', () => {
    const store = new TriggerLab(capturing([]));
    // A graph bound to raw note 60 — the sim WOULD have fired it under the old echo handler.
    const key = store.createGraph('Direct 60');
    store.setTriggerSource(key, { kind: 'midi', note: 60 });

    internals(store).receiveInputEcho('midi', 0.8, 60, 0);

    expect(effectEvents(store)).toHaveLength(0);
    expect(store.voices).toHaveLength(0);
  });

  it('MIDI-learn still works from an echoed input (and does not also fire the sim)', () => {
    const store = new TriggerLab(capturing([]));
    const key = store.createGraph('Learn me');
    store.startMidiLearn({ kind: 'trigger', graphKey: key });

    internals(store).receiveInputEcho('midi', 1, 64, 0);

    expect(store.triggerSource(key)).toEqual({ kind: 'midi', note: 64 });
    expect(effectEvents(store)).toHaveLength(0);
  });
});

describe('outbound firing is gated on the engine link (S12)', () => {
  describe('forwardMidi (WebMIDI → server)', () => {
    const bindDirect = (store: TriggerLab): void => {
      const key = store.createGraph('Direct 60');
      store.setTriggerSource(key, { kind: 'midi', note: 60 });
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
    const padWithGraph = (store: TriggerLab) => {
      store.activeSectionId = null; // flat per-pad resolution → the seeded pad graph fires
      return store.pads.find((p) => store.graphs[padKey(p)]) ?? store.pads[0]!;
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

  describe('fireSectionGraph (keyboard performance)', () => {
    it('offline: fires the local preview and sends nothing', () => {
      const sent: ClientMessage[] = [];
      const store = new TriggerLab(capturing(sent));
      expect(store.activeSection?.graphs.length ?? 0).toBeGreaterThan(0);

      store.fireSectionGraph(0);

      expect(effectEvents(store).length).toBeGreaterThan(0);
      expect(sent).toHaveLength(0);
    });

    it('connected: sends the fireGraph intent (exact key), not a synthetic source, and does not fire the sim (S13)', () => {
      const sent: ClientMessage[] = [];
      const store = new TriggerLab(capturing(sent));
      const key0 = store.activeSection!.graphs[0]!;
      store.link = 'open';

      store.fireSectionGraph(0);

      // No local sim fire (authority principle) …
      expect(effectEvents(store)).toHaveLength(0);
      // … and EXACTLY the fireGraph intent goes out — no synthetic key/midi/osc source to
      // re-resolve (which is what echo-re-fired the old keyboard path).
      expect(sent).toEqual([{ t: 'fireGraph', graphKey: key0, velocity: store.velocity }]);
    });

    it('connected: a MIDI-bound section graph sends fireGraph — NOT a synthetic {t:midi} (the old triple-fire) (S13)', () => {
      const sent: ClientMessage[] = [];
      const store = new TriggerLab(capturing(sent));
      const key0 = store.activeSection!.graphs[0]!;
      store.setTriggerSource(key0, { kind: 'midi', note: 60 }); // rebind to a raw MIDI source
      store.link = 'open';

      store.fireSectionGraph(0);

      expect(effectEvents(store)).toHaveLength(0);
      // The whole S13 fix: a MIDI-bound section graph no longer forwards a synthetic {t:'midi'}
      // (which the server re-resolved AND echoed → triple-fire). It sends the exact graph key.
      expect(sent).toEqual([{ t: 'fireGraph', graphKey: key0, velocity: store.velocity }]);
      expect(sent.some((m) => m.t === 'midi')).toBe(false);
    });
  });
});

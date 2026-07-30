import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import { padKey } from './store/seed';
import type { WSClient } from '../ws/client';
import type { ClientMessage } from '../ws/protocol-types';
import type { MidiEvent } from '../midi/webmidi';

/* S12 — the authority principle, in its final form: the ENGINE is the only resolver/renderer, and
   the browser only ever forwards intent. INIT-01 Decision 3 retired the local sim that used to
   resolve while the link was closed, so:
     - the `input` echo (a server broadcast of our own / another client's hit) resolves nothing and
       sends nothing — that was the echo loop — but MIDI-learn and the last-heard badges still run
       from it, which is the whole reason the echo path exists;
     - the outbound paths (forwardMidi / hit / fireSectionGraph / setActiveSection) forward when
       connected and are silent when not. What each one sends IS the observable — there is no local
       resolution left to assert about.
   `start()` is never called (no live socket); a capturing fake client records the sends and
   `link` is set directly to model connected vs offline. */

import { MemStorage } from '../test-support/mem-storage';

const capturing = (sent: ClientMessage[]): (() => WSClient) =>
  () =>
    ({ on() {}, connect() {}, close() {}, send(m: ClientMessage) { sent.push(m); } }) as unknown as WSClient;

/** The MIDI-hardware forward + the server echo have no public wrapper — reach them directly. */
type Internals = {
  forwardMidi(ev: MidiEvent): void;
  receiveInputEcho(kind: 'midi' | 'osc', label: string, value: number, note: number | undefined, channel: number | undefined): void;
};
const internals = (store: TriggerLab): Internals => store as unknown as Internals;

/** Monitor `effect` events — these were the local sim's resolution reports. Nothing writes them
    now, so a non-empty list means a browser-side resolver came back. */
const effectEvents = (store: TriggerLab) => store.monitorEvents.filter((e) => e.type === 'effect');

const noteOn = (n: number, velocity = 100): MidiEvent => ({ kind: 'note', note: n, velocity, on: true, channel: 0 });

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe('onInput echo resolves nothing locally (S12)', () => {
  it('an echoed MIDI input neither resolves nor re-sends, even for a directly-bound graph', () => {
    const sent: ClientMessage[] = [];
    const store = new TriggerLab(capturing(sent));
    // A graph bound to raw note 60 — the old echo handler fired it locally, doubling the hit.
    const key = store.createGraph('Direct 60');
    store.setTriggerSource(key, { kind: 'midi', note: 60 });

    internals(store).receiveInputEcho('midi', 'C4', 0.8, 60, 0);

    expect(effectEvents(store)).toHaveLength(0);
    expect(sent).toHaveLength(0); // no re-forward — that was the echo loop
  });

  it('MIDI-learn still works from an echoed input', () => {
    const store = new TriggerLab(capturing([]));
    const key = store.createGraph('Learn me');
    store.startMidiLearn({ kind: 'trigger', graphKey: key });

    internals(store).receiveInputEcho('midi', 'E4', 1, 64, 0);

    expect(store.triggerSource(key)).toEqual({ kind: 'midi', note: 64 });
    expect(effectEvents(store)).toHaveLength(0);
  });

  /* The B×E integration seam (S04 × S12): S04's badges record from the ONE place all server-side
     input surfaces (the `input` echo), and S12 rewrote that place. Neither slice tested the
     other's half — these pin the union: the echo records last-heard activity for both kinds,
     while still never firing the sim. */
  it('an echoed MIDI input records last-heard badge activity (S04 seam)', () => {
    const store = new TriggerLab(capturing([]));

    internals(store).receiveInputEcho('midi', 'C4', 0.8, 60, 0);

    expect(store.inputBadge({ kind: 'midi', note: 60 })).not.toBeNull();
    expect(store.inputBadge({ kind: 'midi', note: 61 })).toBeNull(); // no churn from other notes
    expect(effectEvents(store)).toHaveLength(0);
  });

  it('an echoed OSC input records last-heard badge activity under its address (S04 seam)', () => {
    const store = new TriggerLab(capturing([]));

    internals(store).receiveInputEcho('osc', '/kick', 0.75, undefined, undefined);

    expect(store.inputBadge({ kind: 'osc', address: '/kick' })).not.toBeNull();
    expect(store.inputBadge({ kind: 'osc', address: '/snare' })).toBeNull();
    expect(effectEvents(store)).toHaveLength(0);
  });
});

describe('outbound intent reaches the engine and nothing resolves locally (S12)', () => {
  describe('forwardMidi (WebMIDI → server)', () => {
    const bindDirect = (store: TriggerLab): void => {
      const key = store.createGraph('Direct 60');
      store.setTriggerSource(key, { kind: 'midi', note: 60 });
    };

    it('offline: forwards the note unconditionally (the closed client drops it) and resolves nothing', () => {
      const sent: ClientMessage[] = [];
      const store = new TriggerLab(capturing(sent));
      bindDirect(store);
      expect(store.link).toBe('offline');

      internals(store).forwardMidi(noteOn(60));

      // The forward is unconditional — the real WSClient no-ops while closed. What must NOT happen
      // is a local resolution standing in for the engine.
      expect(sent).toContainEqual({ t: 'midi', note: 60, velocity: 100, on: true, channel: 0 });
      expect(effectEvents(store)).toHaveLength(0);
    });

    it('connected: forwards the note and resolves nothing locally', () => {
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

    it('offline: sends nothing and resolves nothing — the hit is UI feedback only', () => {
      const sent: ClientMessage[] = [];
      const store = new TriggerLab(capturing(sent));
      const pad = padWithGraph(store);

      store.hit(pad);

      expect(sent).toHaveLength(0);
      expect(effectEvents(store)).toHaveLength(0);
    });

    it('connected: forwards a key hit and resolves nothing locally', () => {
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
    it('offline: selects + flashes the graph but sends nothing and resolves nothing', () => {
      const sent: ClientMessage[] = [];
      const store = new TriggerLab(capturing(sent));
      const key0 = store.activeSection!.graphs[0]!;
      expect(store.activeSection?.graphs.length ?? 0).toBeGreaterThan(0);

      store.fireSectionGraph(0);

      // UI feedback still happens (you pressed the key) — the light does not, because the only
      // renderer is the engine and it is not there.
      expect(store.selectedPadKey).toBe(key0);
      expect(sent).toHaveLength(0);
      expect(effectEvents(store)).toHaveLength(0);
    });

    it('connected: sends the fireGraph intent (exact key), not a synthetic source (S13)', () => {
      const sent: ClientMessage[] = [];
      const store = new TriggerLab(capturing(sent));
      const key0 = store.activeSection!.graphs[0]!;
      store.link = 'open';

      store.fireSectionGraph(0);

      // Nothing resolved locally (authority principle) …
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

/* S15 — the same authority principle for SECTION RECALL. The engine spawns a section's looks on
   recall (engine parity), and it is the ONLY thing that does: `setActiveSection` moves the local
   pointer (an arrangement edit) and forwards `{t:'recallSection'}` when connected. With the link
   down the pointer still moves and no look morphs — there is nothing in the browser to morph. */
describe('setActiveSection recall (S15)', () => {
  /** A fixture section whose looks name at least one effect — the engine spawns those on recall. */
  const sectionWithLook = (store: TriggerLab): string => {
    const s = store.sections.find((sec) => Object.values(sec.looks).some((v) => v != null));
    expect(s, 'a fixture section with a non-null look').toBeTruthy();
    return s!.id;
  };

  it('offline: moves the active-section pointer and sends nothing', () => {
    const sent: ClientMessage[] = [];
    const store = new TriggerLab(capturing(sent));
    expect(store.link).toBe('offline');
    const id = sectionWithLook(store);

    store.setActiveSection(id);

    expect(store.activeSectionId).toBe(id); // the arrangement edit is local and still lands
    expect(sent).toHaveLength(0);
    expect(effectEvents(store)).toHaveLength(0);
  });

  it('connected: forwards the recall so the engine spawns the looks', () => {
    const sent: ClientMessage[] = [];
    const store = new TriggerLab(capturing(sent));
    const id = sectionWithLook(store);
    store.link = 'open';

    store.setActiveSection(id);

    expect(sent).toContainEqual({ t: 'recallSection', songId: store.activeSongId, sectionId: id });
    expect(effectEvents(store)).toHaveLength(0);
  });
});

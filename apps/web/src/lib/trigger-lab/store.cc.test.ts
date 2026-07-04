import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import type { GraphNode } from './sim';
import type { WSClient } from '../ws/client';
import type { MidiEvent } from '../midi/webmidi';
import { voice } from '@ledrums/core';

/* Store-level coverage for the S37 CC-In source node: controller/channel setters with the
   reserved-CC-0 rejection, MIDI-learn binding the next incoming CC (and skipping CC 0), the
   WebMIDI forward feeding the offline sim's CC table, and add-node seeding. */

class MemStorage {
  private m = new Map<string, string>();
  get length(): number { return this.m.size; }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null; }
  getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string): void { this.m.set(k, String(v)); }
  removeItem(k: string): void { this.m.delete(k); }
  clear(): void { this.m.clear(); }
}

const fakeClient = (): WSClient => ({ on() {}, connect() {}, close() {}, send() {} }) as unknown as WSClient;

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

/** A fresh store on a new authored graph with one CC source node. */
function withCc(): { store: TriggerLab; key: string; cc: GraphNode } {
  const store = new TriggerLab(fakeClient);
  const key = store.createGraph('test');
  const cc = store.addNode('cc', 0, 100)!;
  return { store, key, cc };
}

/** Drive a parsed MIDI event through the store's WebMIDI forward (the private path the
    `initMidi` handler wires to). */
function forward(store: TriggerLab, ev: MidiEvent): void {
  (store as unknown as { forwardMidi(e: MidiEvent): void }).forwardMidi(ev);
}

describe('addNode(cc)', () => {
  it('seeds a modulation-source node with controller 1 on omni', () => {
    const { store, cc } = withCc();
    expect(cc.kind).toBe('cc');
    expect(store.ccNodeController(cc)).toBe(1);
    expect(store.ccNodeChannel(cc)).toBeNull();
    expect(voice.isModSourceKind(cc.kind)).toBe(true);
  });
});

describe('setCcController — reserved CC 0 rejection', () => {
  it('accepts a valid controller 1..127', () => {
    const { store, cc } = withCc();
    store.setCcController(cc, 74);
    expect(store.ccNodeController(cc)).toBe(74);
  });

  it('rejects controller 0 (reserved for section recall) — prior value kept', () => {
    const { store, cc } = withCc();
    store.setCcController(cc, 20);
    store.setCcController(cc, 0); // reserved → rejected
    expect(store.ccNodeController(cc)).toBe(20);
    expect(store.isBindableCcController(0)).toBe(false);
  });

  it('rejects out-of-range controllers (>127, negative, NaN)', () => {
    const { store, cc } = withCc();
    store.setCcController(cc, 50);
    store.setCcController(cc, 200);
    store.setCcController(cc, -3);
    store.setCcController(cc, Number.NaN);
    expect(store.ccNodeController(cc)).toBe(50);
  });
});

describe('setCcChannel', () => {
  it('sets a channel 1..16 and clears to omni', () => {
    const { store, cc } = withCc();
    store.setCcChannel(cc, 5);
    expect(store.ccNodeChannel(cc)).toBe(5);
    store.setCcChannel(cc, null);
    expect(store.ccNodeChannel(cc)).toBeNull();
  });

  it('rejects out-of-range channels', () => {
    const { store, cc } = withCc();
    store.setCcChannel(cc, 3);
    store.setCcChannel(cc, 0);
    store.setCcChannel(cc, 17);
    expect(store.ccNodeChannel(cc)).toBe(3);
  });
});

describe('MIDI-learn — binds the next incoming CC', () => {
  it('binds the controller of the next CC event and clears the learn arm', () => {
    const { store, cc } = withCc();
    store.startMidiLearn({ kind: 'cc-node', nodeId: cc.id });
    expect(store.midiLearnTarget).toEqual({ kind: 'cc-node', nodeId: cc.id });
    forward(store, { kind: 'cc', controller: 42, value: 100, channel: 1 });
    expect(store.ccNodeController(cc)).toBe(42);
    expect(store.midiLearnTarget).toBeNull();
  });

  it('does NOT bind CC 0 (reserved) — stays armed for a real controller', () => {
    const { store, cc } = withCc();
    store.setCcController(cc, 7);
    store.startMidiLearn({ kind: 'cc-node', nodeId: cc.id });
    forward(store, { kind: 'cc', controller: 0, value: 100, channel: 1 }); // reserved
    expect(store.ccNodeController(cc)).toBe(7); // unchanged
    expect(store.midiLearnTarget).toEqual({ kind: 'cc-node', nodeId: cc.id }); // still armed
    forward(store, { kind: 'cc', controller: 15, value: 100, channel: 1 }); // real CC
    expect(store.ccNodeController(cc)).toBe(15);
    expect(store.midiLearnTarget).toBeNull();
  });
});

describe('WebMIDI forward feeds the offline sim CC table', () => {
  it('a CC event updates the sim table under omni + its channel (0..1 normalized)', () => {
    const { store } = withCc();
    forward(store, { kind: 'cc', controller: 30, value: 127, channel: 4 });
    const table = (store as unknown as { sim: { ccTable: Map<string, number> } }).sim.ccTable;
    expect(table.get(voice.ccKey(30, null))).toBe(1); // omni slot
    expect(table.get(voice.ccKey(30, 4))).toBe(1); // channel slot
  });
});

describe('OSC modulation input — the cc node reads an OSC address', () => {
  it('defaults to MIDI mode; switching to OSC + an address flips its live source', () => {
    const { store, cc } = withCc();
    expect(store.ccNodeSource(cc)).toBe('midi');
    store.setCcNodeSource(cc, 'osc');
    store.setOscNodeAddress(cc, '  /fader/1  '); // trimmed
    expect(store.ccNodeSource(cc)).toBe('osc');
    expect(store.oscNodeAddress(cc)).toBe('/fader/1');
    expect(voice.nodeModSource(cc)).toEqual({ kind: 'osc', address: '/fader/1' });
  });

  it('ccNodeLiveValue reads the sim OSC table when in OSC mode', () => {
    const { store, cc } = withCc();
    store.setCcNodeSource(cc, 'osc');
    store.setOscNodeAddress(cc, '/fader/1');
    const sim = (store as unknown as { sim: { setOsc(a: string, v: number): void } }).sim;
    expect(store.ccNodeLiveValue(cc)).toBe(0); // unheard → neutral
    sim.setOsc('/fader/1', 0.6);
    expect(store.ccNodeLiveValue(cc)).toBeCloseTo(0.6, 10);
    sim.setOsc('/fader/1', 3); // clamps to 1
    expect(store.ccNodeLiveValue(cc)).toBe(1);
  });
});

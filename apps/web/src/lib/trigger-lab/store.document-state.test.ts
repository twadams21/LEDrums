// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultProject } from '@ledrums/core';
import { flushSync } from 'svelte';
import { TriggerLab } from './store.svelte';
import { makeNode, type TriggerGraph } from './sim';
import { EFFECTS } from './fixtures';
import { serializeShowLibrary } from './persistence';
import type { WSClient, WSCallbacks } from '../ws/client';

const ctx = { velocity: 1, sectionIndex: 0, sectionCount: 0, beatPhase: 0, sourceDrumId: 'kick', bpm: 120 };
function graph(kind: 'sequence' | 'delay' | 'all'): TriggerGraph {
  return {
    version: 3,
    nodes: [
      makeNode('trigger', 'trigger'),
      makeNode(kind, 'route', 100, 0, { ms: 250, delayMode: 'time' }),
      makeNode('effect', 'a', 200, 0, { effectId: EFFECTS[0]!.id, mode: 'loop' }),
      makeNode('effect', 'b', 200, 100, { effectId: EFFECTS[1]!.id, mode: 'loop' }),
      makeNode('output', 'output'),
    ],
    edges: [
      { id: '1', from: 'trigger', to: 'route' },
      { id: '2', from: 'route', to: 'a' },
      ...(kind === 'sequence' ? [{ id: '3', from: 'route', to: 'b' }] : []),
      { id: '4', from: 'a', to: 'output' },
      { id: '5', from: 'b', to: 'output' },
    ],
  };
}
function setup() {
  let callbacks: WSCallbacks = {};
  const send = vi.fn();
  const store = new TriggerLab(() => ({ on(cb: WSCallbacks) { callbacks = cb; }, connect() {}, close() {}, send }) as unknown as WSClient);
  store.start();
  return { store, send, callbacks };
}
beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => vi.unstubAllGlobals());

const transitions = ['new', 'open', 'save-as', 'delete-active', 'delete-last', 'close', 'server-adopt', 'viewer-follow'] as const;
describe.each(transitions)('document replacement: %s', (transition) => {
  it('clears history, runtime and bus ownership even when graph ids/content overlap', () => {
    const { store, callbacks } = setup();
    try {
      const first = store.activeShowId;
      if (transition === 'open' || transition === 'delete-active') store.newShow('Other');
      store.bpm = 177;
      store.runUndoable(() => { store.bpm = 178; });
      const oldSim = store.sim;
      oldSim.triggerGraph('sequence', graph('sequence'), ctx, 'same-key');
      expect(oldSim.voices[0]?.effectId).toBe(EFFECTS[0]!.id);
      oldSim.triggerGraph('delay', graph('delay'), ctx, 'delay-key');
      oldSim.setCc(1, 0.8, 1);
      oldSim.setOsc('/old', 0.5);
      oldSim.setNote(60, 1, 1, true);
      store.beginGesture(); // a replacement also cancels a half-finished drag
      store.runUndoable(() => { store.velocity = 0.3; });
      switch (transition) {
        case 'new': store.newShow(); break;
        case 'open': store.openShow(first); break;
        case 'save-as': store.saveShowAs('Clone'); break;
        case 'delete-active':
        case 'delete-last': store.deleteShow(store.activeShowId); break;
        case 'close': store.closeShow(); break;
        case 'server-adopt':
        case 'viewer-follow': {
          const library = serializeShowLibrary({ activeShowId: first, shows: { [first]: { id: first, name: 'Remote', authored: { ...store.activeShow!.authored, bpm: 99 } } } });
          if (transition === 'viewer-follow') {
            store.presence = { editorId: 'other', youAreEditor: false, clientCount: 2 };
            callbacks.onShowLibrary!(library);
            store.presence = { editorId: 'me', youAreEditor: true, clientCount: 2 };
          } else {
            callbacks.onState!(defaultProject(), { count: 0, positions: [], tangents: [], normals: [], segmentLengths: [], drums: [], bounds: { center: [0, 0, 0], size: 0 } }, [], [], { state: 'disabled', protocol: 'artnet', host: '', packetsSent: 0, lastError: null, universeCount: 0 }, library, null, null, { status: 'listening', port: 9000, hosts: [] });
          }
        }
      }
      const bpm = store.bpm;
      expect(store.undo()).toBe(false);
      expect(store.bpm).toBe(bpm);
      expect(store.sim).not.toBe(oldSim);
      expect(store.sim.buses).toBe(store.buses);
      expect(store.sim.ccTable.size + store.sim.oscTable.size + store.sim.noteTable.size).toBe(0);
      expect(store.voices).toHaveLength(0);
      store.sim.tick(500);
      expect(store.sim.voices).toHaveLength(0); // no delayed or looping voice survives
      store.sim.triggerGraph('sequence', graph('sequence'), ctx, 'same-key');
      expect(store.sim.voices.at(-1)?.effectId).toBe(EFFECTS[0]!.id); // starts at step 1 again
      store.runUndoable(() => { store.bpm = 201; });
      expect(store.undo()).toBe(true); // old gesture suppression did not bleed
      expect(store.bpm).toBe(bpm);
    } finally { store.stop(); }
  });
});

it('preserves runtime and Undo for save, rename, inactive deletion and no-op open', () => {
  const { store } = setup();
  try {
    const inactive = store.activeShowId;
    store.newShow();
    const sim = store.sim;
    store.runUndoable(() => { store.bpm = 177; });
    store.saveShow();
    store.renameShow(store.activeShowId, 'Renamed');
    store.deleteShow(inactive);
    store.openShow(store.activeShowId);
    store.openShow('missing');
    expect(store.sim).toBe(sim);
    expect(store.undo()).toBe(true);
    expect(store.bpm).toBe(120);
  } finally { store.stop(); }
});

it('resets the connected engine for equal-content Save As, but not a position-only edit', () => {
  const { store, callbacks, send } = setup();
  try {
    callbacks.onConnection!('open');
    send.mockClear();
    store.saveShowAs('Same content, new document');
    expect(send.mock.calls.map(([m]) => m.t)).toEqual(['setShow', 'recallSection', 'setTransport']);
    send.mockClear();
    vi.useFakeTimers();
    flushSync();
    store.moveNode(store.graphs[store.selectedPadKey!]!.nodes[0]!, 987, 654);
    flushSync();
    vi.advanceTimersByTime(500);
    expect(send.mock.calls.some(([m]) => m.t === 'setShow')).toBe(false);
  } finally { store.stop(); vi.useRealTimers(); }
});

it('rejects a checkpoint when the active document identity is changed outside the lifecycle', () => {
  const { store } = setup();
  try {
    store.runUndoable(() => { store.bpm = 177; });
    store.activeShowId = 'different-document';
    expect(store.undo()).toBe(false);
    expect(store.bpm).toBe(177);
  } finally { store.stop(); }
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultProject } from '@ledrums/core';
import { flushSync } from 'svelte';
import { TriggerLab } from './store.svelte';
import { makeNode, type TriggerGraph } from './sim';
import { EFFECTS } from './fixtures';
import { serializeShowLibrary, serializeSongLibrary } from './persistence';
import type { ShowsController } from './shows-controller.svelte';
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

it('binds the incoming canonical song pool before creating the adopted document runtime', () => {
  const { store, callbacks } = setup();
  try {
    const id = store.activeShowId;
    const pool = serializeSongLibrary({ songs: { remote: { id: 'remote', name: 'Pool', sections: [], graphs: {}, graphNames: {}, effects: [{ ...EFFECTS[0]!, id: 'remote-effect' }], presets: [] } } });
    const library = serializeShowLibrary({ activeShowId: id, shows: { [id]: { id, name: 'Remote', authored: { ...store.activeShow!.authored, songRefs: ['remote'] } } } });
    callbacks.onState!(defaultProject(), { count: 0, positions: [], tangents: [], normals: [], segmentLengths: [], drums: [], bounds: { center: [0, 0, 0], size: 0 } }, [], [], { state: 'disabled', protocol: 'artnet', host: '', packetsSent: 0, lastError: null, universeCount: 0 }, library, pool, null, { status: 'listening', port: 9000, hosts: [] });
    // Immediately coherent, not eventually fixed by a later autosave effect's registry upsert.
    expect(store.sim.effect('remote-effect')).toBeDefined();
  } finally { store.stop(); }
});

it('enforces the default byte budget without refusing oversized edits or skipping over them', () => {
  const store = new TriggerLab(() => ({ on() {}, connect() {}, close() {}, send() {} }) as unknown as WSClient);
  store.runUndoable(() => { store.bpm = 150; });
  store.graphNames.huge = 'x'.repeat(17 * 1024 * 1024); // UTF-16 alone exceeds 32 MiB
  store.runUndoable(() => { store.bpm = 177; });
  expect(store.bpm).toBe(177);
  expect(store.undo()).toBe(false); // cannot jump past the oversized edit to the older 120 bpm
  delete store.graphNames.huge;
  store.runUndoable(() => { store.bpm = 200; });
  expect(store.undo()).toBe(true);
  expect(store.bpm).toBe(177);
  expect(store.undo()).toBe(false);
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

it('follows accepted hardware recalls without ping-pong and ignores stale ordering', () => {
  const { store, callbacks, send } = setup();
  try {
    store.songs = [
      { id: 'song-a', name: 'A', sections: [{ id: 'a0', name: 'A0', graphs: [], looks: {} }, { id: 'a1', name: 'A1', graphs: [], looks: {} }] },
      { id: 'song-b', name: 'B', sections: [{ id: 'b0', name: 'B0', graphs: [], looks: {} }, { id: 'b1', name: 'B1', graphs: [], looks: {} }] },
    ];
    store.activeSongId = 'song-a';
    store.activeSectionId = 'a0';
    callbacks.onState!(defaultProject(), { count: 0, positions: [], tangents: [], normals: [], segmentLengths: [], drums: [], bounds: { center: [0, 0, 0], size: 0 } }, [], [], { state: 'disabled', protocol: 'artnet', host: '', packetsSent: 0, lastError: null, universeCount: 0 }, null, null, null, { status: 'listening', port: 9000, hosts: [] }, 7);

    callbacks.onRecalled!('song-b', 'b1', 7, 2);
    expect([store.activeSongId, store.activeSectionId]).toEqual(['song-b', 'b1']);
    expect(send).not.toHaveBeenCalled();

    callbacks.onRecalled!('song-a', 'a1', 7, 1);
    callbacks.onRecalled!('song-a', 'a1', 6, 3);
    expect([store.activeSongId, store.activeSectionId]).toEqual(['song-b', 'b1']);
  } finally {
    store.stop();
  }
});

it('a reconnecting viewer adopts the authoritative handshake without sending cached recall', () => {
  const { store, callbacks, send } = setup();
  try {
    store.songs = [
      { id: 'song-a', name: 'A', sections: [{ id: 'a0', name: 'A0', graphs: [], looks: {} }] },
      { id: 'song-b', name: 'B', sections: [{ id: 'b0', name: 'B0', graphs: [], looks: {} }] },
    ];
    store.activeSongId = 'song-a';
    store.activeSectionId = 'a0';
    store.presence = { editorId: 'other', youAreEditor: false, clientCount: 2 };

    callbacks.onConnection!('open');
    expect(send.mock.calls.map(([message]) => message.t)).toEqual(['setShow', 'setTransport']);

    callbacks.onState!(
      defaultProject(),
      { count: 0, positions: [], tangents: [], normals: [], segmentLengths: [], drums: [], bounds: { center: [0, 0, 0], size: 0 } },
      [], [],
      { state: 'disabled', protocol: 'artnet', host: '', packetsSent: 0, lastError: null, universeCount: 0 },
      null, null, null, { status: 'listening', port: 9000, hosts: [] },
      4, 'song-b', 'b0', 12, 'server-session-a',
    );

    expect([store.activeSongId, store.activeSectionId]).toEqual(['song-b', 'b0']);
    expect(send.mock.calls.some(([message]) => message.t === 'recallSection')).toBe(false);
  } finally {
    store.stop();
  }
});

it('sends an explicit null section when selecting a valid zero-section song', () => {
  const { store, callbacks, send } = setup();
  try {
    store.songs = [
      { id: 'empty-song', name: 'Empty', sections: [] },
      { id: 'song-with-section', name: 'Playable', sections: [{ id: 'section-0', name: 'Section 0', graphs: [], looks: {} }] },
    ];
    store.activeSongId = 'song-with-section';
    store.activeSectionId = 'section-0';
    store.presence = { editorId: 'me', youAreEditor: true, clientCount: 1 };

    callbacks.onConnection!('open');
    send.mockClear();
    store.setActiveSong('empty-song');

    expect([store.activeSongId, store.activeSectionId]).toEqual(['empty-song', null]);
    expect(send).toHaveBeenCalledWith({ t: 'recallSection', songId: 'empty-song', sectionId: null });
  } finally {
    store.stop();
  }
});

it('resets recall ordering when the server session changes, even if its revision is lower', () => {
  const { store, callbacks, send } = setup();
  try {
    store.songs = [
      { id: 'song-a', name: 'A', sections: [{ id: 'a0', name: 'A0', graphs: [], looks: {} }] },
      { id: 'song-b', name: 'B', sections: [{ id: 'b0', name: 'B0', graphs: [], looks: {} }] },
    ];
    const state = (revision: number, songId: string, sectionId: string, sequence: number, sessionId: string) => callbacks.onState!(
      defaultProject(),
      { count: 0, positions: [], tangents: [], normals: [], segmentLengths: [], drums: [], bounds: { center: [0, 0, 0], size: 0 } },
      [], [],
      { state: 'disabled', protocol: 'artnet', host: '', packetsSent: 0, lastError: null, universeCount: 0 },
      null, null, null, { status: 'listening', port: 9000, hosts: [] },
      revision, songId, sectionId, sequence, sessionId,
    );

    state(9, 'song-b', 'b0', 99, 'old-server');
    state(1, 'song-a', 'a0', 1, 'restarted-server');
    callbacks.onRecalled!('song-b', 'b0', 9, 100, 'old-server');

    expect([store.activeSongId, store.activeSectionId]).toEqual(['song-a', 'a0']);
    expect(send.mock.calls.some(([message]) => message.t === 'recallSection')).toBe(false);
  } finally {
    store.stop();
  }
});

it('keeps the newest recall pending until its canonical song and section resolve', () => {
  const { store, callbacks } = setup();
  try {
    store.presence = { editorId: 'editor', youAreEditor: false, clientCount: 2 };
    const remote = {
      ...store.songs[0]!,
      id: 'remote-song',
      name: 'Remote',
      sections: [{ ...store.songs[0]!.sections[0]!, id: 'remote-section', name: 'Remote section' }],
      graphs: store.graphs,
      graphNames: store.graphNames,
      effects: store.effects,
      presets: store.presets,
    };
    const showLibrary = serializeShowLibrary({
      activeShowId: store.activeShowId,
      shows: {
        [store.activeShowId]: {
          id: store.activeShowId,
          name: 'Remote show',
          authored: { ...store.activeShow!.authored, songs: [], songRefs: ['remote-song'] },
        },
      },
    });
    const songLibrary = serializeSongLibrary({ songs: { 'remote-song': remote } });

    callbacks.onRecalled!('remote-song', 'missing-section', 4, 1, 'server-session');
    callbacks.onRecalled!('remote-song', 'remote-section', 4, 2, 'server-session');
    expect(store.activeSongId).not.toBe('remote-song');

    callbacks.onState!(
      defaultProject(),
      { count: 0, positions: [], tangents: [], normals: [], segmentLengths: [], drums: [], bounds: { center: [0, 0, 0], size: 0 } },
      [], [],
      { state: 'disabled', protocol: 'artnet', host: '', packetsSent: 0, lastError: null, universeCount: 0 },
      showLibrary, songLibrary, null, { status: 'listening', port: 9000, hosts: [] },
      4, 'remote-song', 'remote-section', 2, 'server-session',
    );

    expect([store.activeSongId, store.activeSectionId]).toEqual(['remote-song', 'remote-section']);
  } finally {
    store.stop();
  }
});

it('allows a viewer to navigate the resolved setlist', () => {
  const { store } = setup();
  try {
    store.songs = [
      { id: 'song-a', name: 'A', sections: [{ id: 'a0', name: 'A0', graphs: [], looks: {} }] },
      { id: 'song-b', name: 'B', sections: [{ id: 'b0', name: 'B0', graphs: [], looks: {} }] },
    ];
    store.activeSongId = 'song-a';
    store.activeSectionId = 'a0';
    store.presence = { editorId: 'other', youAreEditor: false, clientCount: 2 };
    expect(store.stepSetlist('song', 1)).toBe(true);
    expect(store.activeSongId).toBe('song-b');
    expect(store.canEdit).toBe(false);
  } finally {
    store.stop();
  }
});

it('resets the connected engine for equal-content Save As, but not a position-only edit', () => {
  const { store, callbacks, send } = setup();
  try {
    callbacks.onConnection!('open');
    send.mockClear();
    store.saveShowAs('Same content, new document');
    expect(send.mock.calls.map(([m]) => m.t)).toEqual(['setShow', 'setTransport']);
    send.mockClear();
    vi.useFakeTimers();
    flushSync();
    store.moveNode(store.graphs[store.selectedPadKey!]!.nodes[0]!, 987, 654);
    flushSync();
    vi.advanceTimersByTime(500);
    expect(send.mock.calls.some(([m]) => m.t === 'setShow')).toBe(false);
  } finally { store.stop(); vi.useRealTimers(); }
});

it('Save As preserves the exact live authored content, including a deleted built-in preset', () => {
  const { store } = setup();
  try {
    const sourceId = store.activeShowId;
    const presetId = 'gen:radial-wash:pop';
    expect(store.presets.some((p) => p.id === presetId)).toBe(true);
    expect(store.deletePreset(presetId)).toBe(true);
    store.runUndoable(() => { store.bpm = 177; });
    store.saveShow();
    const library = () => (store as unknown as { showsCtl: ShowsController }).showsCtl.currentLibrary();
    const authored = () => library().shows[store.activeShowId]!.authored;
    const before = JSON.stringify(authored());
    const oldSim = store.sim;
    store.sim.triggerGraph('loop', graph('all'), ctx, 'loop');
    const cloneId = store.saveShowAs('Clone');
    expect(cloneId).not.toBe(sourceId);
    expect(store.sim).not.toBe(oldSim);
    expect(store.voices).toHaveLength(0);
    expect(store.undo()).toBe(false);
    store.saveShow(); // prove the live clone and its persisted slot agree
    expect(JSON.stringify(authored())).toBe(before);
    expect(JSON.stringify(store.activeShow!.authored)).toBe(before);
    expect(JSON.stringify(library().shows[sourceId]!.authored)).toBe(before);
    expect(store.presets.some((p) => p.id === presetId)).toBe(false);
    store.runUndoable(() => { store.bpm = 200; });
    expect(store.undo()).toBe(true);
    expect(store.bpm).toBe(177);
  } finally { store.stop(); }
});

it('still backfills and migrates genuinely loaded documents', () => {
  const { store } = setup();
  try {
    const sourceId = store.activeShowId;
    expect(store.deletePreset('gen:radial-wash:pop')).toBe(true);
    const key = store.selectedPadKey!;
    const loadedGraph = store.graphs[key]!;
    // A legacy graph in a saved slot still needs the normal load-time migration.
    delete loadedGraph.version;
    store.newShow('Other');
    store.openShow(sourceId);
    expect(store.presets.some((p) => p.id === 'gen:radial-wash:pop')).toBe(true);
    expect(store.graphs[key]!.version).toBe(3);
  } finally { store.stop(); }
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

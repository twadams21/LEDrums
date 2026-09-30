// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultProject } from '@ledrums/core';
import { flushSync } from 'svelte';
import { TriggerLab } from './store.svelte';
import { serializeShowLibraryV3 as serializeShowLibrary, serializeSongLibraryV2 as serializeSongLibrary } from './persistence';
import type { ShowsController } from './shows-controller.svelte';
import type { WSClient, WSCallbacks } from '../ws/client';

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
  it('clears history and the runtime, and cancels a half-finished gesture', () => {
    const { store, callbacks } = setup();
    try {
      const first = store.activeShowId;
      if (transition === 'open' || transition === 'delete-active') store.newShow('Other');
      store.bpm = 177;
      store.runUndoable(() => { store.bpm = 178; });
      const oldSim = store.sim;
      store.fireEffectAt(0); // a live voice on the outgoing runtime
      oldSim.tick(16);
      expect(oldSim.effectVoiceStats().length).toBeGreaterThan(0);
      oldSim.setCc(1, 0.8, 1);
      oldSim.setOsc('/old', 0.5);
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
      expect(store.sim).not.toBe(oldSim); // a fresh engine: no voice, table or latch of the old show survives
      expect(store.effectVoices).toEqual([]);
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
    const pool = serializeSongLibrary({ songs: { remote: { id: 'remote', name: 'Pool', sections: [{ id: 'lib:remote/s', name: 'S', effects: [], master: [] }] } } });
    const authored = { ...store.activeShow!.authored, songRefs: ['remote'], activeSongId: 'remote', activeSectionId: 'lib:remote/s' };
    const library = serializeShowLibrary({ activeShowId: id, shows: { [id]: { id, name: 'Remote', authored } } });
    callbacks.onState!(defaultProject(), { count: 0, positions: [], tangents: [], normals: [], segmentLengths: [], drums: [], bounds: { center: [0, 0, 0], size: 0 } }, [], [], { state: 'disabled', protocol: 'artnet', host: '', packetsSent: 0, lastError: null, universeCount: 0 }, library, pool, null, { status: 'listening', port: 9000, hosts: [] });
    // Immediately coherent: the adopted runtime's Effect show already holds the referenced
    // song, so the offline engine recalled its section (not fixed later by an autosave tick).
    store.sim.tick(16); // the recall input lands on the next engine tick
    expect(store.sim.effectSelection).toEqual({ songId: 'remote', sectionId: 'lib:remote/s' });
  } finally { store.stop(); }
});

it('enforces the default byte budget without refusing oversized edits or skipping over them', () => {
  const store = new TriggerLab(() => ({ on() {}, connect() {}, close() {}, send() {} }) as unknown as WSClient);
  store.runUndoable(() => { store.bpm = 150; });
  store.patchLabels = { huge: 'x'.repeat(17 * 1024 * 1024) }; // UTF-16 alone exceeds 32 MiB
  store.runUndoable(() => { store.bpm = 177; });
  expect(store.bpm).toBe(177);
  expect(store.undo()).toBe(false); // cannot jump past the oversized edit to the older 120 bpm
  store.patchLabels = {};
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
      { id: 'song-a', name: 'A', sections: [{ id: 'a0', name: 'A0', effects: [], master: [] }, { id: 'a1', name: 'A1', effects: [], master: [] }] },
      { id: 'song-b', name: 'B', sections: [{ id: 'b0', name: 'B0', effects: [], master: [] }, { id: 'b1', name: 'B1', effects: [], master: [] }] },
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

it('rejects an authoritative null section for a non-empty resolved song', () => {
  const { store, callbacks } = setup();
  try {
    store.songs = [{ id: 'song-a', name: 'A', sections: [{ id: 'a0', name: 'A0', effects: [], master: [] }] }];
    store.activeSongId = 'song-a';
    store.activeSectionId = 'a0';
    callbacks.onState!(
      defaultProject(),
      { count: 0, positions: [], tangents: [], normals: [], segmentLengths: [], drums: [], bounds: { center: [0, 0, 0], size: 0 } },
      [], [],
      { state: 'disabled', protocol: 'artnet', host: '', packetsSent: 0, lastError: null, universeCount: 0 },
      null, null, null, { status: 'listening', port: 9000, hosts: [] },
      7, 'song-a', 'a0', 1, 'server-session',
    );

    callbacks.onRecalled!('song-a', null, 7, 2, 'server-session');
    expect([store.activeSongId, store.activeSectionId]).toEqual(['song-a', 'a0']);
  } finally { store.stop(); }
});

it('a reconnecting viewer adopts the authoritative handshake without sending cached recall', () => {
  const { store, callbacks, send } = setup();
  try {
    store.songs = [
      { id: 'song-a', name: 'A', sections: [{ id: 'a0', name: 'A0', effects: [], master: [] }] },
      { id: 'song-b', name: 'B', sections: [{ id: 'b0', name: 'B0', effects: [], master: [] }] },
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

it('applies the staged handshake recall after adopting an already-resolved canonical document', () => {
  const { store, callbacks } = setup();
  try {
    store.presence = { editorId: 'other', youAreEditor: false, clientCount: 2 };
    const librarySong = (id: string, name: string, sectionId: string) => ({
      id, name, sections: [{ id: sectionId, name: sectionId.toUpperCase(), effects: [], master: [] }],
    });
    const songA = librarySong('canonical-a', 'A', 'a0');
    const songB = librarySong('canonical-b', 'B', 'b0');
    const authored = { ...store.activeShow!.authored, songs: [], songRefs: ['canonical-a', 'canonical-b'], activeSongId: 'canonical-a', activeSectionId: 'a0' };
    const showLibrary = serializeShowLibrary({
      activeShowId: store.activeShowId,
      shows: { [store.activeShowId]: { id: store.activeShowId, name: 'Remote', authored } },
    });
    const songLibrary = serializeSongLibrary({ songs: { 'canonical-a': songA, 'canonical-b': songB } });

    callbacks.onState!(
      defaultProject(),
      { count: 0, positions: [], tangents: [], normals: [], segmentLengths: [], drums: [], bounds: { center: [0, 0, 0], size: 0 } },
      [], [],
      { state: 'disabled', protocol: 'artnet', host: '', packetsSent: 0, lastError: null, universeCount: 0 },
      showLibrary, songLibrary, null, { status: 'listening', port: 9000, hosts: [] },
      4, 'canonical-b', 'b0', 2, 'server-session',
    );

    expect([store.activeSongId, store.activeSectionId]).toEqual(['canonical-b', 'b0']);
  } finally { store.stop(); }
});

it('keeps a superseding recall pending across delayed canonical adoption, then applies the newest one', () => {
  const { store, callbacks } = setup();
  try {
    store.presence = { editorId: 'other', youAreEditor: false, clientCount: 2 };
    const librarySong = (id: string, name: string, sectionId: string) => ({
      id, name, sections: [{ id: sectionId, name: sectionId.toUpperCase(), effects: [], master: [] }],
    });
    const songB = librarySong('canonical-b', 'B', 'b0');
    const songC = librarySong('canonical-c', 'C', 'c0');
    callbacks.onRecalled!('canonical-b', 'b0', 4, 1, 'server-session');
    callbacks.onRecalled!('canonical-c', 'c0', 4, 2, 'server-session');

    const authored = { ...store.activeShow!.authored, songs: [], songRefs: ['canonical-b', 'canonical-c'], activeSongId: 'canonical-b', activeSectionId: 'b0' };
    callbacks.onState!(
      defaultProject(),
      { count: 0, positions: [], tangents: [], normals: [], segmentLengths: [], drums: [], bounds: { center: [0, 0, 0], size: 0 } },
      [], [],
      { state: 'disabled', protocol: 'artnet', host: '', packetsSent: 0, lastError: null, universeCount: 0 },
      serializeShowLibrary({ activeShowId: store.activeShowId, shows: { [store.activeShowId]: { id: store.activeShowId, name: 'Remote', authored } } }),
      serializeSongLibrary({ songs: { 'canonical-b': songB } }),
      null, { status: 'listening', port: 9000, hosts: [] },
      4, 'canonical-b', 'b0', 1, 'server-session',
    );
    expect([store.activeSongId, store.activeSectionId]).toEqual(['canonical-b', 'b0']);

    callbacks.onSongLibrary!(serializeSongLibrary({ songs: { 'canonical-b': songB, 'canonical-c': songC } }));
    expect([store.activeSongId, store.activeSectionId]).toEqual(['canonical-c', 'c0']);
  } finally { store.stop(); }
});

it('sends an explicit null section when selecting a valid zero-section song', () => {
  const { store, callbacks, send } = setup();
  try {
    store.songs = [
      { id: 'empty-song', name: 'Empty', sections: [] },
      { id: 'song-with-section', name: 'Playable', sections: [{ id: 'section-0', name: 'Section 0', effects: [], master: [] }] },
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
      { id: 'song-a', name: 'A', sections: [{ id: 'a0', name: 'A0', effects: [], master: [] }] },
      { id: 'song-b', name: 'B', sections: [{ id: 'b0', name: 'B0', effects: [], master: [] }] },
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
      id: 'remote-song',
      name: 'Remote',
      sections: [{ id: 'remote-section', name: 'Remote section', effects: [], master: [] }],
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
      { id: 'song-a', name: 'A', sections: [{ id: 'a0', name: 'A0', effects: [], master: [] }] },
      { id: 'song-b', name: 'B', sections: [{ id: 'b0', name: 'B0', effects: [], master: [] }] },
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

it('resets the connected engine for equal-content Save As', () => {
  const { store, callbacks, send } = setup();
  try {
    callbacks.onConnection!('open');
    send.mockClear();
    store.saveShowAs('Same content, new document');
    expect(send.mock.calls.map(([m]) => m.t)).toEqual(['setShow', 'setTransport']);
  } finally { store.stop(); }
});

it('Save As preserves the exact live authored content, including a removed seed Effect', () => {
  const { store } = setup();
  try {
    const sourceId = store.activeShowId;
    const removed = store.activeSection!.effects[0]!.id;
    store.removeEffect(removed);
    store.runUndoable(() => { store.bpm = 177; });
    store.saveShow();
    const library = () => (store as unknown as { showsCtl: ShowsController }).showsCtl.currentLibrary();
    const authored = () => library().shows[store.activeShowId]!.authored;
    const before = JSON.stringify(authored());
    const oldSim = store.sim;
    const cloneId = store.saveShowAs('Clone');
    expect(cloneId).not.toBe(sourceId);
    expect(store.sim).not.toBe(oldSim);
    expect(store.undo()).toBe(false);
    store.saveShow(); // prove the live clone and its persisted slot agree
    expect(JSON.stringify(authored())).toBe(before);
    expect(JSON.stringify(store.activeShow!.authored)).toBe(before);
    expect(JSON.stringify(library().shows[sourceId]!.authored)).toBe(before);
    expect(store.effectById(removed)).toBeUndefined();
    store.runUndoable(() => { store.bpm = 200; });
    expect(store.undo()).toBe(true);
    expect(store.bpm).toBe(177);
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

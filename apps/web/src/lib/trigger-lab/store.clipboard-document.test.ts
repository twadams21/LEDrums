// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { TriggerLab } from './store.svelte';
import { buildSectionClipDoc, buildSongClipDoc, serialize } from './clipdoc';
import { serializeShowLibraryV3, SHOWS_V3_STORAGE_KEY } from './persistence';
import { toastStore } from '../ui/toast.svelte';
import type { WSCallbacks, WSClient } from '../ws/client';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup() {
  let callbacks: WSCallbacks = {};
  const store = new TriggerLab(() => ({ on(cb: WSCallbacks) { callbacks = cb; }, connect() {}, close() {}, send() {} }) as unknown as WSClient);
  store.start();
  return { store, callbacks };
}
const kinds = ['section', 'song-show', 'song-library'] as const;
type Kind = typeof kinds[number];
function clipText(store: TriggerLab, kind: Kind): string {
  // Match the production adapter's detached snapshot: structuredClone cannot consume rune proxies.
  const sources = JSON.parse(JSON.stringify({ canvasScenes: store.canvasScenes }));
  const song = JSON.parse(JSON.stringify(store.songs.find((s) => s.id === store.activeSongId)));
  if (kind === 'section') return serialize(buildSectionClipDoc(song.sections[0], sources));
  return serialize(buildSongClipDoc(song, sources));
}
function paste(store: TriggerLab, kind: Kind) {
  if (kind === 'section') return store.pasteSectionFromClipboard();
  store.openSongPaste();
  return store.pasteSong(kind === 'song-show' ? 'show' : 'library');
}
function replace(store: TriggerLab, callbacks: WSCallbacks, sameId: boolean) {
  if (!sameId) { store.newShow('B'); return; }
  store.saveShow();
  const id = store.activeShowId;
  const library = serializeShowLibraryV3({ activeShowId: id, shows: { [id]: {
    id, name: 'Same ID, new server revision', authored: { ...store.activeShow!.authored, bpm: 99 },
  } } });
  store.presence = { editorId: 'other', youAreEditor: false, clientCount: 2 };
  callbacks.onShowLibrary!(library);
  store.presence = { editorId: 'me', youAreEditor: true, clientCount: 2 };
  expect(store.activeShowId).toBe(id);
  expect(store.bpm).toBe(99);
}
function snapshot(store: TriggerLab) {
  store.saveShow();
  const authored = JSON.parse(localStorage.getItem(SHOWS_V3_STORAGE_KEY)!).data.shows[store.activeShowId].authored;
  return JSON.stringify({ authored, pool: store.songLibrary });
}
function flushAutosave() { flushSync(); vi.advanceTimersByTime(500); }

beforeEach(() => {
  vi.useFakeTimers();
  const cache = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => cache.get(key) ?? null, setItem: (key: string, value: string) => cache.set(key, value) });
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  toastStore.clear();
});
afterEach(() => {
  toastStore.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe.each([false, true])('clipboard document lifetime (same ID: %s)', (sameId) => {
  describe.each(kinds)('%s paste', (kind) => {
    it.each(['valid', 'invalid', 'rejected'] as const)('ignores an outgoing %s read without mutating/autosaving or leaking feedback', async (outcome) => {
      const { store, callbacks } = setup();
      try {
        const pending = deferred<string>();
        vi.stubGlobal('navigator', { clipboard: { readText: () => pending.promise } });
        const text = clipText(store, kind);
        const work = paste(store, kind);
        replace(store, callbacks, sameId);
        flushAutosave();
        const before = snapshot(store);
        const saved = localStorage.getItem(SHOWS_V3_STORAGE_KEY);
        toastStore.clear();
        if (outcome === 'rejected') pending.reject(new Error('permission denied'));
        else pending.resolve(outcome === 'valid' ? text : 'not a ClipDoc');
        const result = await work;
        flushAutosave();
        expect(localStorage.getItem(SHOWS_V3_STORAGE_KEY)).toBe(saved);
        expect(snapshot(store)).toBe(before);
        expect(store.pasteFallback).toBeNull();
        expect(store.songPasteOpen).toBe(false);
        expect(toastStore.items).toHaveLength(0);
        if (kind.startsWith('song')) expect(result).toBe('cancelled'); // dialog must not reveal its old fallback
      } finally { store.stop(); }
    });

    it('does not let a rejected old read interfere with a subsequent valid new paste', async () => {
      const { store, callbacks } = setup();
      try {
        const oldRead = deferred<string>();
        const newRead = deferred<string>();
        const readText = vi.fn().mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(newRead.promise);
        vi.stubGlobal('navigator', { clipboard: { readText } });
        const oldWork = paste(store, kind);
        replace(store, callbacks, sameId);
        const text = clipText(store, kind);
        const before = snapshot(store);
        const newWork = paste(store, kind);
        toastStore.clear();
        oldRead.reject(new Error('late permission denial'));
        await oldWork;
        expect(store.pasteFallback).toBeNull();
        expect(store.songPasteOpen).toBe(kind.startsWith('song'));
        expect(toastStore.items).toHaveLength(0);
        newRead.resolve(text);
        await newWork;
        expect(snapshot(store)).not.toBe(before);
        expect(toastStore.items).toHaveLength(1);
        expect(toastStore.items[0]!.tone).toBe('success');
      } finally { store.stop(); }
    });

    it('closes an existing manual fallback and makes its old submission inert', async () => {
      const { store, callbacks } = setup();
      try {
        vi.stubGlobal('navigator', { clipboard: { readText: async () => { throw new Error('blocked'); } } });
        const text = clipText(store, kind);
        await paste(store, kind);
        if (kind.startsWith('song')) expect(store.songPasteOpen).toBe(true);
        else expect(store.pasteFallback?.context).toBe(kind);
        replace(store, callbacks, sameId);
        const before = snapshot(store);
        toastStore.clear();
        expect(store.pasteFallback).toBeNull();
        expect(store.songPasteOpen).toBe(false);
        if (kind.startsWith('song')) store.pasteSongText(kind === 'song-show' ? 'show' : 'library', text);
        else store.submitPasteFallback(text);
        expect(snapshot(store)).toBe(before);
        expect(toastStore.items).toHaveLength(0);
        // A fresh fallback still works after replacement.
        const freshBefore = snapshot(store);
        await paste(store, kind);
        if (kind.startsWith('song')) store.pasteSongText(kind === 'song-show' ? 'show' : 'library', text);
        else store.submitPasteFallback(text);
        expect(snapshot(store)).not.toBe(freshBefore);
        expect(toastStore.items.at(-1)!.tone).toBe('success');
      } finally { store.stop(); }
    });
  });

  it('does not let an old rejected section read consume the new document’s in-app clipboard', async () => {
    const { store, callbacks } = setup();
    try {
      const pending = deferred<string>();
      vi.stubGlobal('navigator', { clipboard: { readText: () => pending.promise } });
      const work = store.pasteSectionFromClipboard();
      replace(store, callbacks, sameId);
      store.copySection(store.activeSectionId!);
      expect(store.sectionClipboard).not.toBeNull();
      const before = snapshot(store);
      toastStore.clear();
      pending.reject(new Error('late permission denial'));
      await work;
      expect(snapshot(store)).toBe(before);
      expect(store.pasteFallback).toBeNull();
      expect(toastStore.items).toHaveLength(0);
      // The current document can still use that same in-app fallback normally.
      const sectionsBefore = store.activeSong!.sections.length;
      await store.pasteSectionFromClipboard();
      expect(store.activeSong!.sections.length).toBe(sectionsBefore + 1);
    } finally { store.stop(); }
  });

  it('does not write the in-app section clipboard when the client is a viewer', () => {
    const { store } = setup();
    try {
      const sectionId = store.activeSectionId!;
      expect(store.copySection(sectionId)).toBe(true);
      const before = JSON.stringify(store.sectionClipboard);
      store.presence = { editorId: 'other', youAreEditor: false, clientCount: 2 };
      expect(store.isViewer).toBe(true);
      expect(store.copySection(sectionId)).toBe(false);
      expect(JSON.stringify(store.sectionClipboard)).toBe(before);
    } finally { store.stop(); }
  });

  it.each([true, false])('suppresses outgoing copy feedback (write succeeds: %s)', async (succeeds) => {
    const { store, callbacks } = setup();
    try {
      const pending = deferred<void>();
      vi.stubGlobal('navigator', { clipboard: { writeText: () => pending.promise } });
      const work = store.copySongToClipboard(store.activeSongId);
      replace(store, callbacks, sameId);
      toastStore.clear();
      if (succeeds) pending.resolve(); else pending.reject(new Error('blocked'));
      await work;
      expect(toastStore.items).toHaveLength(0);
    } finally { store.stop(); }
  });
});

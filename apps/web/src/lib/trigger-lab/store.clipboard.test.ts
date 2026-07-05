import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultProject } from '@ledrums/core';
import { TriggerLab } from './store.svelte';
import {
  buildGraphClipDoc,
  buildSectionClipDoc,
  buildSongClipDoc,
  buildPatchClipDoc,
  serialize,
  type RemapMint,
} from './clipdoc';
import type { ClosureSources } from './store/song-library';
import { nid } from './store/ids';
import type { WSClient } from '../ws/client';

/* Clipboard copy/paste on the store (S44). The pure build/parse/remap contract is covered in
   clipdoc.test.ts; here we exercise the STORE adapter: materializePaste parses text, remaps against
   THIS show, unions the fresh closure and inserts the primary — for graph / section / song(show) /
   song(library) — plus the friendly-error paths (foreign text, wrong context, patch kind). Copy is
   the system-clipboard IO layer (navigator), tested only for its doc-building here. */

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

const fakeClient = (): WSClient => ({ on() {}, connect() {}, close() {}, send() {} }) as unknown as WSClient;

/** A deterministic minter so pasted ids are predictable in assertions. */
function testMint(): RemapMint {
  let g = 0;
  let e = 0;
  let p = 0;
  let s = 0;
  let so = 0;
  let sc = 0;
  return {
    graph: () => `tg-${++g}`,
    effect: () => `te-${++e}`,
    preset: () => `tp-${++p}`,
    section: () => `ts-${++s}`,
    song: () => `tso-${++so}`,
    scene: () => `tsc-${++sc}`,
  };
}

const sourcesOf = (store: TriggerLab): ClosureSources => ({
  graphs: store.resolvedView.graphs,
  graphNames: store.resolvedView.graphNames,
  effects: store.resolvedView.effects,
  presets: store.resolvedView.presets,
});

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe('paste materialize — graph', () => {
  it('re-adds a graph and reuses its (built-in / content-equal) effect closure — no dup effects', () => {
    const store = new TriggerLab(fakeClient);
    const key = Object.keys(store.graphs)[0]!;
    const text = serialize(buildGraphClipDoc(key, sourcesOf(store)));
    const effectsBefore = store.effects.length;

    // Remove the source graph so the paste actually mints a fresh one (else content-reuse absorbs it).
    store.deleteGraph(key);
    const res = store.materializePaste(text, { context: 'graph', mint: testMint() });

    expect(res.ok).toBe(true);
    expect(res.ok && res.kind).toBe('graph');
    expect(store.selectedPadKey).toBe('tg-1');
    expect(store.graphs['tg-1']).toBeDefined();
    // effects were reused (built-in / content-equal), never duplicated
    expect(store.effects.length).toBe(effectsBefore);
  });

  it('reserves a pasted graph’s carried node ids so a later node mint never collides', () => {
    const store = new TriggerLab(fakeClient);
    const key = Object.keys(store.graphs)[0]!;
    const doc = buildGraphClipDoc(key, sourcesOf(store));
    expect(doc.payload.graph.nodes.length).toBeGreaterThan(0);
    // A high node id as if copied from another machine whose counter ran ahead of ours.
    doc.payload.graph.nodes[0]!.id = 'n-9000001';

    const res = store.materializePaste(serialize(doc), { context: 'graph', mint: testMint() });
    expect(res.ok).toBe(true);
    // The global node counter is now past the carried id — the next mint can't duplicate it.
    expect(Number(nid('n').split('-')[1])).toBeGreaterThan(9000001);
  });

  it('double-paste of the same graph creates exactly one copy (content reuse)', () => {
    const store = new TriggerLab(fakeClient);
    const key = Object.keys(store.graphs)[0]!;
    const text = serialize(buildGraphClipDoc(key, sourcesOf(store)));
    store.deleteGraph(key);

    store.materializePaste(text, { context: 'graph', mint: testMint() });
    const afterFirst = Object.keys(store.graphs).length;
    store.materializePaste(text, { context: 'graph', mint: testMint() });
    const afterSecond = Object.keys(store.graphs).length;

    expect(afterSecond).toBe(afterFirst); // the second paste reuses the first's content
  });
});

describe('paste materialize — section', () => {
  it('appends the section to the active song and activates it', () => {
    const store = new TriggerLab(fakeClient);
    const sec = store.resolvedView.songs[0]!.sections[0]!;
    const text = serialize(buildSectionClipDoc(sec, sourcesOf(store)));
    const sectionsBefore = store.activeSong!.sections.length;

    const res = store.materializePaste(text, { context: 'section', mint: testMint() });

    expect(res.ok).toBe(true);
    expect(store.activeSong!.sections.length).toBe(sectionsBefore + 1);
    expect(store.activeSectionId).toBe('ts-1');
    expect(store.activeSong!.sections.some((s) => s.id === 'ts-1')).toBe(true);
  });
});

describe('paste materialize — song', () => {
  it('into this show: inserts a new song and activates it, closure intact', () => {
    const store = new TriggerLab(fakeClient);
    const song = store.resolvedView.songs[0]!;
    const text = serialize(buildSongClipDoc(song, sourcesOf(store)));
    const songsBefore = store.songs.length;

    const res = store.materializePaste(text, { context: 'song', songDest: 'show', mint: testMint() });

    expect(res.ok).toBe(true);
    expect(store.songs.length).toBe(songsBefore + 1);
    expect(store.activeSongId).toBe('tso-1');
    const pasted = store.songs.find((s) => s.id === 'tso-1')!;
    // every section graph the pasted song references resolves in the show
    for (const secn of pasted.sections) for (const gk of secn.graphs) expect(store.graphs[gk]).toBeDefined();
  });

  it('into the Song Library: adds a self-contained pool entry (not a show song)', () => {
    const store = new TriggerLab(fakeClient);
    const song = store.resolvedView.songs[0]!;
    const text = serialize(buildSongClipDoc(song, sourcesOf(store)));
    const songsBefore = store.songs.length;

    const res = store.materializePaste(text, { context: 'song', songDest: 'library' });

    expect(res.ok).toBe(true);
    expect(store.songs.length).toBe(songsBefore); // show setlist untouched
    expect(store.songLibraryList.length).toBe(1);
  });
});

describe('paste materialize — friendly errors', () => {
  it('foreign / malformed text ⇒ typed failure, no state change', () => {
    const store = new TriggerLab(fakeClient);
    const before = Object.keys(store.graphs).length;

    const res = store.materializePaste('not a clipdoc at all', { context: 'graph' });

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.message).toMatch(/didn’t contain|isn’t from/i);
    expect(Object.keys(store.graphs).length).toBe(before);
  });

  it('wrong context (a graph pasted where a song is expected) ⇒ named mismatch', () => {
    const store = new TriggerLab(fakeClient);
    const key = Object.keys(store.graphs)[0]!;
    const text = serialize(buildGraphClipDoc(key, sourcesOf(store)));

    const res = store.materializePaste(text, { context: 'song' });

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.message).toContain('graph');
  });

  it('a patch ClipDoc is redirected to the Patch view, never remapped', () => {
    const store = new TriggerLab(fakeClient);
    const project = defaultProject();
    const patch = serialize(buildPatchClipDoc({ kit: project.kit, inputMap: project.inputMap, output: project.output }));

    const res = store.materializePaste(patch, { context: 'song' });

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.message).toMatch(/patch/i);
  });
});

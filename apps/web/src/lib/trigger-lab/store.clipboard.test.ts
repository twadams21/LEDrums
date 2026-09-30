import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultProject } from '@ledrums/core';
import { TriggerLab } from './store.svelte';
import { buildEffectClipDoc, buildSectionClipDoc, buildSongClipDoc, buildPatchClipDoc, serialize, type RemapMint } from './clipdoc';
import type { WSClient } from '../ws/client';

/* Clipboard copy/paste on the store (S44). The pure build/parse/remap contract is covered in
   clipdoc.test.ts; here we exercise the STORE adapter: materializePaste parses text, remaps against
   THIS show and inserts the section / song (into the show, or into the Song Library) — plus the
   friendly-error paths (foreign text, wrong context, patch kind). */

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
  let s = 0;
  let so = 0;
  let sc = 0;
  return {
    section: () => `ts-${++s}`,
    song: () => `tso-${++so}`,
    scene: () => `tsc-${++sc}`,
  };
}

const sourcesOf = (store: TriggerLab) => ({ canvasScenes: store.canvasScenes });

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe('paste materialize — section', () => {
  it('appends the section, its Effects and Master chain intact, and activates it', () => {
    const store = new TriggerLab(fakeClient);
    const sec = store.resolvedView.songs[0]!.sections[0]!;
    const text = serialize(buildSectionClipDoc(sec, sourcesOf(store)));
    const sectionsBefore = store.activeSong!.sections.length;

    const res = store.materializePaste(text, { context: 'section', mint: testMint() });

    expect(res).toEqual({ ok: true, kind: 'section', message: 'Pasted section.' });
    expect(store.activeSong!.sections.length).toBe(sectionsBefore + 1);
    expect(store.activeSectionId).toBe('ts-1');
    const pasted = store.activeSong!.sections.find((s) => s.id === 'ts-1')!;
    expect(pasted.effects).toEqual(sec.effects);
    expect(pasted.master).toEqual(sec.master);
  });

  it('is one undo step', () => {
    const store = new TriggerLab(fakeClient);
    const sec = store.resolvedView.songs[0]!.sections[0]!;
    const before = store.activeSong!.sections.map((s) => s.id);
    store.materializePaste(serialize(buildSectionClipDoc(sec, sourcesOf(store))), { context: 'section', mint: testMint() });
    store.undo();
    expect(store.activeSong!.sections.map((s) => s.id)).toEqual(before);
  });

  it('carries a scene the Effects play to another show, reusing it on a second paste', () => {
    const source = new TriggerLab(fakeClient);
    const sceneId = source.createCanvasScene('Aurora');
    const effectId = source.addEffect({ row: 'kit', column: { kind: 'always' } }, 'scene')!;
    source.setGeneratorParam(effectId, 'sceneId', sceneId);
    const text = serialize(buildSectionClipDoc(source.activeSection!, sourcesOf(source)));

    const target = new TriggerLab(fakeClient);
    target.newShow('Other');
    expect(target.canvasScenes).toEqual([]);
    const mint = testMint();
    target.materializePaste(text, { context: 'section', mint });
    target.materializePaste(text, { context: 'section', mint });

    expect(target.canvasScenes.map((s) => [s.id, s.name])).toEqual([['tsc-1', 'Aurora']]);
    const pasted = target.activeSection!.effects.find((e) => e.id === effectId)!;
    expect(pasted.generator.params.sceneId).toBe('tsc-1');
  });

  it('rejects a section ClipDoc while a canonical library song is active without minting or selecting', () => {
    const store = new TriggerLab(fakeClient);
    const libraryId = store.exportSongToLibrary(store.activeSongId)!;
    store.importSongReference(libraryId);
    store.setActiveSong(libraryId);
    const section = store.resolvedView.songs.find((song) => song.id === libraryId)!.sections[0]!;
    const text = serialize(buildSectionClipDoc(section, sourcesOf(store)));
    const before = { activeSectionId: store.activeSectionId, sectionCount: store.activeSong!.sections.length };

    const res = store.materializePaste(text, { context: 'section', mint: testMint() });

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.message).toContain('read-only');
    expect(store.activeSectionId).toBe(before.activeSectionId);
    expect(store.activeSong!.sections).toHaveLength(before.sectionCount);
  });
});

describe('paste materialize — song', () => {
  it('into this show: inserts a new song with its sections re-keyed and activates it', () => {
    const store = new TriggerLab(fakeClient);
    const song = store.resolvedView.songs[0]!;
    const text = serialize(buildSongClipDoc(song, sourcesOf(store)));
    const songsBefore = store.songs.length;

    const res = store.materializePaste(text, { context: 'song', songDest: 'show', mint: testMint() });

    expect(res.ok).toBe(true);
    expect(store.songs.length).toBe(songsBefore + 1);
    expect(store.activeSongId).toBe('tso-1');
    const pasted = store.songs.find((s) => s.id === 'tso-1')!;
    expect(pasted.sections.map((s) => s.id)).toEqual(song.sections.map((_, i) => `ts-${i + 1}`));
    expect(pasted.sections.map((s) => s.effects)).toEqual(song.sections.map((s) => s.effects));
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
    const before = store.activeSong!.sections.length;

    const res = store.materializePaste('not a clipdoc at all', { context: 'section' });

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.message).toMatch(/didn’t contain|isn’t from/i);
    expect(store.activeSong!.sections.length).toBe(before);
  });

  it('wrong context (an Effect pasted where a song is expected) ⇒ named mismatch', () => {
    const store = new TriggerLab(fakeClient);
    const text = serialize(buildEffectClipDoc(store.activeSection!.effects[0]!, sourcesOf(store)));

    const res = store.materializePaste(text, { context: 'song' });

    expect(res).toEqual({ ok: false, message: 'Clipboard holds a effect, not a song.' });
  });

  it('a retired graph ClipDoc is an unknown kind, never pasted', () => {
    const store = new TriggerLab(fakeClient);
    const graph = JSON.stringify({ app: 'ledrums', v: 2, kind: 'graph', payload: { key: 'g', graph: { nodes: [], edges: [] } }, deps: {}, meta: {} });

    const res = store.materializePaste(graph, { context: 'section' });

    expect(res).toEqual({ ok: false, message: 'That clipboard content can’t be pasted here.' });
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

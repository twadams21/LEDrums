import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import type { WSClient } from '../ws/client';

/* Sections on the store: the ONE active section (U4 merged active + arrange), section CRUD and
   the in-app section clipboard, and hit-resolution off the active section's zone Effects. The
   store seeds one song of three sections, the demo Effects in the first. */

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

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

const kickCentre = (store: TriggerLab) => store.pads.find((p) => p.drumId === 'kick' && p.zone === 0)!;

describe('seed', () => {
  it('seeds one song of three sections, the demo Effects in the first, and activates it', () => {
    const store = new TriggerLab(fakeClient);
    expect(store.activeSong!.sections.map((s) => s.id)).toEqual(['intro', 'verse', 'chorus']);
    expect(store.activeSectionId).toBe('intro');
    expect(store.activeSection?.id).toBe(store.activeSectionId);
    expect(store.activeSection!.effects.length).toBeGreaterThan(0);
  });
});

describe('setActiveSection (merged active+arrange)', () => {
  it('setActiveSection sets the active section id', () => {
    const store = new TriggerLab(fakeClient);
    const id = store.activeSong!.sections[1]!.id;
    store.setActiveSection(id);
    expect(store.activeSectionId).toBe(id);
  });

  it('keeps the selected grid cell across a section change and re-selects its Effect there', () => {
    const store = new TriggerLab(fakeClient);
    const cell = store.activeSection!.effects[0]!.cell;
    store.selectCell(cell);
    store.setActiveSection('verse');
    expect(store.selectedCell).toEqual(cell);
    store.setActiveSection('intro');
    expect(store.selectedCell).toEqual(cell);
    expect(store.selectedEffectId).toBe(store.cellEffects(cell)[0]!.id);
  });

  it('ignores an invalid section activation and keeps the current section', () => {
    const store = new TriggerLab(fakeClient);
    const current = store.activeSectionId;
    store.setActiveSection('missing-section');
    expect(store.activeSectionId).toBe(current);
  });

  it('clears stale song and section selection before any section mutation can use the fallback song', () => {
    const store = new TriggerLab(fakeClient);
    const original = store.songs;
    store.activeSongId = 'missing-song';

    expect(store.activeSongById).toBeNull();
    expect(store.activeSectionId).toBeNull();
    store.addSongSection('Should not exist');

    expect(store.songs).toBe(original);
    expect(store.activeSong).not.toBeNull(); // legacy read/play fallback remains, but is not a mutation target
  });

  it('keeps a canonical reference playable but refuses local section mutation', () => {
    const store = new TriggerLab(fakeClient);
    const libraryId = store.exportSongToLibrary('set-1')!;
    store.importSongReference(libraryId);
    store.setActiveSong(libraryId);
    const reference = store.activeSongById!;
    const firstSection = store.activeSectionId;

    store.addSongSection('Should be detached first');

    expect(store.activeLocalSong).toBeNull();
    expect(store.activeSongById?.id).toBe(libraryId);
    expect(store.activeSongById?.sections).toEqual(reference.sections);
    expect(store.activeSectionId).toBe(firstSection);
  });

  it('reconciles the active section after replacing the active song list', () => {
    const store = new TriggerLab(fakeClient);
    const replacement = store.createSong('Replacement');
    const replacementSection = store.activeSongById!.sections[0]!.id;
    store.songs = [store.songs.find((song) => song.id === replacement)!];

    expect(store.activeSongById?.id).toBe(replacement);
    expect(store.activeSectionId).toBe(replacementSection);
  });

  it('reconciles to the next song when the active local song is removed', () => {
    const store = new TriggerLab(fakeClient);
    const removed = store.createSong('Removed');
    const next = store.songs[0]!.id;
    store.removeSong(removed);

    expect(store.activeSongById?.id).toBe(next);
    expect(store.activeSectionId).toBe(store.activeSongById!.sections[0]!.id);
  });
});

describe('section creation boundary', () => {
  it('does not mint a section or an orphan activeSectionId without an active song', () => {
    const store = new TriggerLab(fakeClient);
    store.activeSectionId = store.activeSong!.sections[0]!.id;
    store.songs = [];
    store.activeSongId = 'missing-song';

    store.addSongSection('Orphan');

    expect(store.activeSong).toBeNull();
    expect(store.songs).toHaveLength(0);
    expect(store.activeSectionId).toBeNull();
  });
});

describe('section mutators', () => {
  it('moveSection reorders sections in the active song', () => {
    const store = new TriggerLab(fakeClient);
    const ids = store.activeSong!.sections.map((s) => s.id);
    store.moveSection(ids[0]!, 2);
    expect(store.activeSong!.sections.map((s) => s.id)).toEqual([ids[1], ids[0], ids[2], ...ids.slice(3)]);
  });

});

describe('copy / paste section (clipboard)', () => {
  it('paste appends an independent clone (fresh id, "<name> copy", same Effects) and activates it', () => {
    const store = new TriggerLab(fakeClient);
    const src = store.activeSong!.sections[0]!;
    const before = store.activeSong!.sections.length;

    store.copySection(src.id);
    expect(store.sectionClipboard).not.toBeNull();
    store.pasteSection();

    const sections = store.activeSong!.sections;
    expect(sections).toHaveLength(before + 1);
    const pasted = sections[sections.length - 1]!;
    expect(pasted.id).not.toBe(src.id); // fresh id
    expect(pasted.name).toBe(`${src.name} copy`);
    expect(pasted.effects).toEqual(src.effects);
    expect(pasted.effects).not.toBe(src.effects);
    expect(pasted.master).toEqual(src.master);
    expect(store.activeSectionId).toBe(pasted.id); // the new section is now active
  });

  it('the pasted section is independent — editing one does not touch the other', () => {
    const store = new TriggerLab(fakeClient);
    const src = store.activeSong!.sections[0]!;
    const effectId = src.effects[0]!.id;
    const name = src.effects[0]!.name;
    store.duplicateSection(src.id); // the copy is now active
    store.renameEffect(effectId, 'Only in the copy');
    expect(store.activeSection!.effects[0]!.name).toBe('Only in the copy');
    expect(store.activeSong!.sections.find((s) => s.id === src.id)!.effects[0]!.name).toBe(name);
  });

  it('the clipboard is a snapshot — editing the source after copy does not change a later paste', () => {
    const store = new TriggerLab(fakeClient);
    const src = store.activeSong!.sections[0]!;
    const effect = src.effects[0]!;
    store.copySection(src.id);
    store.removeEffect(effect.id); // mutate the source AFTER copying
    store.pasteSection();
    expect(store.activeSong!.sections.at(-1)!.effects[0]).toEqual(effect); // paste reflects copy-time content
  });

  it('paste with an empty clipboard is a no-op', () => {
    const store = new TriggerLab(fakeClient);
    const before = store.activeSong!.sections.length;
    expect(store.sectionClipboard).toBeNull();
    store.pasteSection();
    expect(store.activeSong!.sections).toHaveLength(before); // nothing added
  });

  it('copySection ignores an id that is not a section of the active song', () => {
    const store = new TriggerLab(fakeClient);
    store.copySection('no-such-section');
    expect(store.sectionClipboard).toBeNull();
  });

  it('canonical library sections are read-only and failed copies preserve the clipboard', () => {
    const store = new TriggerLab(fakeClient);
    const localSection = store.activeSong!.sections[0]!;
    expect(store.copySection(localSection.id)).toBe(true);
    const previousClipboard = store.sectionClipboard;
    const libraryId = store.exportSongToLibrary(store.activeSongId)!;
    store.importSongReference(libraryId);
    store.setActiveSong(libraryId);
    const canonicalSection = store.activeSong!.sections[0]!;
    const before = { activeSectionId: store.activeSectionId, sectionCount: store.activeSong!.sections.length };

    expect(store.copySection(canonicalSection.id)).toBe(false);
    expect(store.sectionClipboard).toBe(previousClipboard);
    store.addSongSection('Should not exist');
    store.pasteSection();
    store.renameSection(canonicalSection.id, 'Should not rename');
    store.removeSection(canonicalSection.id);
    expect(store.addEffect({ row: 'kick', column: { kind: 'zone', slot: 0 } }, 'solid')).toBeNull();
    expect(store.activeSectionId).toBe(before.activeSectionId);
    expect(store.activeSong!.sections).toHaveLength(before.sectionCount);
    expect(store.activeSong!.sections[0]!.name).toBe(canonicalSection.name);
  });

  it('undoing a section duplicate removes it in one step', () => {
    const store = new TriggerLab(fakeClient);
    const beforeSections = store.activeSong!.sections.map((s) => s.id);
    store.duplicateSection(store.activeSong!.sections[0]!.id);
    expect(store.activeSong!.sections).toHaveLength(beforeSections.length + 1);
    expect(store.undo()).toBe(true);
    expect(store.activeSong!.sections.map((s) => s.id)).toEqual(beforeSections);
  });
});

describe('hit resolution = the active section’s zone Effects on the pad’s drum + slot', () => {
  const KICK_0 = { row: 'kick', column: { kind: 'zone' as const, slot: 0 } };
  const localFires = (store: TriggerLab) => store.monitorEvents.filter((e) => e.type === 'effect');

  it('fires only the matching zone’s Effects (each zone fires its own)', () => {
    const store = new TriggerLab(fakeClient);
    const kick = store.cellEffects(KICK_0)[0]!;
    const snare = store.cellEffects({ row: 'snare', column: { kind: 'zone', slot: 0 } })[0]!;
    store.hit(kickCentre(store));
    expect(store.effectFireAt(kick.id)).toBeGreaterThan(0);
    expect(store.effectFireAt(snare.id)).toBe(0);
    expect(localFires(store)).toHaveLength(1);
    expect(localFires(store)[0]!.label).toBe(kick.name);
  });

  it('fires nothing when the active section has no Effect in the pad’s zone', () => {
    const store = new TriggerLab(fakeClient);
    store.clearCell(KICK_0);
    store.hit(kickCentre(store));
    expect(localFires(store)).toHaveLength(0); // the section gates resolution — no fallback while active
  });

  it('layers two Effects stacked in one cell (both fire on the hit)', () => {
    const store = new TriggerLab(fakeClient);
    const base = store.cellEffects(KICK_0)[0]!;
    const layer = store.addEffect(KICK_0, 'wave', 'radial')!;
    store.hit(kickCentre(store));
    expect(store.effectFireAt(base.id)).toBeGreaterThan(0);
    expect(store.effectFireAt(layer)).toBeGreaterThan(0);
    expect(localFires(store)[0]!.detail?.split(' | ')).toHaveLength(2);
  });

  it('fires nothing when there is NO active section (the graph-era pad fallback is gone)', () => {
    const store = new TriggerLab(fakeClient);
    store.activeSectionId = null;
    store.hit(kickCentre(store));
    expect(localFires(store)).toHaveLength(0);
  });
});

describe('rename / delete section', () => {
  it('renameSection relabels the section (no-op-safe on an unknown id)', () => {
    const store = new TriggerLab(fakeClient);
    const id = store.activeSong!.sections[0]!.id;
    store.renameSection(id, 'Big Chorus');
    expect(store.activeSong!.sections.find((s) => s.id === id)!.name).toBe('Big Chorus');

    const names = store.activeSong!.sections.map((s) => s.name);
    store.renameSection('no-such-section', 'X'); // no-op
    expect(store.activeSong!.sections.map((s) => s.name)).toEqual(names);
  });

  it('removeSection drops the section (no-op-safe on an unknown id)', () => {
    const store = new TriggerLab(fakeClient);
    const before = store.activeSong!.sections.length;
    const id = store.activeSong!.sections[1]!.id; // a non-active section
    store.removeSection(id);
    expect(store.activeSong!.sections.map((s) => s.id)).not.toContain(id);
    expect(store.activeSong!.sections).toHaveLength(before - 1);

    const after = store.activeSong!.sections.length;
    store.removeSection('no-such-section'); // no-op
    expect(store.activeSong!.sections).toHaveLength(after);
  });

  it('deleting the active section re-points activeSectionId to its left neighbour', () => {
    const store = new TriggerLab(fakeClient);
    store.addSongSection('A');
    const a = store.activeSectionId!;
    store.addSongSection('B');
    const b = store.activeSectionId!;
    store.addSongSection('C'); // a, b, c are consecutive at the tail
    store.setActiveSection(b);
    store.removeSection(b);
    expect(store.activeSectionId).toBe(a); // moved one to the left
  });

  it('deleting the active FIRST section re-points to the new first', () => {
    const store = new TriggerLab(fakeClient);
    const first = store.activeSong!.sections[0]!.id;
    const second = store.activeSong!.sections[1]!.id;
    store.setActiveSection(first);
    store.removeSection(first);
    expect(store.activeSectionId).toBe(second); // the new first section
  });

  it('clears activeSectionId once the last section is removed', () => {
    const store = new TriggerLab(fakeClient);
    for (const s of [...store.activeSong!.sections]) store.removeSection(s.id);
    expect(store.activeSong!.sections).toHaveLength(0);
    expect(store.activeSectionId).toBeNull();
  });

  it('persists a rename + delete across a reload (autosave → hydrate)', () => {
    // Drive the real autosave: start() registers the persist $effect; a no-op RAF keeps the
    // render loop from running in node. stop() flushes the serialized authored slice to
    // localStorage synchronously. Constructing a fresh store = a reload (it hydrates).
    const raf = globalThis.requestAnimationFrame;
    const caf = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = (() => 1) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
    try {
      const store = new TriggerLab(fakeClient);
      store.start();
      store.addSongSection('Victim'); // a guaranteed extra section, now active
      const victim = store.activeSectionId!;
      const keep = store.activeSong!.sections[0]!.id;
      store.renameSection(keep, 'Persisted');
      store.removeSection(victim);
      store.stop(); // flush authored → localStorage

      const reloaded = new TriggerLab(fakeClient);
      expect(reloaded.activeSong!.sections.find((s) => s.id === keep)!.name).toBe('Persisted');
      expect(reloaded.activeSong!.sections.map((s) => s.id)).not.toContain(victim);
    } finally {
      globalThis.requestAnimationFrame = raf;
      globalThis.cancelAnimationFrame = caf;
    }
  });
});

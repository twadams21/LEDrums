import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import type { WSClient } from '../ws/client';

/* Show document model on the store: shows/activeShow + newShow / openShow / saveShow /
   saveShowAs / renameShow / deleteShow / closeShow. The store boots one show (a fresh
   "Untitled Show" when storage is empty); switching FULLY swaps the authored runes so no
   field bleeds between shows, deleteShow never leaves zero shows, and the library survives a
   reload (driven by the real autosave, mirroring store.persistence.test.ts). The pure
   library serialize/deserialize + migration contract is covered in persistence.test.ts.

   LIBRARY EXCEPTION (S41): "no cross-show bleed" governs a show's OWN authored content — a graph
   or bpm edit in show A never reaches show B. The Song Library is the ONE deliberate shared
   channel: a show REFERENCES a canonical library song (it holds a ref, not a copy), so editing
   that library song is meant to reach every referencing show's resolved view. That shared, opt-in
   propagation — and the detach that severs it — is exercised in store.song-library.test.ts, not
   here; local authored content still never bleeds (asserted below). */

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

/** Drive the real autosave: start() registers the persist $effect; a no-op RAF keeps the
    render loop from running in node; stop() flushes the library to localStorage synchronously. */
function withRaf(fn: () => void): void {
  const raf = globalThis.requestAnimationFrame;
  const caf = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (() => 1) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
  try {
    fn();
  } finally {
    globalThis.requestAnimationFrame = raf;
    globalThis.cancelAnimationFrame = caf;
  }
}

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe('boot', () => {
  it('starts with a single active "Untitled Show" when storage is empty', () => {
    const store = new TriggerLab(fakeClient);
    expect(store.shows).toHaveLength(1);
    expect(store.activeShow!.id).toBe(store.activeShowId);
    expect(store.activeShow!.name).toBe('Untitled Show');
  });
});

describe('newShow', () => {
  it('creates a blank, active show and preserves the previous one in the library', () => {
    const store = new TriggerLab(fakeClient);
    const first = store.activeShowId;
    const gA = store.createGraph('Graph A'); // edit the first show
    store.bpm = 140;

    const second = store.newShow('Show 2');
    expect(second).not.toBe(first);
    expect(store.activeShowId).toBe(second);
    expect(store.shows).toHaveLength(2);
    expect(store.activeShow!.name).toBe('Show 2');
    // the new show is blank — the first show's graph + bpm edit are gone from the live runes
    expect(store.graphs[gA]).toBeUndefined();
    expect(store.graphNames[gA]).toBeUndefined();
    expect(store.bpm).toBe(120);
  });

  it('auto-names blank shows "Untitled Show [N]" when no name is given', () => {
    const store = new TriggerLab(fakeClient); // boot show = "Untitled Show"
    const a = store.newShow();
    const b = store.newShow();
    expect(store.shows.find((s) => s.id === a)!.name).toBe('Untitled Show 2');
    expect(store.shows.find((s) => s.id === b)!.name).toBe('Untitled Show 3');
  });
});

describe('openShow', () => {
  it('swaps the authored content; each show retains its own edits (no cross-show bleed)', () => {
    const store = new TriggerLab(fakeClient);
    const showA = store.activeShowId;
    const gA = store.createGraph('Graph A'); // edit A
    store.bpm = 100;

    const showB = store.newShow(); // blank B, active
    const gB = store.createGraph('Graph B'); // edit B
    store.bpm = 90;

    store.openShow(showA); // back to A
    expect(store.activeShowId).toBe(showA);
    expect(store.graphs[gA]).toBeTruthy();
    expect(store.graphNames[gA]).toBe('Graph A');
    expect(store.bpm).toBe(100);
    expect(store.graphs[gB]).toBeUndefined(); // B's edits do not bleed into A

    store.openShow(showB); // back to B
    expect(store.graphs[gB]).toBeTruthy();
    expect(store.graphNames[gB]).toBe('Graph B');
    expect(store.bpm).toBe(90);
    expect(store.graphs[gA]).toBeUndefined(); // A's edits do not bleed into B
  });

  it('local authored content never bleeds, but a library-song reference is the shared channel (S41)', () => {
    const store = new TriggerLab(fakeClient);
    const showA = store.activeShowId;
    const gA = store.createGraph('Local A'); // A's OWN content — must never reach B

    // A references a canonical library song; B references the SAME song
    const libId = store.exportSongToLibrary('set-1')!;
    store.importSongReference(libId);
    store.newShow(); // show B
    store.importSongReference(libId);

    // B does NOT see A's local graph — own-content isolation still holds
    expect(store.graphs[gA]).toBeUndefined();
    // but B DOES resolve the shared library song (the deliberate exception)
    expect(store.resolvedSongs.some((s) => s.id === libId)).toBe(true);

    // editing the one library copy reaches BOTH shows' resolved views
    store.renameLibrarySong(libId, 'Shared Edit');
    expect(store.resolvedSongs.find((s) => s.id === libId)!.name).toBe('Shared Edit');
    store.openShow(showA);
    expect(store.resolvedSongs.find((s) => s.id === libId)!.name).toBe('Shared Edit');
    expect(store.graphs[gA]).toBeTruthy(); // A still has its own local graph back
    expect(store.activeShowId).toBe(showA);
  });

  it('is a no-op for an unknown id or the already-active show (no reset of the runes)', () => {
    const store = new TriggerLab(fakeClient);
    const a = store.activeShowId;
    store.bpm = 111;
    store.openShow('nope'); // unknown
    store.openShow(a); // already active → must NOT reset the live runes
    expect(store.activeShowId).toBe(a);
    expect(store.bpm).toBe(111);
  });
});

describe('saveShowAs', () => {
  it('clones the current authored under a new id + name, switches, and leaves the source intact', () => {
    const store = new TriggerLab(fakeClient);
    const src = store.activeShowId;
    const g = store.createGraph('Shared');
    store.bpm = 132;

    const clone = store.saveShowAs('Clone');
    expect(clone).not.toBe(src);
    expect(store.activeShowId).toBe(clone);
    expect(store.activeShow!.name).toBe('Clone');
    expect(store.graphs[g]).toBeTruthy(); // clone has the source's content at fork time
    expect(store.bpm).toBe(132);

    store.bpm = 80; // edit the clone
    store.openShow(src);
    expect(store.bpm).toBe(132); // source unchanged by the clone's edit
    expect(store.graphs[g]).toBeTruthy();
  });
});

describe('renameShow', () => {
  it('renames a show; a blank name or unknown id is a no-op', () => {
    const store = new TriggerLab(fakeClient);
    const a = store.activeShowId;
    store.renameShow(a, 'My Show');
    expect(store.activeShow!.name).toBe('My Show');
    store.renameShow(a, '   '); // blank → keep
    store.renameShow('nope', 'X'); // unknown → no-op
    expect(store.activeShow!.name).toBe('My Show');
    expect(store.shows).toHaveLength(1);
  });
});

describe('deleteShow', () => {
  it('drops the show; deleting the ACTIVE show re-points to the left neighbour and swaps its content', () => {
    const store = new TriggerLab(fakeClient);
    const a = store.activeShowId;
    store.bpm = 100; // A marker
    const b = store.newShow();
    store.bpm = 90; // B marker
    const c = store.newShow(); // [A, B, C]
    store.bpm = 80; // C marker
    store.openShow(b); // active = B (the middle show)

    store.deleteShow(b);
    expect(store.shows.map((s) => s.id)).toEqual([a, c]);
    expect(store.activeShowId).toBe(a); // left neighbour of B
    expect(store.bpm).toBe(100); // A's content swapped into the runes
  });

  it('deleting a NON-active show leaves the active show + its live runes alone', () => {
    const store = new TriggerLab(fakeClient);
    const a = store.activeShowId;
    const b = store.newShow(); // active = B
    store.bpm = 77;
    store.deleteShow(a); // remove the non-active show
    expect(store.shows.map((s) => s.id)).toEqual([b]);
    expect(store.activeShowId).toBe(b);
    expect(store.bpm).toBe(77); // runes untouched
  });

  it('never leaves zero shows — deleting the last one seeds a fresh active Untitled', () => {
    const store = new TriggerLab(fakeClient);
    const only = store.activeShowId;
    store.bpm = 55;
    store.deleteShow(only);
    expect(store.shows).toHaveLength(1);
    expect(store.activeShowId).not.toBe(only);
    expect(store.activeShow!.name).toBe('Untitled Show');
    expect(store.bpm).toBe(120); // fresh seed content
  });

  it('is a no-op for an unknown id', () => {
    const store = new TriggerLab(fakeClient);
    const before = store.shows.map((s) => s.id);
    store.deleteShow('nope');
    expect(store.shows.map((s) => s.id)).toEqual(before);
  });
});

describe('closeShow', () => {
  it('switches to a fresh blank Untitled show; the closed show stays in the library + reopenable', () => {
    const store = new TriggerLab(fakeClient);
    const a = store.activeShowId;
    const g = store.createGraph('keep me');

    store.closeShow();
    expect(store.activeShowId).not.toBe(a);
    expect(store.activeShow!.name).toBe('Untitled Show 2'); // boot was "Untitled Show"
    expect(store.graphs[g]).toBeUndefined(); // fresh blank runes

    expect(store.shows.some((s) => s.id === a)).toBe(true); // closed show preserved
    store.openShow(a);
    expect(store.graphs[g]).toBeTruthy(); // its edits come back
  });
});

describe('persistence (autosave → reload)', () => {
  it('persists every show + the active pointer + each show’s own content across a reload', () => {
    withRaf(() => {
      const store = new TriggerLab(fakeClient);
      store.start();
      const a = store.activeShowId;
      store.renameShow(a, 'First');
      store.bpm = 101;
      const b = store.newShow('Second');
      store.bpm = 99;
      store.openShow(a); // active = First
      store.stop(); // flush library → localStorage

      const reloaded = new TriggerLab(fakeClient);
      expect(reloaded.shows.map((s) => s.name).sort()).toEqual(['First', 'Second']);
      expect(reloaded.activeShowId).toBe(a);
      expect(reloaded.activeShow!.name).toBe('First');
      expect(reloaded.bpm).toBe(101);
      reloaded.openShow(b);
      expect(reloaded.bpm).toBe(99); // the inactive show kept its own content
    });
  });
});

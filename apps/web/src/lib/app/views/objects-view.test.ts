import { describe, expect, it } from 'vitest';
import {
  OBJECT_TYPE_IDS,
  canvasSceneRows,
  librarySongRows,
  showSongRows,
  songSubline,
} from './objects-view';
import type { Song } from '../setlist';

/* Pure view-models behind the Objects view: the joins, the sort order and the Song Library
   delete-gating (`deletable`, which the menu trusts to disable Delete in lockstep with the store)
   are verified here in isolation. */

describe('OBJECT_TYPE_IDS', () => {
  it('is the rail order — Songs · Song Library · Canvas Scenes (no graph-era Effects / Graphs / Presets)', () => {
    expect(OBJECT_TYPE_IDS).toEqual(['songs', 'library', 'canvas-scenes']);
  });
});

describe('songSubline', () => {
  it('counts sections, and Effects only when there are any', () => {
    expect(songSubline(1, 0)).toBe('1 section');
    expect(songSubline(3, 0)).toBe('3 sections');
    expect(songSubline(3, 1)).toBe('3 sections · 1 effect');
    expect(songSubline(2, 12)).toBe('2 sections · 12 effects');
  });
});

describe('canvasSceneRows', () => {
  const scene = (id: string, name: string, elements = 1, lenses = 0) => ({
    id,
    name,
    tags: ['canvas'],
    sampler: { kind: 'cylinder' as const },
    lenses: Array.from({ length: lenses }, () => ({ kind: 'polar' as const })),
    elements: Array.from({ length: elements }, () => ({
      kind: 'stripes' as const,
      angleDeg: 0,
      widthU: 0.2,
      duty: 0.5,
      speedUps: 0.2,
      hue: 140,
      sat: 1,
      softness: 0.08,
    })),
  });

  it('summarizes element/lens counts + sampler and sorts by name', () => {
    const rows = canvasSceneRows([scene('s2', 'Beta', 3, 1), scene('s1', 'Alpha', 2, 0)]);
    expect(rows.map((r) => r.name)).toEqual(['Alpha', 'Beta']);
    expect(rows[0]).toMatchObject({ id: 's1', elementCount: 2, lensCount: 0, sampler: 'cylinder' });
    expect(rows[1]).toMatchObject({ id: 's2', elementCount: 3, lensCount: 1 });
  });
});

function song(id: string, name: string, sectionCount = 1): Song {
  return {
    id,
    name,
    sections: Array.from({ length: sectionCount }, (_, i) => ({
      id: `${id}-s${i}`,
      name: `Section ${i}`,
      effects: [],
      master: [],
    })),
  };
}

describe('showSongRows', () => {
  it('marks local songs and library references by origin, in resolved order', () => {
    const local = [song('song-1', 'Opener'), song('song-2', 'Bridge')];
    // resolveSongRefs returns [...local, ...referenced]; the tail is a library ref.
    const resolved = [...local, song('song-9', 'Anthem (lib)', 3)];
    const rows = showSongRows(local, resolved);
    expect(rows.map((r) => r.origin)).toEqual(['local', 'local', 'reference']);
    expect(rows.map((r) => r.name)).toEqual(['Opener', 'Bridge', 'Anthem (lib)']);
    expect(rows.find((r) => r.id === 'song-9')!.sectionCount).toBe(3);
  });

  it('totals each song’s Effects across its sections', () => {
    const withEffects = {
      ...song('song-1', 'Opener', 2),
      sections: [
        { id: 'a', name: 'A', master: [], effects: [{ id: 'e1' }, { id: 'e2' }] },
        { id: 'b', name: 'B', master: [], effects: [{ id: 'e3' }] },
      ],
    } as unknown as Song;
    const rows = showSongRows([withEffects, song('song-2', 'Bridge')], [withEffects, song('song-2', 'Bridge')]);
    expect(rows.map((r) => r.effectCount)).toEqual([3, 0]);
  });

  it('is all-local when the show references nothing', () => {
    const local = [song('song-1', 'Only')];
    const rows = showSongRows(local, local);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.origin).toBe('local');
  });
});

describe('librarySongRows', () => {
  const list = [
    { id: 'song-1', name: 'Shared', usedBy: [{ id: 'show-a', name: 'Show A' }, { id: 'show-b', name: 'Show B' }] },
    { id: 'song-2', name: 'Orphan', usedBy: [] as { id: string; name: string }[] },
  ];

  it('carries the used-by count/names and gates delete like the store', () => {
    const rows = librarySongRows(list, []);
    const shared = rows.find((r) => r.id === 'song-1')!;
    expect(shared.usedByCount).toBe(2);
    expect(shared.usedByNames).toEqual(['Show A', 'Show B']);
    expect(shared.deletable).toBe(false); // referenced → delete blocked
    const orphan = rows.find((r) => r.id === 'song-2')!;
    expect(orphan.usedByCount).toBe(0);
    expect(orphan.deletable).toBe(true);
  });

  it('flags rows the active show already references (Import → Detach)', () => {
    const rows = librarySongRows(list, ['song-1']);
    expect(rows.find((r) => r.id === 'song-1')!.inThisShow).toBe(true);
    expect(rows.find((r) => r.id === 'song-2')!.inThisShow).toBe(false);
  });
});

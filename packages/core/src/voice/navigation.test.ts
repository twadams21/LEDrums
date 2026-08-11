import { describe, expect, it } from 'vitest';
import { relativeNavTarget } from './navigation';
import { emptyShow, type Show, type ShowSong } from './types';

function song(id: string, sectionIds: string[]): ShowSong {
  return { id, name: id, sections: sectionIds.map((sid) => ({ id: sid, name: sid, slots: {} })) };
}

/** Two songs: A with three sections, B with two. */
function showFixture(): Show {
  return { ...emptyShow(), songs: [song('A', ['a1', 'a2', 'a3']), song('B', ['b1', 'b2'])] };
}

describe('relativeNavTarget — section axis', () => {
  const show = showFixture();

  it('advances within the active song', () => {
    expect(relativeNavTarget(show, { activeSongId: 'A', activeSectionId: 'a1' }, 'section', 1)).toEqual({
      songId: 'A',
      sectionId: 'a2',
    });
  });

  it('goes back within the active song', () => {
    expect(relativeNavTarget(show, { activeSongId: 'A', activeSectionId: 'a3' }, 'section', -1)).toEqual({
      songId: 'A',
      sectionId: 'a2',
    });
  });

  it('CLAMPS at the last section — no wrap, and reports a no-op', () => {
    expect(relativeNavTarget(show, { activeSongId: 'A', activeSectionId: 'a3' }, 'section', 1)).toBeNull();
  });

  it('CLAMPS at the first section — no wrap', () => {
    expect(relativeNavTarget(show, { activeSongId: 'A', activeSectionId: 'a1' }, 'section', -1)).toBeNull();
  });

  it('never spills into the next song at the end of one', () => {
    const target = relativeNavTarget(show, { activeSongId: 'A', activeSectionId: 'a3' }, 'section', 1);
    expect(target).toBeNull(); // NOT { songId: 'B', ... }
  });

  it('starts from the first section when nothing is active yet', () => {
    expect(relativeNavTarget(show, { activeSongId: null, activeSectionId: null }, 'section', 1)).toEqual({
      songId: 'A',
      sectionId: 'a2',
    });
  });

  it('treats an unknown active section as index 0', () => {
    expect(relativeNavTarget(show, { activeSongId: 'A', activeSectionId: 'gone' }, 'section', 1)).toEqual({
      songId: 'A',
      sectionId: 'a2',
    });
  });

  it('is a no-op for a song with no sections', () => {
    const empty: Show = { ...emptyShow(), songs: [song('A', [])] };
    expect(relativeNavTarget(empty, { activeSongId: 'A', activeSectionId: null }, 'section', 1)).toBeNull();
  });
});

describe('relativeNavTarget — song axis', () => {
  const show = showFixture();

  it('advances a song and lands on its FIRST section', () => {
    expect(relativeNavTarget(show, { activeSongId: 'A', activeSectionId: 'a3' }, 'song', 1)).toEqual({
      songId: 'B',
      sectionId: 'b1',
    });
  });

  it('goes back a song and lands on its first section', () => {
    expect(relativeNavTarget(show, { activeSongId: 'B', activeSectionId: 'b2' }, 'song', -1)).toEqual({
      songId: 'A',
      sectionId: 'a1',
    });
  });

  it('CLAMPS at the last song — no wrap to song 1 mid-set', () => {
    expect(relativeNavTarget(show, { activeSongId: 'B', activeSectionId: 'b1' }, 'song', 1)).toBeNull();
  });

  it('CLAMPS at the first song', () => {
    expect(relativeNavTarget(show, { activeSongId: 'A', activeSectionId: 'a1' }, 'song', -1)).toBeNull();
  });

  it('is null when the target song has no sections', () => {
    const show2: Show = { ...emptyShow(), songs: [song('A', ['a1']), song('B', [])] };
    expect(relativeNavTarget(show2, { activeSongId: 'A', activeSectionId: 'a1' }, 'song', 1)).toBeNull();
  });
});

describe('relativeNavTarget — degenerate setlists', () => {
  it('is null with no show', () => {
    expect(relativeNavTarget(null, { activeSongId: null, activeSectionId: null }, 'song', 1)).toBeNull();
    expect(relativeNavTarget(undefined, { activeSongId: null, activeSectionId: null }, 'section', 1)).toBeNull();
  });

  it('is null with no songs', () => {
    expect(relativeNavTarget(emptyShow(), { activeSongId: null, activeSectionId: null }, 'section', 1)).toBeNull();
  });

  it('is a no-op for a single-song, single-section set on every direction', () => {
    const one: Show = { ...emptyShow(), songs: [song('A', ['a1'])] };
    const at = { activeSongId: 'A', activeSectionId: 'a1' };
    expect(relativeNavTarget(one, at, 'song', 1)).toBeNull();
    expect(relativeNavTarget(one, at, 'song', -1)).toBeNull();
    expect(relativeNavTarget(one, at, 'section', 1)).toBeNull();
    expect(relativeNavTarget(one, at, 'section', -1)).toBeNull();
  });
});

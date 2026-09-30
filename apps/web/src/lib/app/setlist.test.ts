import { describe, expect, it } from 'vitest';
import { effectChain } from '@ledrums/core';
import {
  addSection,
  cloneSection,
  makeSection,
  makeSong,
  moveSection,
  removeSection,
  renameSection,
  sanitizeUniqueSectionIds,
  type SetlistSection,
  type Song,
} from './setlist';

function song(): Song {
  return {
    id: 'song1',
    name: 'Set 1',
    sections: [makeSection('intro', 'Intro'), makeSection('verse', 'Verse')],
  };
}

const kickCell: effectChain.EffectCell = { row: 'kick', column: { kind: 'zone', slot: 0 } };

/** A section holding one Effect and one Master modifier, with timing. */
function busySection(): SetlistSection {
  return {
    id: 'verse',
    name: 'Verse',
    effects: [effectChain.parseEffect({ id: 'e1', name: 'Pulse', cell: kickCell, generator: { kind: 'solid' } })],
    master: [{ uid: 'm1', modifierId: 'strobe', params: {}, mix: 1, bypass: false }],
    bars: 16,
    bpm: 128,
  };
}

describe('makeSection', () => {
  it('starts with an empty Effect stack and Master chain', () => {
    expect(makeSection('a', 'A')).toEqual({ id: 'a', name: 'A', effects: [], master: [] });
  });
});

describe('makeSong', () => {
  it('wraps id + name with one empty section by default', () => {
    const s = makeSong('song-1', 'My Song');
    expect(s.id).toBe('song-1');
    expect(s.name).toBe('My Song');
    expect(s.sections).toEqual([makeSection('song-1-s1', 'Section 1')]);
  });
  it('derives the default section id from the song id (pure + collision-free)', () => {
    expect(makeSong('song-9', 'X').sections[0]!.id).toBe('song-9-s1');
  });
  it('wraps an explicit sections list as-is', () => {
    const secs = [makeSection('a', 'A'), makeSection('b', 'B')];
    const s = makeSong('song-2', 'Two', secs);
    expect(s.sections).toBe(secs);
    expect(s.sections.map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('sanitizeUniqueSectionIds', () => {
  it('keeps the first section with an id and drops later duplicates and id-less ones', () => {
    const songs: Song[] = [
      { id: 's1', name: 'One', sections: [makeSection('a', 'A'), makeSection('', 'Blank')] },
      { id: 's2', name: 'Two', sections: [makeSection('a', 'Again'), makeSection('b', 'B')] },
    ];
    expect(sanitizeUniqueSectionIds(songs).map((s) => s.sections.map((x) => x.id))).toEqual([['a'], ['b']]);
  });
});

describe('section ops', () => {
  it('addSection appends; renameSection relabels', () => {
    let s = addSection(song(), makeSection('chorus', 'Chorus'));
    expect(s.sections.map((x) => x.id)).toEqual(['intro', 'verse', 'chorus']);
    s = renameSection(s, 'chorus', 'Big Chorus');
    expect(s.sections.find((x) => x.id === 'chorus')!.name).toBe('Big Chorus');
  });

  it('renameSection keeps the Effect stack', () => {
    const s = renameSection({ id: 'song1', name: 'Set 1', sections: [busySection()] }, 'verse', 'Big Verse');
    expect(s.sections[0]!.effects.map((e) => e.id)).toEqual(['e1']);
    expect(s.sections[0]!.bars).toBe(16);
  });
});

describe('moveSection (drag reorder)', () => {
  it('moves a section before the live-list drop target without mutating the input', () => {
    const a = addSection(song(), makeSection('chorus', 'Chorus'));
    const b = moveSection(a, 'intro', 2);
    expect(b.sections.map((x) => x.id)).toEqual(['verse', 'intro', 'chorus']);
    expect(a.sections.map((x) => x.id)).toEqual(['intro', 'verse', 'chorus']);
  });

  it('treats dropping onto the next row as a no-op instead of swapping downward', () => {
    const a = addSection(song(), makeSection('chorus', 'Chorus'));
    expect(moveSection(a, 'intro', 1)).toBe(a);
  });

  it('clamps drop positions and no-ops for unknown sections', () => {
    const a = addSection(song(), makeSection('chorus', 'Chorus'));
    expect(moveSection(a, 'chorus', -10).sections.map((x) => x.id)).toEqual(['chorus', 'intro', 'verse']);
    expect(moveSection(a, 'missing', 0)).toBe(a);
  });
});

describe('removeSection (immutable)', () => {
  it('drops the named section, preserving the order of the rest', () => {
    let s = addSection(song(), makeSection('chorus', 'Chorus')); // intro, verse, chorus
    const before = s;
    s = removeSection(s, 'verse');
    expect(s.sections.map((x) => x.id)).toEqual(['intro', 'chorus']);
    expect(before.sections.map((x) => x.id)).toEqual(['intro', 'verse', 'chorus']); // original untouched
    expect(s).not.toBe(before);
  });

  it('is a no-op (same Song ref) when the section id is absent', () => {
    const s = song();
    expect(removeSection(s, 'nope')).toBe(s);
  });

  it('can empty the song down to zero sections', () => {
    let s = song(); // intro, verse
    s = removeSection(s, 'intro');
    s = removeSection(s, 'verse');
    expect(s.sections).toEqual([]);
  });
});

describe('cloneSection (copy / paste)', () => {
  it('copies the Effect stack, Master chain and timing under a fresh id; name defaults to "<name> copy"', () => {
    const copy = cloneSection(busySection(), 'verse-2');
    expect(copy).toEqual({ ...busySection(), id: 'verse-2', name: 'Verse copy' });
  });

  it('honours an explicit new name', () => {
    expect(cloneSection(busySection(), 'verse-2', 'Chorus').name).toBe('Chorus');
  });

  it('deep-copies — editing the copy does not touch the original', () => {
    const original = busySection();
    const copy = cloneSection(original, 'verse-2');
    copy.effects[0]!.name = 'Changed';
    copy.master.push({ uid: 'm2', modifierId: 'strobe', params: {}, mix: 1, bypass: false });
    expect(original.effects[0]!.name).toBe('Pulse');
    expect(original.master).toHaveLength(1);
  });
});

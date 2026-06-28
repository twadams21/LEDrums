import { describe, expect, it } from 'vitest';
import {
  addGraph,
  addSection,
  cloneSection,
  graphUsageCount,
  isReused,
  makeSection,
  makeSong,
  referencedGraphs,
  removeGraph,
  removeSection,
  renameSection,
  setGraphs,
  type Song,
} from './setlist';

// A section is a FLAT ORDERED LIST of graph KEYS (U4). The graph reference is just a
// store-graphs key (here named "g*"); pad graphs happen to be keyed by padKey "drumId:zone"
// but the setlist model doesn't care — any key string is a reference.

function song(): Song {
  return {
    id: 'song1',
    name: 'Set 1',
    sections: [makeSection('intro', 'Intro'), makeSection('verse', 'Verse')],
  };
}

describe('makeSection', () => {
  it('starts empty by default', () => {
    expect(makeSection('a', 'A').graphs).toEqual([]);
  });
  it('seeds + de-duplicates an initial ordered graph list', () => {
    expect(makeSection('a', 'A', ['g1', 'g2', 'g1', 'g3']).graphs).toEqual(['g1', 'g2', 'g3']);
  });
});

describe('makeSong', () => {
  it('wraps id + name with one empty section by default', () => {
    const s = makeSong('song-1', 'My Song');
    expect(s.id).toBe('song-1');
    expect(s.name).toBe('My Song');
    expect(s.sections).toHaveLength(1);
    expect(s.sections[0]!.graphs).toEqual([]);
  });
  it('derives the default section id from the song id (pure + collision-free)', () => {
    expect(makeSong('song-9', 'X').sections[0]!.id).toBe('song-9-s1');
  });
  it('wraps an explicit sections list as-is', () => {
    const secs = [makeSection('a', 'A', ['g1']), makeSection('b', 'B')];
    const s = makeSong('song-2', 'Two', secs);
    expect(s.sections).toBe(secs);
    expect(s.sections.map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('addGraph (immutable, idempotent)', () => {
  it('appends a graph reference without mutating the input', () => {
    const a = song();
    const b = addGraph(a, 'intro', 'gSnare');
    expect(b.sections[0]!.graphs).toEqual(['gSnare']);
    expect(a.sections[0]!.graphs).toEqual([]); // original untouched
    expect(b).not.toBe(a);
  });

  it('appends in order; layering = two graphs in one section', () => {
    let s = addGraph(song(), 'verse', 'gBase');
    s = addGraph(s, 'verse', 'gLayer');
    expect(s.sections[1]!.graphs).toEqual(['gBase', 'gLayer']);
  });

  it('is idempotent — adding a key already present is a no-op (same Song ref)', () => {
    const a = addGraph(song(), 'intro', 'gSnare');
    const b = addGraph(a, 'intro', 'gSnare');
    expect(b).toBe(a); // unchanged ref
    expect(b.sections[0]!.graphs).toEqual(['gSnare']);
  });
});

describe('removeGraph', () => {
  it('removes a graph reference (no-op if absent)', () => {
    let s = addGraph(song(), 'verse', 'gKick');
    s = addGraph(s, 'verse', 'gSnare');
    s = removeGraph(s, 'verse', 'gKick');
    expect(s.sections[1]!.graphs).toEqual(['gSnare']);
    expect(removeGraph(s, 'verse', 'absent')).toBe(s); // no-op keeps the ref
  });
});

describe('setGraphs (reorder / replace)', () => {
  it('replaces the whole list, de-duplicated, order preserved', () => {
    const s = setGraphs(song(), 'intro', ['g3', 'g1', 'g3', 'g2']);
    expect(s.sections[0]!.graphs).toEqual(['g3', 'g1', 'g2']);
  });
});

describe('reuse-by-reference', () => {
  it('the same graph key can appear in multiple sections (reuse, not copy)', () => {
    let s = addGraph(song(), 'intro', 'gSnare');
    s = addGraph(s, 'verse', 'gSnare'); // SAME graph reused in Verse
    expect(graphUsageCount(s, 'gSnare')).toBe(2);
    expect(isReused(s, 'gSnare')).toBe(true);
    expect(referencedGraphs(s)).toEqual(['gSnare']);
  });

  it('a single placement is not "reused"', () => {
    const s = addGraph(song(), 'intro', 'gKick');
    expect(isReused(s, 'gKick')).toBe(false);
    expect(graphUsageCount(s, 'gKick')).toBe(1);
  });

  it('referencedGraphs lists every distinct key in first-appearance order', () => {
    let s = addGraph(song(), 'intro', 'gA');
    s = addGraph(s, 'intro', 'gB');
    s = addGraph(s, 'verse', 'gB'); // reused
    s = addGraph(s, 'verse', 'gC');
    expect(referencedGraphs(s)).toEqual(['gA', 'gB', 'gC']);
  });
});

describe('section ops', () => {
  it('addSection appends; renameSection relabels', () => {
    let s = addSection(song(), makeSection('chorus', 'Chorus'));
    expect(s.sections.map((x) => x.id)).toEqual(['intro', 'verse', 'chorus']);
    s = renameSection(s, 'chorus', 'Big Chorus');
    expect(s.sections.find((x) => x.id === 'chorus')!.name).toBe('Big Chorus');
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
  const verse = (): ReturnType<typeof makeSection> => makeSection('verse', 'Verse', ['gKick', 'gSnare']);

  it('copies the graph list under a fresh id; name defaults to "<name> copy"', () => {
    const copy = cloneSection(verse(), 'verse-2');
    expect(copy.id).toBe('verse-2');
    expect(copy.name).toBe('Verse copy');
    expect(copy.graphs).toEqual(['gKick', 'gSnare']); // same references (reuse), copied list
  });

  it('honours an explicit new name', () => {
    expect(cloneSection(verse(), 'verse-2', 'Chorus').name).toBe('Chorus');
  });

  it('deep-copies the list — mutating the copy does not touch the original', () => {
    const original = verse();
    const copy = cloneSection(original, 'verse-2');
    expect(copy.graphs).not.toBe(original.graphs); // a distinct array, not an alias
    copy.graphs.push('gTom');
    expect(original.graphs).toEqual(['gKick', 'gSnare']); // original list unchanged
  });
});

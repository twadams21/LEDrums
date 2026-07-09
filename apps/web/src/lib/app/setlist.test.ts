import { describe, expect, it } from 'vitest';
import {
  addGraph,
  addSection,
  cloneSection,
  graphUsageCount,
  isReused,
  makeSection,
  makeSong,
  moveGraphPlacement,
  moveSection,
  referencedGraphs,
  removeGraph,
  removeSection,
  renameSection,
  setGraphs,
  setLook,
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
  it('starts with an empty looks map by default', () => {
    expect(makeSection('a', 'A').looks).toEqual({});
  });
  it('copies a seeded looks map (the section owns it, not the caller)', () => {
    const src = { base: 'drift', trigger: null };
    const s = makeSection('a', 'A', [], src);
    expect(s.looks).toEqual({ base: 'drift', trigger: null });
    expect(s.looks).not.toBe(src); // a distinct object, not an alias
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

describe('moveGraphPlacement (drag reorder / move)', () => {
  const arranged = (): Song => ({
    id: 'song1',
    name: 'Set 1',
    sections: [makeSection('intro', 'Intro', ['gA', 'gB', 'gC']), makeSection('verse', 'Verse', ['gD'])],
  });

  it('reorders a graph before the live-list drop target within one section', () => {
    const s = moveGraphPlacement(arranged(), 'intro', 'gA', 'intro', 2);
    expect(s.sections[0]!.graphs).toEqual(['gB', 'gA', 'gC']);
  });

  it('treats dropping a graph onto the next row as a no-op instead of swapping downward', () => {
    const s = arranged();
    expect(moveGraphPlacement(s, 'intro', 'gA', 'intro', 1)).toBe(s);
  });

  it('moves a graph between sections at the requested index', () => {
    const s = moveGraphPlacement(arranged(), 'intro', 'gB', 'verse', 0);
    expect(s.sections[0]!.graphs).toEqual(['gA', 'gC']);
    expect(s.sections[1]!.graphs).toEqual(['gB', 'gD']);
  });

  it('dedupes the target section when it already contains that graph key', () => {
    const s = moveGraphPlacement(
      { id: 'song1', name: 'Set 1', sections: [makeSection('a', 'A', ['g1']), makeSection('b', 'B', ['g2', 'g1'])] },
      'a',
      'g1',
      'b',
      1,
    );
    expect(s.sections[0]!.graphs).toEqual([]);
    expect(s.sections[1]!.graphs).toEqual(['g2', 'g1']);
  });

  it('no-ops when the source placement is missing', () => {
    const s = arranged();
    expect(moveGraphPlacement(s, 'intro', 'missing', 'verse', 0)).toBe(s);
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

  it('deep-copies the looks map — editing the copy does not touch the original', () => {
    const original = makeSection('verse', 'Verse', [], { base: 'drift' });
    const copy = cloneSection(original, 'verse-2');
    expect(copy.looks).toEqual({ base: 'drift' });
    expect(copy.looks).not.toBe(original.looks); // a distinct object, not an alias
    copy.looks.base = 'swirl';
    expect(original.looks).toEqual({ base: 'drift' }); // original map unchanged
  });
});

describe('setLook (immutable, idempotent)', () => {
  const withLooks = (): Song => ({
    id: 'song1',
    name: 'Set 1',
    sections: [makeSection('intro', 'Intro', [], { base: 'drift' }), makeSection('verse', 'Verse')],
  });

  it('sets an effect on a bus without mutating the input', () => {
    const a = withLooks();
    const b = setLook(a, 'verse', 'base', 'aurora');
    expect(b.sections[1]!.looks).toEqual({ base: 'aurora' });
    expect(a.sections[1]!.looks).toEqual({}); // original untouched
    expect(b).not.toBe(a);
  });

  it('overrides an existing look and clears one to null (None), preserving other buses', () => {
    let s = setLook(withLooks(), 'intro', 'effect', 'haze'); // add a second bus
    s = setLook(s, 'intro', 'base', null); // clear the seeded base look → None
    expect(s.sections[0]!.looks).toEqual({ base: null, effect: 'haze' });
  });

  it('is idempotent — re-setting the current value is a no-op (same Song ref)', () => {
    const a = setLook(withLooks(), 'intro', 'base', 'aurora');
    expect(setLook(a, 'intro', 'base', 'aurora')).toBe(a); // unchanged ref
  });

  it('treats an absent bus key as None — setting null on it is a no-op', () => {
    const a = withLooks();
    expect(setLook(a, 'verse', 'effect', null)).toBe(a); // verse has no `effect` look; None → no-op
  });

  it('is a no-op (same Song ref) when the section id is absent', () => {
    const a = withLooks();
    expect(setLook(a, 'nope', 'base', 'aurora')).toBe(a);
  });
});

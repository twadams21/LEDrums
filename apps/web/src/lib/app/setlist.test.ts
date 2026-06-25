import { describe, expect, it } from 'vitest';
import {
  addSection,
  clearSlot,
  emptySlots,
  filledCount,
  graphUsageCount,
  isReused,
  makeSection,
  referencedGraphs,
  renameSection,
  setSlot,
  slotsFor,
  SLOTS_PER_DRUM,
  type Song,
} from './setlist';

const DRUMS = ['kick', 'snare', 'tom1', 'tom2'];

function song(): Song {
  return {
    id: 'song1',
    name: 'Set 1',
    sections: [makeSection('intro', 'Intro', DRUMS), makeSection('verse', 'Verse', DRUMS)],
  };
}

describe('emptySlots / makeSection', () => {
  it('gives every drum exactly SLOTS_PER_DRUM empty slots', () => {
    const slots = emptySlots(DRUMS);
    for (const d of DRUMS) {
      expect(slots[d]).toHaveLength(SLOTS_PER_DRUM);
      expect(slots[d]!.every((s) => s === null)).toBe(true);
    }
  });
});

describe('setSlot (immutable)', () => {
  it('places a graph reference without mutating the input', () => {
    const a = song();
    const b = setSlot(a, 'intro', 'snare', 0, 'snare:0');
    expect(slotsFor(b.sections[0]!, 'snare')[0]).toBe('snare:0');
    expect(slotsFor(a.sections[0]!, 'snare')[0]).toBeNull(); // original untouched
    expect(b).not.toBe(a);
  });

  it('ignores out-of-range slot indices', () => {
    const a = song();
    expect(setSlot(a, 'intro', 'snare', 9, 'snare:0')).toBe(a);
  });

  it('clearSlot empties a slot', () => {
    let s = setSlot(song(), 'verse', 'kick', 1, 'kick:0');
    expect(slotsFor(s.sections[1]!, 'kick')[1]).toBe('kick:0');
    s = clearSlot(s, 'verse', 'kick', 1);
    expect(slotsFor(s.sections[1]!, 'kick')[1]).toBeNull();
  });
});

describe('reuse-by-reference', () => {
  it('the same graph key can fill slots in multiple sections (reuse, not copy)', () => {
    let s = song();
    s = setSlot(s, 'intro', 'snare', 0, 'snare:0');
    s = setSlot(s, 'verse', 'snare', 0, 'snare:0'); // SAME graph reused in Verse
    expect(graphUsageCount(s, 'snare:0')).toBe(2);
    expect(isReused(s, 'snare:0')).toBe(true);
    expect(referencedGraphs(s)).toEqual(['snare:0']);
  });

  it('a single placement is not "reused"', () => {
    const s = setSlot(song(), 'intro', 'kick', 0, 'kick:0');
    expect(isReused(s, 'kick:0')).toBe(false);
    expect(graphUsageCount(s, 'kick:0')).toBe(1);
  });

  it('layering: a section can stack a second graph in another slot (Verse = base + more)', () => {
    let s = song();
    s = setSlot(s, 'verse', 'snare', 0, 'snare:0'); // the reused base graph
    s = setSlot(s, 'verse', 'snare', 1, 'snare:2'); // a second, stacked layer
    expect(filledCount(s.sections[1]!, 'snare')).toBe(2);
    expect(slotsFor(s.sections[1]!, 'snare')).toEqual(['snare:0', 'snare:2', null]);
  });
});

describe('section ops', () => {
  it('addSection appends; renameSection relabels', () => {
    let s = addSection(song(), makeSection('chorus', 'Chorus', DRUMS));
    expect(s.sections.map((x) => x.id)).toEqual(['intro', 'verse', 'chorus']);
    s = renameSection(s, 'chorus', 'Big Chorus');
    expect(s.sections.find((x) => x.id === 'chorus')!.name).toBe('Big Chorus');
  });
});

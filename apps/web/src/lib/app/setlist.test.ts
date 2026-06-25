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

// Sections are keyed per PAD by padKey "drumId:zone" (two zones of one drum are two
// distinct rows). The third arg of setSlot/clearSlot/slotsFor is a padKey; the graph
// reference is a separate key (here named "g*" to keep the two roles unambiguous).
const PADS = ['kick:0', 'snare:0', 'snare:2', 'tom1:0'];

function song(): Song {
  return {
    id: 'song1',
    name: 'Set 1',
    sections: [makeSection('intro', 'Intro', PADS), makeSection('verse', 'Verse', PADS)],
  };
}

describe('emptySlots / makeSection', () => {
  it('gives every pad exactly SLOTS_PER_DRUM empty slots', () => {
    const slots = emptySlots(PADS);
    for (const k of PADS) {
      expect(slots[k]).toHaveLength(SLOTS_PER_DRUM);
      expect(slots[k]!.every((s) => s === null)).toBe(true);
    }
  });
});

describe('setSlot (immutable)', () => {
  it('places a graph reference without mutating the input', () => {
    const a = song();
    const b = setSlot(a, 'intro', 'snare:0', 0, 'gSnare');
    expect(slotsFor(b.sections[0]!, 'snare:0')[0]).toBe('gSnare');
    expect(slotsFor(a.sections[0]!, 'snare:0')[0]).toBeNull(); // original untouched
    expect(b).not.toBe(a);
  });

  it('keys slots per pad — Edge and Centre of one drum are independent rows', () => {
    let s = setSlot(song(), 'intro', 'snare:0', 0, 'gCentre');
    s = setSlot(s, 'intro', 'snare:2', 0, 'gRim'); // different zone of the same drum
    expect(slotsFor(s.sections[0]!, 'snare:0')[0]).toBe('gCentre');
    expect(slotsFor(s.sections[0]!, 'snare:2')[0]).toBe('gRim'); // not clobbered by snare:0
  });

  it('ignores out-of-range slot indices', () => {
    const a = song();
    expect(setSlot(a, 'intro', 'snare:0', 9, 'gSnare')).toBe(a);
  });

  it('clearSlot empties a slot', () => {
    let s = setSlot(song(), 'verse', 'kick:0', 1, 'gKick');
    expect(slotsFor(s.sections[1]!, 'kick:0')[1]).toBe('gKick');
    s = clearSlot(s, 'verse', 'kick:0', 1);
    expect(slotsFor(s.sections[1]!, 'kick:0')[1]).toBeNull();
  });
});

describe('reuse-by-reference', () => {
  it('the same graph key can fill slots in multiple sections (reuse, not copy)', () => {
    let s = song();
    s = setSlot(s, 'intro', 'snare:0', 0, 'gSnare');
    s = setSlot(s, 'verse', 'snare:0', 0, 'gSnare'); // SAME graph reused in Verse
    expect(graphUsageCount(s, 'gSnare')).toBe(2);
    expect(isReused(s, 'gSnare')).toBe(true);
    expect(referencedGraphs(s)).toEqual(['gSnare']);
  });

  it('a single placement is not "reused"', () => {
    const s = setSlot(song(), 'intro', 'kick:0', 0, 'gKick');
    expect(isReused(s, 'gKick')).toBe(false);
    expect(graphUsageCount(s, 'gKick')).toBe(1);
  });

  it('layering: a pad can stack a second graph in another slot (Verse = base + more)', () => {
    let s = song();
    s = setSlot(s, 'verse', 'snare:0', 0, 'gBase'); // the reused base graph
    s = setSlot(s, 'verse', 'snare:0', 1, 'gLayer'); // a second, stacked layer on the SAME pad
    expect(filledCount(s.sections[1]!, 'snare:0')).toBe(2);
    expect(slotsFor(s.sections[1]!, 'snare:0')).toEqual(['gBase', 'gLayer', null]);
  });
});

describe('section ops', () => {
  it('addSection appends; renameSection relabels', () => {
    let s = addSection(song(), makeSection('chorus', 'Chorus', PADS));
    expect(s.sections.map((x) => x.id)).toEqual(['intro', 'verse', 'chorus']);
    s = renameSection(s, 'chorus', 'Big Chorus');
    expect(s.sections.find((x) => x.id === 'chorus')!.name).toBe('Big Chorus');
  });
});

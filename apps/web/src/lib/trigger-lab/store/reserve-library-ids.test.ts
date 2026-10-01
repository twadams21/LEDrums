import { describe, expect, it } from 'vitest';
import { effectChain } from '@ledrums/core';
import { authoredIdsFromLibraryV3, idsFromSongLibraryV2 } from './reserve-library-ids';
import { nid, reserveIds } from './ids';
import type { EffectSection, ShowLibraryV3, SongLibraryV2 } from '../persistence';

/* Id reservation for restored / adopted libraries. Effect ids and device uids travel raw inside
   sections (a library song's section ids are namespaced, its Effects are not), and a detached
   song's Effects stay editable — so a high-numbered carried id must bump the global counter, or a
   later mint re-mints a live id. */

/** A section holding one Effect (with a modifier + a control) and a master modifier, all carrying
    raw, high-numbered generated ids. */
function sectionWithHighIds(id: string, n: number): EffectSection {
  const effect = effectChain.parseEffect({
    id: `fx-${n}`,
    cell: { row: 'kick', column: { kind: 'zone', slot: 0 } },
    generator: { kind: 'solid' },
    modifiers: [{ uid: `mod-${n + 1}`, modifierId: 'strobe', params: {}, mix: 1, bypass: false }],
    controls: [{ uid: `ctl-${n + 2}`, kind: 'lfo', settings: {}, mappings: [] }],
  });
  return { id, name: id, effects: [effect], master: [{ uid: `mod-${n + 3}`, modifierId: 'strobe', params: {}, mix: 1, bypass: false }] };
}

describe('idsFromSongLibraryV2', () => {
  it('yields each pool song id plus its sections’ Effect ids and device uids', () => {
    const lib: SongLibraryV2 = {
      songs: { 'song-10': { id: 'song-10', name: 'A', sections: [sectionWithHighIds('lib:song-10/s', 8100001)] } },
    };
    const ids = [...idsFromSongLibraryV2(lib)];
    expect(ids).toEqual(expect.arrayContaining(['song-10', 'fx-8100001', 'mod-8100002', 'ctl-8100003', 'mod-8100004']));

    reserveIds(ids);
    expect(Number(nid('fx').split('-')[1])).toBeGreaterThan(8100004);
  });
});

describe('authoredIdsFromLibraryV3', () => {
  it('walks every show’s songs, sections, Effects, device uids and canvas scenes', () => {
    const lib: ShowLibraryV3 = {
      activeShowId: 'show-1',
      shows: {
        'show-1': {
          id: 'show-1',
          name: 'Show',
          authored: {
            songs: [{ id: 'song-1', name: 'S', sections: [sectionWithHighIds('section-9', 8200001)] }],
            canvasScenes: [{ id: 'scene-8200009', name: 'Sky', sampler: { kind: 'cylinder' }, lenses: [], elements: [] }],
            selectedCell: null,
            selectedEffectId: null,
            activeSongId: 'song-1',
            activeSectionId: 'section-9',
            bpm: 120,
            velocity: 1,
            beatsPerBar: 4,
          },
        },
      },
    };
    expect([...authoredIdsFromLibraryV3(lib)]).toEqual([
      'show-1', 'song-1', 'section-9', 'fx-8200001', 'mod-8200002', 'ctl-8200003', 'mod-8200004', 'scene-8200009',
    ]);
  });
});

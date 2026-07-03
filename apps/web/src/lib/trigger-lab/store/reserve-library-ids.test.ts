import { describe, expect, it } from 'vitest';
import { idsFromLibrarySong, idsFromSongLibrary } from './reserve-library-ids';
import { nid, reserveIds } from './ids';
import type { LibrarySong } from './song-library';
import type { SongLibrary } from '../persistence';
import type { TriggerGraph } from '../sim';

/* Closure-internal id reservation (S44 fix). A library song's graph keys / effect / preset / section
   ids are namespaced (`lib:<id>/…`), but `rekeyGraph` leaves NODE + EDGE ids raw — and S42 lets a
   user edit a referenced graph (add a node). idsFrom* must surface those raw ids so the boot /
   adopt-song-library reserve sites (and the song→library paste branch, which share this helper)
   bump the global counter past them, or a later `nid('n')` re-mints a live node id. */

/** A pool song whose one closure graph carries a raw, high-numbered node + edge id. */
function poolSongWithHighIds(id: string, nodeId: string, edgeId: string): LibrarySong {
  const graph = { nodes: [{ id: nodeId }], edges: [{ id: edgeId }] } as unknown as TriggerGraph;
  return { id, name: id, sections: [], graphs: { [`lib:${id}/graph-1`]: graph }, graphNames: {}, effects: [], presets: [] };
}

describe('idsFromLibrarySong', () => {
  it('yields the pool id plus the closure graph’s raw node/edge ids', () => {
    const ids = [...idsFromLibrarySong(poolSongWithHighIds('song-1', 'n-7000001', 'e-7000002'))];
    expect(ids).toContain('song-1');
    expect(ids).toContain('n-7000001');
    expect(ids).toContain('e-7000002');
  });

  it('reserving its ids bumps the global counter past the carried node id', () => {
    reserveIds(idsFromLibrarySong(poolSongWithHighIds('song-2', 'n-7700001', 'e-7700002')));
    expect(Number(nid('n').split('-')[1])).toBeGreaterThan(7700002);
  });
});

describe('idsFromSongLibrary', () => {
  it('walks every pool song’s closure, so an adopted library never leaves a node id un-reserved', () => {
    const lib: SongLibrary = {
      songs: {
        'song-10': poolSongWithHighIds('song-10', 'n-8100001', 'e-8100002'),
        'song-11': poolSongWithHighIds('song-11', 'n-8200001', 'e-8200002'),
      },
    };
    const ids = [...idsFromSongLibrary(lib)];
    expect(ids).toEqual(expect.arrayContaining(['n-8100001', 'n-8200001', 'e-8100002', 'e-8200002']));

    reserveIds(ids);
    // Editing a referenced graph now mints a node id clear of BOTH pool songs' carried ids.
    expect(Number(nid('n').split('-')[1])).toBeGreaterThan(8200002);
  });
});

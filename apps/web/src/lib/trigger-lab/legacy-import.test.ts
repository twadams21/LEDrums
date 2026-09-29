import { describe, expect, it } from 'vitest';
import { effectChain } from '@ledrums/core';
import {
  LEGACY_SINGLE_SHOW_ID,
  detectLegacyLibrary,
  importLegacyShows,
  pendingLegacyShowNames,
} from './legacy-import';
import {
  SHOWS_STORAGE_KEY,
  SONGS_STORAGE_KEY,
  STORAGE_KEY,
  loadShowLibraryV3,
  serializeShowLibraryV3,
  serializeSongLibraryV2,
  type StorageLike,
} from './persistence';
import { seedAuthoredV3 } from './seed-effects';

function memoryStorage(initial: Record<string, unknown> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)] as const));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

const scene = { id: 'scene-1', name: 'Clouds', layers: [] };

/** A graph-model show: graphs, presets, buses and effect defs that must all be dropped. */
function legacyAuthored(sectionPrefix: string, hoopTarget: string) {
  return {
    graphs: {
      [`${sectionPrefix}:kick`]: {
        nodes: [{ id: 'n-1', kind: 'play', scope: 'hoop', targetId: hoopTarget, effectId: 'flash', presetId: 'flash:default' }],
        edges: [],
      },
    },
    graphNames: { [`${sectionPrefix}:kick`]: 'Kick' },
    songs: [
      {
        id: 'song-1',
        name: 'Opener',
        sections: [
          { id: `${sectionPrefix}-a`, name: 'Verse', graphs: [`${sectionPrefix}:kick`], looks: {}, bars: 16, bpm: 140 },
          { id: `${sectionPrefix}-b`, name: 'Chorus', graphs: [], looks: {} },
        ],
      },
      { id: 'song-2', name: 'Closer', sections: [{ id: `${sectionPrefix}-c`, name: 'Outro', graphs: [] }] },
    ],
    songRefs: ['libsong-1'],
    buses: [{ id: 'base', name: 'Base', polyphony: 'poly', crossfadeMs: 120 }],
    presets: [{ id: 'flash:default', name: 'Default', effectId: 'flash', params: {} }],
    effects: [{ id: 'flash', name: 'Flash', busId: 'base', scope: 'drum', params: [] }],
    canvasScenes: [scene],
    selectedPadKey: 'kick:0',
    activeSongId: 'song-1',
    activeSectionId: `${sectionPrefix}-b`,
    bpm: 132,
    velocity: 0.6,
    beatsPerBar: 3,
    paneSizes: { dock: 240 },
  };
}

function legacyLibrary(version: 1 | 2) {
  return {
    version,
    data: {
      shows: {
        'show-1': { id: 'show-1', name: 'Friday gig', authored: legacyAuthored('s1', version === 1 ? 'kick#0' : 'kick#1') },
        'show-2': { id: 'show-2', name: 'Rehearsal', authored: legacyAuthored('s2', version === 1 ? 'kick#0' : 'kick#1') },
      },
      activeShowId: 'show-2',
    },
  };
}

const legacySongs = {
  version: 1,
  data: {
    songs: {
      'libsong-1': {
        id: 'libsong-1',
        name: 'Anthem',
        sections: [{ id: 'lib:libsong-1/verse', name: 'Verse', graphs: ['lib:libsong-1/g'] }],
        graphs: { 'lib:libsong-1/g': { nodes: [], edges: [] } },
        graphNames: {},
        effects: [],
        presets: [],
      },
    },
  },
};

describe('detectLegacyLibrary', () => {
  it('finds the old show library + song library under the old keys, reading only', () => {
    const storage = memoryStorage({ [SHOWS_STORAGE_KEY]: legacyLibrary(2), [SONGS_STORAGE_KEY]: legacySongs });
    const before = new Map(storage.data);
    const found = detectLegacyLibrary(storage)!;
    expect(found.source).toBe('local');
    expect(found.showNames).toEqual(['Friday gig', 'Rehearsal']);
    expect(found.songs).toEqual(legacySongs);
    expect(storage.data).toEqual(before);
  });

  it('finds the older single authored blob when there is no show library', () => {
    const found = detectLegacyLibrary(memoryStorage({ [STORAGE_KEY]: { version: 2, data: legacyAuthored('x', 'kick#1') } }))!;
    expect(found.showNames).toEqual(['Default Show']);
  });

  it('prefers local data over the server blob, and uses an old server blob when local is empty', () => {
    const server = { showLibrary: legacyLibrary(1), songLibrary: legacySongs };
    expect(detectLegacyLibrary(memoryStorage({ [SHOWS_STORAGE_KEY]: legacyLibrary(2) }), server)!.source).toBe('local');
    const fromServer = detectLegacyLibrary(memoryStorage(), server)!;
    expect(fromServer.source).toBe('server');
    expect(fromServer.songs).toEqual(legacySongs);
  });

  it('finds nothing when there is no old data, or the server blob is already v3', () => {
    expect(detectLegacyLibrary(null)).toBeNull();
    expect(detectLegacyLibrary(memoryStorage({ [SHOWS_STORAGE_KEY]: { version: 9, data: {} } }))).toBeNull();
    const v3 = serializeShowLibraryV3(loadShowLibraryV3(null, () => 'show-1', seedAuthoredV3));
    expect(detectLegacyLibrary(memoryStorage(), { showLibrary: v3 })).toBeNull();
  });
});

describe('importLegacyShows', () => {
  it('keeps songs, sections, scenes and transport and drops every graph-model container', () => {
    const { library, importedShowIds } = importLegacyShows({ shows: legacyLibrary(2), songs: null });
    expect(importedShowIds).toEqual(['show-1', 'show-2']);
    expect(library.activeShowId).toBe('show-2');
    const show = library.shows['show-1']!;
    expect(show.name).toBe('Friday gig');
    expect(show.importedFrom).toBe('show-1');
    const a = show.authored;
    expect(a.songs).toEqual([
      {
        id: 'song-1',
        name: 'Opener',
        sections: [
          { id: 's1-a', name: 'Verse', bars: 16, bpm: 140, effects: [], master: [] },
          { id: 's1-b', name: 'Chorus', effects: [], master: [] },
        ],
      },
      { id: 'song-2', name: 'Closer', sections: [{ id: 's1-c', name: 'Outro', effects: [], master: [] }] },
    ]);
    expect(a.canvasScenes).toEqual([scene]);
    expect(a.songRefs).toEqual(['libsong-1']);
    expect([a.bpm, a.beatsPerBar, a.velocity]).toEqual([132, 3, 0.6]);
    expect([a.activeSongId, a.activeSectionId]).toEqual(['song-1', 's1-b']);
    expect(a.paneSizes).toEqual({ dock: 240 });
    expect(a.selectedCell).toBeNull();
    for (const dropped of ['graphs', 'graphNames', 'buses', 'presets', 'effects', 'selectedPadKey']) {
      expect(dropped in a).toBe(false);
    }
  });

  it('is idempotent: re-importing into the result adds nothing', () => {
    const raw = { shows: legacyLibrary(2), songs: legacySongs };
    const first = importLegacyShows(raw);
    const second = importLegacyShows(raw, { into: first.library, intoSongs: first.songLibrary });
    expect(second.importedShowIds).toEqual([]);
    expect(second.library).toEqual(first.library);
    expect(second.songLibrary).toEqual(first.songLibrary);
    expect(pendingLegacyShowNames(raw, first.library)).toEqual([]);
    expect(pendingLegacyShowNames(raw, null)).toEqual(['Friday gig', 'Rehearsal']);
  });

  it('keeps the current library and re-ids a show or section that collides with it', () => {
    const into = loadShowLibraryV3(null, () => 'show-1', seedAuthoredV3); // seed section id: 'intro'
    const raw = legacyAuthored('x', 'kick#1');
    raw.songs[0]!.sections[0]!.id = 'intro';
    raw.activeSectionId = 'intro';
    const ids = ['section-900', 'show-900'];
    const { library, importedShowIds } = importLegacyShows(
      { shows: { version: 2, data: { shows: { 'show-1': { id: 'show-1', name: 'Old', authored: raw } }, activeShowId: 'show-1' } }, songs: null },
      { into, newId: (prefix) => ids.find((id) => id.startsWith(prefix))! },
    );
    expect(importedShowIds).toEqual(['show-900']);
    expect(library.activeShowId).toBe('show-1');
    expect(library.shows['show-1']).toEqual(into.shows['show-1']);
    const imported = library.shows['show-900']!;
    expect(imported.importedFrom).toBe('show-1');
    expect(imported.authored.songs[0]!.sections.map((s) => s.id)).toEqual(['section-900', 'x-b']);
    expect(imported.authored.activeSectionId).toBe('section-900');
  });

  it('accepts a v1 source through the existing hoop migration (graphs are then dropped)', () => {
    const fromV1 = importLegacyShows({ shows: legacyLibrary(1), songs: null });
    const fromV2 = importLegacyShows({ shows: legacyLibrary(2), songs: null });
    expect(fromV1.importedShowIds).toEqual(['show-1', 'show-2']);
    expect(fromV1.library).toEqual(fromV2.library);
  });

  it('imports the legacy single blob as one Default Show', () => {
    const { library } = importLegacyShows({ shows: { version: 1, data: legacyAuthored('x', 'kick#0') }, songs: null });
    expect(Object.values(library.shows).map((s) => [s.name, s.importedFrom])).toEqual([['Default Show', LEGACY_SINGLE_SHOW_ID]]);
  });

  it('imports nothing from an unusable source', () => {
    const into = loadShowLibraryV3(null, () => 'show-1', seedAuthoredV3);
    const result = importLegacyShows({ shows: { version: 42 }, songs: 'junk' }, { into });
    expect(result.importedShowIds).toEqual([]);
    expect(result.library).toEqual(into);
  });

  it('brings the song library across so song refs resolve in the runtime Show', () => {
    const { library, songLibrary } = importLegacyShows({ shows: legacyLibrary(2), songs: legacySongs });
    expect(songLibrary.songs['libsong-1']).toEqual({
      id: 'libsong-1',
      name: 'Anthem',
      sections: [{ id: 'lib:libsong-1/verse', name: 'Verse', effects: [], master: [] }],
    });
    const showBlob = JSON.parse(JSON.stringify(serializeShowLibraryV3(library)));
    const songBlob = JSON.parse(JSON.stringify(serializeSongLibraryV2(songLibrary)));
    const built = effectChain.buildRuntimeShow(effectChain.parseShowLibraryV3(showBlob), effectChain.parseSongLibraryV2(songBlob));
    expect(built.diagnostics).toEqual([]);
    expect(built.show!.songs!.map((s) => s.id)).toEqual(['song-1', 'song-2', 'libsong-1']);
    expect(built.show!.songs![0]!.sections[0]!.effects).toEqual([]);
  });
});

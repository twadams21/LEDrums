import { describe, expect, it } from 'vitest';
import { buildRuntimeShow, parseShowLibraryV3, parseSongLibraryV2, type LibraryDiagnostic } from './library';
import { parseEffect } from './types';

const zoneEffect = (id: string, row: string, slot: number) =>
  ({ id, cell: { row, column: { kind: 'zone', slot } }, generator: { kind: 'solid' } });

const scene = (id: string, name = id) => ({ id, name, sampler: { kind: 'cylinder' }, lenses: [], elements: [] });

/** Two songs: one owned by the show, one referenced from the song library. */
const MAPPINGS = [
  { id: 'm-note', source: { midiNote: 36 }, target: { kind: 'fireCell', cell: { row: 'kick', column: { kind: 'zone', slot: 0 } } } },
  { id: 'two-sources', source: { midiNote: 1, midiCc: 2 }, target: { kind: 'fireEffect', effectId: 'kick-hit' } },
  { id: 'm-note', source: { midiNote: 37 }, target: { kind: 'fireEffect', effectId: 'kick-hit' } },
  { id: 'm-cc', source: { midiCc: 21 }, target: { kind: 'opacity', effectId: 'wash' }, rangeMin: 0, rangeMax: 0.5 },
];

function fixture() {
  const showLibrary = {
    version: 3,
    data: {
      activeShowId: 'main',
      shows: {
        other: { id: 'other', name: 'Other', authored: { songs: [{ id: 'x', name: 'X', sections: [] }] } },
        main: {
          id: 'main', name: 'Main',
          authored: {
            songs: [{
              id: 'own', name: 'Own song',
              sections: [{
                id: 'verse', name: 'Verse', bars: 8, bpm: 128, futureField: 'kept',
                effects: [
                  zoneEffect('kick-hit', 'kick', 0),
                  { id: 'broken', cell: { row: 'kit', column: { kind: 'zone', slot: 0 } }, generator: { kind: 'solid' } },
                  { id: 'wash', cell: { row: 'kit', column: { kind: 'always' } }, generator: { kind: 'scene', params: { sceneId: 'mine' } } },
                  zoneEffect('kick-hit', 'snare', 1),
                ],
                master: [{ uid: 'm1', modifierId: 'strobe' }, { modifierId: 'no-uid' }],
              }],
            }],
            songRefs: ['shared', 'shared', 'missing'],
            canvasScenes: [scene('mine')],
            activeSongId: 'own', activeSectionId: 'verse', bpm: 120, beatsPerBar: 4,
            mappings: MAPPINGS,
          },
        },
      },
    },
  };
  const songLibrary = {
    version: 2,
    data: {
      songs: {
        shared: {
          id: 'shared', name: 'Shared song',
          sections: [
            { id: 'lib:shared/chorus', name: 'Chorus', effects: [zoneEffect('lib-snare', 'snare', 0)], master: [] },
            { id: 'verse', name: 'Clashing id', effects: [], master: [] },
          ],
          canvasScenes: [scene('mine', 'library copy'), scene('lib:shared/sky')],
        },
      },
    },
  };
  return { showLibrary, songLibrary };
}

describe('buildRuntimeShow (v3 library → runtime Show)', () => {
  it('builds the active show: own + referenced songs, effect sections with master, and scenes', () => {
    const { showLibrary, songLibrary } = fixture();
    const { show } = buildRuntimeShow(parseShowLibraryV3(showLibrary), parseSongLibraryV2(songLibrary));
    expect(show).not.toBeNull();
    expect(Object.keys(show!).sort()).toEqual(['canvasScenes', 'mappings', 'songs']);

    expect(show!.songs).toEqual([
      { id: 'own', name: 'Own song', sections: [{
        id: 'verse', name: 'Verse',
        effects: [
          parseEffect(zoneEffect('kick-hit', 'kick', 0)),
          parseEffect({ id: 'wash', cell: { row: 'kit', column: { kind: 'always' } }, generator: { kind: 'scene', params: { sceneId: 'mine' } } }),
        ],
        master: [{ uid: 'm1', modifierId: 'strobe', params: {}, mix: 1, bypass: false }],
      }] },
      // Referenced once despite the duplicate ref; the dangling ref resolves to nothing; the
      // library section whose id clashes with the show's own `verse` is skipped.
      { id: 'shared', name: 'Shared song', sections: [{
        id: 'lib:shared/chorus', name: 'Chorus',
        effects: [parseEffect(zoneEffect('lib-snare', 'snare', 0))], master: [],
      }] },
    ]);

    // The show's own scene wins over the library's same-id copy; the library-only scene is added.
    expect(show!.canvasScenes!.map((s) => [s.id, s.name])).toEqual([['mine', 'mine'], ['lib:shared/sky', 'lib:shared/sky']]);
  });

  it('drops an invalid Effect, a duplicate Effect id and an invalid master modifier with diagnostics, never throwing', () => {
    const { showLibrary, songLibrary } = fixture();
    const { diagnostics } = buildRuntimeShow(parseShowLibraryV3(showLibrary), parseSongLibraryV2(songLibrary));
    expect(diagnostics).toEqual<LibraryDiagnostic[]>([
      { kind: 'invalid-effect', songId: 'own', sectionId: 'verse', index: 1, id: 'broken', message: expect.stringContaining('the Kit row has no zone columns') },
      { kind: 'duplicate-effect-id', songId: 'own', sectionId: 'verse', index: 3, id: 'kick-hit', message: expect.stringContaining("duplicate Effect id 'kick-hit'") },
      { kind: 'invalid-master-modifier', songId: 'own', sectionId: 'verse', index: 1, message: expect.stringContaining('uid') },
      { kind: 'invalid-mapping', songId: '', sectionId: '', index: 1, id: 'two-sources', message: expect.any(String) },
      { kind: 'invalid-mapping', songId: '', sectionId: '', index: 2, id: 'm-note', message: expect.stringContaining("duplicate mapping id 'm-note'") },
    ]);
  });

  it('carries the valid InputMappings on the runtime Show, in authored order', () => {
    const { showLibrary, songLibrary } = fixture();
    const { show } = buildRuntimeShow(parseShowLibraryV3(showLibrary), parseSongLibraryV2(songLibrary));
    expect(show!.mappings).toEqual([MAPPINGS[0], MAPPINGS[3]]);
  });

  it('reports a mappings field that is not an array, and absent mappings as none', () => {
    const lib = (mappings: unknown) => parseShowLibraryV3({ version: 3, data: { shows: { s: { authored: { mappings } } } } });
    const bad = buildRuntimeShow(lib({ opaque: true }), null);
    expect(bad.show!.mappings).toEqual([]);
    expect(bad.diagnostics).toEqual([{ kind: 'invalid-mapping', songId: '', sectionId: '', index: -1, message: 'mappings is not an array' }]);
    expect(buildRuntimeShow(lib(undefined), null)).toMatchObject({ show: { mappings: [] }, diagnostics: [] });
  });

  it('keeps unknown authored fields on the parsed library and never mutates its inputs', () => {
    const { showLibrary, songLibrary } = fixture();
    const before = structuredClone({ showLibrary, songLibrary });
    const parsed = parseShowLibraryV3(showLibrary);
    buildRuntimeShow(parsed, parseSongLibraryV2(songLibrary));
    expect({ showLibrary, songLibrary }).toEqual(before);
    const section = parsed.data.shows.main!.authored.songs[0]!.sections[0]!;
    expect(section.futureField).toBe('kept');
    // Stored mappings are kept verbatim (invalid ones included); only the runtime Show filters.
    expect(parsed.data.shows.main!.authored.mappings).toEqual(MAPPINGS);
  });

  it('falls back to the first show when the active id dangles, and builds without a song library', () => {
    const { showLibrary } = fixture();
    const lib = parseShowLibraryV3({ ...showLibrary, data: { ...showLibrary.data, activeShowId: 'gone' } });
    expect(buildRuntimeShow(lib, null).show!.songs!.map((s) => s.id)).toEqual(['x']);
    const refsOnly = parseShowLibraryV3(showLibrary);
    expect(buildRuntimeShow(refsOnly, null).show!.songs!.map((s) => s.id)).toEqual(['own']);
  });

  it('yields no show for an empty library', () => {
    expect(buildRuntimeShow(parseShowLibraryV3({ version: 3, data: { shows: {} } }), null)).toEqual({ show: null, diagnostics: [] });
  });

  it('rejects a structurally unusable envelope with the failing path', () => {
    expect(() => parseShowLibraryV3({ version: 2, data: { shows: {} } })).toThrow(/Invalid show library v3 at version/);
    expect(() => parseShowLibraryV3({ version: 3, data: { shows: { s: { authored: { songs: [{ name: 'no id' }] } } } } }))
      .toThrow(/data\.shows\.s\.authored\.songs\.0\.id/);
    expect(() => parseSongLibraryV2({ version: 2, data: 'nope' })).toThrow(/Invalid song library v2 at data/);
  });
});

import { describe, expect, it } from 'vitest';
import { effectChain } from '@ledrums/core';
import {
  SHOWS_STORAGE_KEY,
  SHOWS_V3_STORAGE_KEY,
  SONGS_STORAGE_KEY,
  SONGS_V2_STORAGE_KEY,
  STORAGE_KEY,
  bootEffectLibraries,
  deserializeShowLibraryV3,
  deserializeSongLibraryV2,
  loadShowLibraryV3,
  serializeShowLibraryV3,
  serializeSongLibraryV2,
  writeShowLibraryV3,
  writeSongLibraryV2,
  type ShowLibraryV3,
  type SongLibraryV2,
  type StorageLike,
} from './persistence';
import { SEED_KICK_EFFECT_ID, SEED_SECTION_ID, seedAuthoredV3 } from './seed-effects';

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

const throwingStorage: StorageLike = {
  getItem: () => { throw new Error('denied'); },
  setItem: () => { throw new Error('quota'); },
};

/** Old-format blobs under the old keys — must survive every v3 read / write byte for byte. */
const OLD_KEYS = {
  [STORAGE_KEY]: JSON.stringify({ version: 2, data: { songs: [], graphs: {} } }),
  [SHOWS_STORAGE_KEY]: JSON.stringify({ version: 2, data: { shows: { 'show-1': { id: 'show-1', name: 'Old', authored: {} } }, activeShowId: 'show-1' } }),
  [SONGS_STORAGE_KEY]: JSON.stringify({ version: 1, data: { songs: {} } }),
};

function seededLibrary(): ShowLibraryV3 {
  return loadShowLibraryV3(null, () => 'show-1', seedAuthoredV3);
}

describe('v3 show library persistence', () => {
  it('round-trips a library through JSON unchanged', () => {
    const lib = seededLibrary();
    lib.shows['show-1']!.authored.songs[0]!.sections[0]!.bars = 8;
    lib.shows['show-1']!.authored.selectedCell = 'master';
    const back = deserializeShowLibraryV3(JSON.parse(JSON.stringify(serializeShowLibraryV3(lib))));
    expect(back).toEqual(lib);
  });

  it('writes the envelope core builds the runtime Show from (the server contract)', () => {
    const blob = JSON.parse(JSON.stringify(serializeShowLibraryV3(seededLibrary())));
    const built = effectChain.buildRuntimeShow(effectChain.parseShowLibraryV3(blob), null);
    expect(built.diagnostics).toEqual([]);
    const section = built.show!.songs![0]!.sections[0]!;
    expect(section.id).toBe(SEED_SECTION_ID);
    expect(section.effects!.map((e) => e.id)).toEqual(['fx-seed-kick', 'fx-seed-snare', 'fx-seed-bed']);
  });

  it('boots a seeded fresh library when no v3 library is stored', () => {
    const lib = loadShowLibraryV3(null, () => 'show-7', seedAuthoredV3);
    expect(lib.activeShowId).toBe('show-7');
    const authored = lib.shows['show-7']!.authored;
    expect(authored.selectedEffectId).toBe(SEED_KICK_EFFECT_ID);
    const effects = authored.songs[0]!.sections[0]!.effects;
    expect(effects.map((e) => [e.cell.row, e.cell.column.kind, e.generator.kind, e.generator.style])).toEqual([
      ['kick', 'zone', 'solid', 'simple'],
      ['snare', 'zone', 'wave', 'radial'],
      ['kit', 'always', 'gradient', 'rainbow'],
    ]);
    expect(effects[1]!.modifiers.map((m) => m.modifierId)).toEqual(['strobe']);
    expect(effects[2]!.opacity).toBeLessThan(0.5);
  });

  it('ignores old-format libraries on boot and never writes or deletes the old keys', () => {
    const storage = memoryStorage(OLD_KEYS);
    const boot = bootEffectLibraries(storage, () => 'show-new', seedAuthoredV3);
    expect(boot.showsFromStorage).toBe(false);
    expect(Object.keys(boot.shows.shows)).toEqual(['show-new']);
    expect(writeShowLibraryV3(storage, boot.shows)).toBe(true);
    expect(writeSongLibraryV2(storage, boot.songs)).toBe(true);
    for (const [key, value] of Object.entries(OLD_KEYS)) expect(storage.data.get(key)).toBe(value);
    expect([...storage.data.keys()].sort()).toEqual([...Object.keys(OLD_KEYS), SHOWS_V3_STORAGE_KEY, SONGS_V2_STORAGE_KEY].sort());

    const reboot = bootEffectLibraries(storage, () => 'unused', seedAuthoredV3);
    expect(reboot.showsFromStorage).toBe(true);
    expect(reboot.songsFromStorage).toBe(true);
    expect(reboot.shows).toEqual(boot.shows);
  });

  it('boots the seed from a throwing storage and reports failed writes', () => {
    const boot = bootEffectLibraries(throwingStorage, () => 'show-1', seedAuthoredV3);
    expect(boot.showsFromStorage).toBe(false);
    expect(boot.shows.shows['show-1']!.authored.songs).toHaveLength(1);
    expect(writeShowLibraryV3(throwingStorage, boot.shows)).toBe(false);
  });

  it('rejects an old-version envelope instead of upgrading it', () => {
    expect(deserializeShowLibraryV3(JSON.parse(OLD_KEYS[SHOWS_STORAGE_KEY]))).toBeNull();
    expect(deserializeShowLibraryV3({ version: 3, data: { shows: {} } })).toBeNull();
    expect(deserializeShowLibraryV3('nope')).toBeNull();
  });

  it('drops an invalid Effect but keeps the rest of its section', () => {
    const valid = { id: 'fx-1', cell: { row: 'kick', column: { kind: 'zone', slot: 0 } }, generator: { kind: 'solid' } };
    const zoneOnKit = { id: 'fx-2', cell: { row: 'kit', column: { kind: 'zone', slot: 0 } }, generator: { kind: 'solid' } };
    const lib = deserializeShowLibraryV3({
      version: 3,
      data: {
        shows: {
          a: {
            id: 'a',
            name: 'A',
            authored: {
              songs: [{ id: 's', name: 'S', sections: [{ id: 'x', name: 'X', effects: [valid, zoneOnKit, valid], master: [{ uid: 'm1', modifierId: 'strobe' }, { nope: 1 }] }] }],
              selectedCell: { row: 'kick' },
            },
          },
        },
        activeShowId: 'dangling',
      },
    })!;
    expect(lib.activeShowId).toBe('a');
    const section = lib.shows.a!.authored.songs[0]!.sections[0]!;
    expect(section.effects.map((e) => e.id)).toEqual(['fx-1']);
    expect(section.master.map((m) => m.uid)).toEqual(['m1']);
    expect('selectedCell' in lib.shows.a!.authored).toBe(false);
  });

  it('keeps section ids unique across shows (first wins)', () => {
    const song = { id: 's', name: 'S', sections: [{ id: 'dup', name: 'One' }] };
    const lib = deserializeShowLibraryV3({
      version: 3,
      data: { shows: { a: { name: 'A', authored: { songs: [song] } }, b: { name: 'B', authored: { songs: [song] } } }, activeShowId: 'a' },
    })!;
    expect(lib.shows.a!.authored.songs[0]!.sections.map((s) => s.id)).toEqual(['dup']);
    expect(lib.shows.b!.authored.songs[0]!.sections).toEqual([]);
  });
});

describe('v2 song library persistence', () => {
  it('round-trips a library song with its effect sections and scenes', () => {
    const lib: SongLibraryV2 = {
      songs: {
        'song-1': {
          id: 'song-1',
          name: 'Anthem',
          sections: [{ id: 'lib:song-1/verse', name: 'Verse', effects: seedAuthoredV3().songs[0]!.sections[0]!.effects, master: [] }],
          canvasScenes: [],
        },
      },
    };
    expect(deserializeSongLibraryV2(JSON.parse(JSON.stringify(serializeSongLibraryV2(lib))))).toEqual(lib);
  });

  it('boots an empty pool from a missing or old-version blob', () => {
    expect(bootEffectLibraries(memoryStorage(OLD_KEYS), () => 'x', seedAuthoredV3).songs).toEqual({ songs: {} });
    expect(deserializeSongLibraryV2({ version: 1, data: { songs: {} } })).toBeNull();
  });
});

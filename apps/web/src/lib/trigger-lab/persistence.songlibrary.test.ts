import { describe, it, expect } from 'vitest';
import {
  SONGS_STORAGE_KEY,
  SONGS_VERSION,
  serializeSongLibrary,
  deserializeSongLibrary,
  coerceLibrarySong,
  loadSongLibrary,
  type SongLibrary,
} from './persistence';
import { extractSongClosure, type ClosureSources } from './store/song-library';
import { makeNode } from './sim.graph-compilation';
import { makeSong, makeSection } from '../app/setlist';
import type { EffectDef, Preset, TriggerGraph } from './sim';

// ---- fixtures ---------------------------------------------------------------

const effect = (id: string): EffectDef => ({
  id,
  name: id,
  busId: 'base',
  scope: 'kit',
  params: [],
  attackMs: 0,
  sustainMs: 0,
  releaseMs: 0,
});
const preset = (id: string, effectId: string): Preset => ({ id, name: id, effectId, params: {} });
const playGraph = (effectId: string, presetId: string): TriggerGraph => ({
  nodes: [makeNode('trigger', 'trigger'), makeNode('play', 'p1', 0, 0, { kind: 'play', effectId, presetId })],
  edges: [{ id: 'e1', from: 'trigger', to: 'p1' }],
});

function sampleLibrary(): SongLibrary {
  const song = makeSong('song-1', 'Intro', [makeSection('s1', 'A', ['g'])]);
  const src: ClosureSources = {
    graphs: { g: playGraph('fx', 'fx:default') },
    graphNames: { g: 'G' },
    effects: [effect('fx')],
    presets: [preset('fx:default', 'fx')],
  };
  return { songs: { 'lib-1': extractSongClosure(song, src, 'lib-1') } };
}

describe('song-library envelope', () => {
  it('storage key + version are stable', () => {
    expect(SONGS_STORAGE_KEY).toBe('ledrums:songs:v1');
    expect(SONGS_VERSION).toBe(1);
  });

  it('round-trips through serialize → JSON → deserialize', () => {
    const lib = sampleLibrary();
    const wire = JSON.parse(JSON.stringify(serializeSongLibrary(lib)));
    expect(deserializeSongLibrary(wire)).toEqual(lib);
  });
});

describe('deserializeSongLibrary — defensive load (never throws)', () => {
  it('rejects a non-object / non-envelope', () => {
    expect(deserializeSongLibrary(null)).toBeNull();
    expect(deserializeSongLibrary('nope')).toBeNull();
    expect(deserializeSongLibrary(42)).toBeNull();
  });

  it('rejects a version mismatch (leaves a future v2 blob for its own key)', () => {
    const wire = serializeSongLibrary(sampleLibrary());
    expect(deserializeSongLibrary({ ...wire, version: 2 })).toBeNull();
  });

  it('rejects a missing songs record', () => {
    expect(deserializeSongLibrary({ version: SONGS_VERSION, data: {} })).toBeNull();
  });

  it('drops malformed songs but keeps the well-formed ones (empty pool is legal)', () => {
    const good = sampleLibrary().songs['lib-1']!;
    const wire = {
      version: SONGS_VERSION,
      data: { songs: { 'lib-1': good, bad: { name: 'no id' }, junk: 42 } },
    };
    const lib = deserializeSongLibrary(wire)!;
    expect(Object.keys(lib.songs)).toEqual(['lib-1']);
  });

  it('all-malformed degrades to an empty pool, not null', () => {
    const wire = { version: SONGS_VERSION, data: { songs: { bad: {}, junk: 1 } } };
    expect(deserializeSongLibrary(wire)).toEqual({ songs: {} });
  });

  it('re-points a song’s map key to its coerced id', () => {
    const good = sampleLibrary().songs['lib-1']!;
    const wire = { version: SONGS_VERSION, data: { songs: { 'stale-key': good } } };
    const lib = deserializeSongLibrary(wire)!;
    expect(Object.keys(lib.songs)).toEqual(['lib-1']);
  });
});

describe('coerceLibrarySong', () => {
  it('defaults every closure container when absent/wrong-typed', () => {
    expect(coerceLibrarySong({ id: 'x' })).toEqual({
      id: 'x',
      name: 'Untitled Song',
      sections: [],
      graphs: {},
      graphNames: {},
      effects: [],
      presets: [],
    });
  });

  it('returns null with no usable id', () => {
    expect(coerceLibrarySong({ name: 'nameless' })).toBeNull();
    expect(coerceLibrarySong(null)).toBeNull();
  });
});

describe('loadSongLibrary', () => {
  it('valid blob wins', () => {
    const lib = sampleLibrary();
    expect(loadSongLibrary(serializeSongLibrary(lib))).toEqual(lib);
  });

  it('absent / junk storage → fresh empty library (never throws)', () => {
    expect(loadSongLibrary(null)).toEqual({ songs: {} });
    expect(loadSongLibrary('corrupt')).toEqual({ songs: {} });
  });
});

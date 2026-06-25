import { describe, expect, it } from 'vitest';
import {
  STORAGE_KEY,
  VERSION,
  deserializeAuthored,
  serializeAuthored,
  type AuthoredState,
} from './persistence';
import { makeNode, type TriggerGraph } from './sim';
import { makeSection, setSlot, type Song } from '../app/setlist';

const graph = (): TriggerGraph => ({ nodes: [makeNode('trigger', 'trigger')], edges: [] });

function authored(): AuthoredState {
  let song: Song = { id: 'set-1', name: 'Set 1', sections: [makeSection('intro', 'Intro', ['kick', 'snare'])] };
  song = setSlot(song, 'intro', 'kick', 0, 'kick:1');
  return {
    graphs: { 'kick:1': graph(), 'graph:1001': graph() },
    graphNames: { 'graph:1001': 'New graph 1' },
    songs: [song],
    buses: [{ id: 'base', name: 'Base', polyphony: 'poly', crossfadeMs: 120 }],
    presets: [{ id: 'flash:default', name: 'Default', effectId: 'flash', params: { hue: 200 } }],
    effects: [
      { id: 'flash', name: 'Flash', pattern: 'flash', busId: 'base', scope: 'drum', params: [], attackMs: 5, sustainMs: 10, releaseMs: 200 },
    ],
    selectedPadKey: 'kick:1',
    activeSongId: 'set-1',
    arrangeSectionId: 'intro',
    bpm: 128,
    velocity: 0.7,
    beatsPerBar: 4,
  };
}

describe('serializeAuthored / deserializeAuthored round-trip', () => {
  it('preserves every authored field through serialize → JSON → parse → deserialize', () => {
    const state = authored();
    const json = JSON.stringify(serializeAuthored(state));
    const restored = deserializeAuthored(JSON.parse(json));
    expect(restored).toEqual(state);
  });

  it('stamps the current VERSION into the envelope', () => {
    expect(serializeAuthored(authored()).version).toBe(VERSION);
  });

  it('round-trips optional paneSizes when present', () => {
    const state = { ...authored(), paneSizes: { leftRail: 280, rightDock: 360, bottomDock: 200 } };
    const restored = deserializeAuthored(JSON.parse(JSON.stringify(serializeAuthored(state))));
    expect(restored?.paneSizes).toEqual(state.paneSizes);
  });
});

describe('version gate', () => {
  it('returns null on a version mismatch (so a stale blob never wedges boot)', () => {
    const env = serializeAuthored(authored());
    expect(deserializeAuthored({ ...env, version: VERSION + 1 })).toBeNull();
    expect(deserializeAuthored({ ...env, version: 0 })).toBeNull();
  });

  it('returns null when the version field is missing', () => {
    expect(deserializeAuthored({ data: authored() })).toBeNull();
  });
});

describe('malformed input', () => {
  it('returns null for non-objects', () => {
    expect(deserializeAuthored(null)).toBeNull();
    expect(deserializeAuthored(undefined)).toBeNull();
    expect(deserializeAuthored('nope')).toBeNull();
    expect(deserializeAuthored(42)).toBeNull();
    expect(deserializeAuthored([])).toBeNull();
  });

  it('returns null when the version matches but data is not an object', () => {
    expect(deserializeAuthored({ version: VERSION, data: 'broken' })).toBeNull();
    expect(deserializeAuthored({ version: VERSION })).toBeNull();
    expect(deserializeAuthored({ version: VERSION, data: [] })).toBeNull();
  });
});

describe('partial / wrong-typed tolerance', () => {
  it('returns only the fields that are present (older blob, missing fields)', () => {
    const restored = deserializeAuthored({ version: VERSION, data: { bpm: 140, activeSongId: 'set-2' } });
    expect(restored).toEqual({ bpm: 140, activeSongId: 'set-2' });
  });

  it('drops fields of the wrong container/primitive type but keeps valid siblings', () => {
    const restored = deserializeAuthored({
      version: VERSION,
      data: { graphs: ['not-a-record'], songs: { not: 'an-array' }, bpm: 'fast', velocity: 0.9 },
    });
    expect(restored).toEqual({ velocity: 0.9 });
  });

  it('drops non-finite numbers', () => {
    const restored = deserializeAuthored({ version: VERSION, data: { bpm: NaN, velocity: Infinity, beatsPerBar: 3 } });
    expect(restored).toEqual({ beatsPerBar: 3 });
  });

  it('keeps explicit null for the nullable ids', () => {
    const restored = deserializeAuthored({
      version: VERSION,
      data: { selectedPadKey: null, arrangeSectionId: null },
    });
    expect(restored).toEqual({ selectedPadKey: null, arrangeSectionId: null });
  });
});

describe('storage key', () => {
  it('namespaces the schema version into the key', () => {
    expect(STORAGE_KEY).toContain('v1');
  });
});

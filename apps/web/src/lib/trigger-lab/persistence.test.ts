import { describe, expect, it } from 'vitest';
import {
  STORAGE_KEY,
  SHOWS_STORAGE_KEY,
  SHOWS_VERSION,
  VERSION,
  deserializeAuthored,
  deserializeShowLibrary,
  loadShowLibrary,
  migrateSongs,
  sectionGraphList,
  serializeAuthored,
  serializeShowLibrary,
  type AuthoredState,
  type ShowLibrary,
} from './persistence';
import { makeNode, type TriggerGraph } from './sim';
import { addGraph, makeSection, type Song } from '../app/setlist';

const graph = (): TriggerGraph => ({ nodes: [makeNode('trigger', 'trigger')], edges: [] });

function authored(): AuthoredState {
  let song: Song = { id: 'set-1', name: 'Set 1', sections: [makeSection('intro', 'Intro')] };
  song = addGraph(song, 'intro', 'kick:1');
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
    activeSectionId: 'intro',
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
      data: { selectedPadKey: null, activeSectionId: null },
    });
    expect(restored).toEqual({ selectedPadKey: null, activeSectionId: null });
  });
});

describe('U4 back-compat — activeSectionId / arrangeSectionId', () => {
  it('reads the legacy arrangeSectionId into activeSectionId when the new key is absent', () => {
    const restored = deserializeAuthored({ version: VERSION, data: { arrangeSectionId: 'verse' } });
    expect(restored).toEqual({ activeSectionId: 'verse' });
  });

  it('prefers the new activeSectionId over a legacy arrangeSectionId', () => {
    const restored = deserializeAuthored({
      version: VERSION,
      data: { activeSectionId: 'chorus', arrangeSectionId: 'verse' },
    });
    expect(restored).toEqual({ activeSectionId: 'chorus' });
  });

  it('honours an explicit null in the legacy field', () => {
    const restored = deserializeAuthored({ version: VERSION, data: { arrangeSectionId: null } });
    expect(restored).toEqual({ activeSectionId: null });
  });
});

describe('U4 back-compat — section slots → flat graphs migration', () => {
  it('flattens a persisted per-pad slot grid into a deduped, order-preserving graph list', () => {
    const section = {
      id: 'intro',
      name: 'Intro',
      slots: {
        'kick:0': ['kick:0', null],
        'snare:0': ['snare:0', 'snare:2', null], // snare:0 layers snare:2 (a foreign-pad graph)
        'snare:2': ['snare:2'], // snare:2's own graph — duplicate of the layer above, deduped
      },
    };
    expect(sectionGraphList(section)).toEqual(['kick:0', 'snare:0', 'snare:2']);
  });

  it('is idempotent — a section already on flat graphs is returned (deduped) untouched', () => {
    expect(sectionGraphList({ id: 'a', name: 'A', graphs: ['g1', 'g2', 'g1'] })).toEqual(['g1', 'g2']);
  });

  it('degrades a malformed section to an empty list', () => {
    expect(sectionGraphList(null)).toEqual([]);
    expect(sectionGraphList({ id: 'a', name: 'A' })).toEqual([]);
    expect(sectionGraphList({ id: 'a', name: 'A', slots: 'nope' })).toEqual([]);
  });

  it('migrateSongs flattens every section across every song', () => {
    const legacy = [
      {
        id: 'set-1',
        name: 'Set 1',
        sections: [
          { id: 'intro', name: 'Intro', slots: { 'kick:0': ['kick:0'], 'snare:0': ['snare:0', null] } },
          { id: 'verse', name: 'Verse', slots: { 'snare:0': ['snare:0', 'snare:2'] } },
        ],
      },
    ];
    expect(migrateSongs(legacy)).toEqual([
      {
        id: 'set-1',
        name: 'Set 1',
        sections: [
          { id: 'intro', name: 'Intro', graphs: ['kick:0', 'snare:0'] },
          { id: 'verse', name: 'Verse', graphs: ['snare:0', 'snare:2'] },
        ],
      },
    ]);
  });

  it('deserializeAuthored migrates a legacy slots blob end-to-end', () => {
    const restored = deserializeAuthored({
      version: VERSION,
      data: {
        songs: [
          { id: 's1', name: 'S1', sections: [{ id: 'a', name: 'A', slots: { 'kick:0': ['kick:0', null] } }] },
        ],
      },
    });
    expect(restored?.songs).toEqual([
      { id: 's1', name: 'S1', sections: [{ id: 'a', name: 'A', graphs: ['kick:0'] }] },
    ]);
  });
});

describe('storage key', () => {
  it('namespaces the schema version into the key', () => {
    expect(STORAGE_KEY).toContain('v1');
  });
});

// ---- show document model ----------------------------------------------------

function library(): ShowLibrary {
  return {
    shows: {
      a: { id: 'a', name: 'Main Set', authored: authored() },
      b: { id: 'b', name: 'B-sides', authored: { ...authored(), bpm: 90 } },
    },
    activeShowId: 'b',
  };
}

describe('show library — serialize / deserialize round-trip', () => {
  it('preserves every show + the active pointer through serialize → JSON → parse → deserialize', () => {
    const lib = library();
    const restored = deserializeShowLibrary(JSON.parse(JSON.stringify(serializeShowLibrary(lib))));
    expect(restored).toEqual(lib);
  });

  it('stamps the current SHOWS_VERSION into the envelope', () => {
    expect(serializeShowLibrary(library()).version).toBe(SHOWS_VERSION);
  });

  it('namespaces the schema version into the library key', () => {
    expect(SHOWS_STORAGE_KEY).toContain('v1');
  });
});

describe('show library — version gate + malformed tolerance', () => {
  it('returns null on a version mismatch (so a stale blob never wedges boot)', () => {
    const env = serializeShowLibrary(library());
    expect(deserializeShowLibrary({ ...env, version: SHOWS_VERSION + 1 })).toBeNull();
    expect(deserializeShowLibrary({ ...env, version: 0 })).toBeNull();
  });

  it('returns null for non-objects, a missing shows record, or zero surviving shows', () => {
    expect(deserializeShowLibrary(null)).toBeNull();
    expect(deserializeShowLibrary('nope')).toBeNull();
    expect(deserializeShowLibrary({ version: SHOWS_VERSION, data: {} })).toBeNull(); // no shows record
    expect(deserializeShowLibrary({ version: SHOWS_VERSION, data: { shows: {}, activeShowId: 'x' } })).toBeNull(); // empty
    expect(deserializeShowLibrary({ version: SHOWS_VERSION, data: { shows: { a: 42 }, activeShowId: 'a' } })).toBeNull(); // all malformed
  });

  it('drops a malformed show but keeps valid siblings', () => {
    const restored = deserializeShowLibrary({
      version: SHOWS_VERSION,
      data: { shows: { good: { id: 'good', name: 'G', authored: { bpm: 100 } }, bad: 42 }, activeShowId: 'good' },
    });
    expect(Object.keys(restored!.shows)).toEqual(['good']);
    expect(restored!.shows.good!.authored).toEqual({ bpm: 100 });
  });

  it('re-points a missing/dangling activeShowId to the first surviving show', () => {
    const restored = deserializeShowLibrary({
      version: SHOWS_VERSION,
      data: { shows: { only: { id: 'only', name: 'O', authored: {} } }, activeShowId: 'gone' },
    });
    expect(restored!.activeShowId).toBe('only');
  });

  it('coerces each show authored — defaults a missing name + migrates legacy section slots', () => {
    const restored = deserializeShowLibrary({
      version: SHOWS_VERSION,
      data: {
        shows: {
          s: {
            id: 's',
            authored: {
              songs: [{ id: 's1', name: 'S1', sections: [{ id: 'a', name: 'A', slots: { 'kick:0': ['kick:0', null] } }] }],
            },
          },
        },
        activeShowId: 's',
      },
    });
    expect(restored!.shows.s!.name).toBe('Untitled Show'); // missing name defaulted
    expect(restored!.shows.s!.authored.songs).toEqual([
      { id: 's1', name: 'S1', sections: [{ id: 'a', name: 'A', graphs: ['kick:0'] }] }, // slots → flat graphs, per show
    ]);
  });
});

describe('loadShowLibrary — boot migration', () => {
  it('wraps a legacy single AuthoredState blob as one active "Default Show"', () => {
    const single = serializeAuthored(authored());
    const lib = loadShowLibrary(null, single, () => 'show-1');
    expect(Object.keys(lib.shows)).toEqual(['show-1']);
    expect(lib.activeShowId).toBe('show-1');
    expect(lib.shows['show-1']!.name).toBe('Default Show');
    expect(lib.shows['show-1']!.authored).toEqual(authored()); // full authored carried through
  });

  it('is idempotent — once a library exists it wins; the single blob + newId are ignored', () => {
    const single = serializeAuthored(authored());
    const first = loadShowLibrary(null, single, () => 'show-1');
    const again = loadShowLibrary(serializeShowLibrary(first), single, () => 'show-2'); // would mint 'show-2' if re-wrapped
    expect(again).toEqual(first); // same ids + content, no re-wrap
  });

  it('seeds a fresh active "Untitled Show" with empty authored when neither blob exists', () => {
    const lib = loadShowLibrary(null, null, () => 'show-1');
    expect(Object.keys(lib.shows)).toEqual(['show-1']);
    expect(lib.shows['show-1']!.name).toBe('Untitled Show');
    expect(lib.shows['show-1']!.authored).toEqual({});
    expect(lib.activeShowId).toBe('show-1');
  });

  it('falls back to a fresh library on malformed blobs (never throws)', () => {
    const lib = loadShowLibrary({ junk: true }, { also: 'junk' }, () => 'show-1');
    expect(Object.keys(lib.shows)).toEqual(['show-1']);
    expect(lib.shows['show-1']!.name).toBe('Untitled Show');
  });

  it('migrates a legacy single blob carrying pre-U4 section slots into the wrapped show', () => {
    const single = {
      version: VERSION,
      data: { songs: [{ id: 's1', name: 'S1', sections: [{ id: 'a', name: 'A', slots: { 'kick:0': ['kick:0', null] } }] }] },
    };
    const lib = loadShowLibrary(null, single, () => 'show-1');
    expect(lib.shows['show-1']!.authored.songs).toEqual([
      { id: 's1', name: 'S1', sections: [{ id: 'a', name: 'A', graphs: ['kick:0'] }] },
    ]);
  });
});

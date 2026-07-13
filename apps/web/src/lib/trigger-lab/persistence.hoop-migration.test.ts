import { describe, expect, it } from 'vitest';
import { voice } from '@ledrums/core';
import {
  AUTHORED_PRIOR_VERSION,
  SHOWS_PRIOR_VERSION,
  SHOWS_VERSION,
  VERSION,
  deserializeAuthored,
  deserializeShowLibrary,
  loadShowLibrary,
  migrateAuthoredHoopTargets,
  serializeAuthored,
  serializeShowLibrary,
  shiftHoopTargetTo1Based,
  type AuthoredState,
} from './persistence';
import { makeNode, type GraphNode, type TriggerGraph } from './sim';

/* B6 — a pre-A1 authored show carries 0-based hoop targetIds ("kick#0"). A1 made hoop indexing
   1-based, so those targets now resolve to nothing under the compositor grammar. These tests prove
   the show-schema migrator shifts them +1 on load (so the SAME physical hoop lights) and is
   idempotent (a re-saved v2 blob is never shifted again). */

// Compositor resolve options — the strict grammar the render/output path uses (A1 filters index >= 1).
const COMPOSITOR = { sourceDrumOnNoHash: false, emptyFallback: 'sentinel', sort: true } as const;
const resolve = (targetId: string) => voice.parseHoopTarget(targetId, 'kick', COMPOSITOR).hoopIndices;

function hoopGraph(targetId: string): TriggerGraph {
  return { nodes: [makeNode('effect', 'fx', 0, 0, { scope: 'hoop', targetId })], edges: [] };
}
const targetIdOf = (g: TriggerGraph | undefined): string | undefined => (g?.nodes[0] as GraphNode | undefined)?.targetId;

function authoredWithHoop(targetId: string): AuthoredState {
  return {
    graphs: { fx: hoopGraph(targetId) },
    graphNames: {},
    songs: [],
    buses: [],
    presets: [],
    effects: [],
    selectedPadKey: null,
    activeSongId: '',
    activeSectionId: null,
    bpm: 120,
    velocity: 0.7,
    beatsPerBar: 4,
  };
}

describe('shiftHoopTargetTo1Based — pure +1 shift', () => {
  it('shifts each hoop index +1, preserving drum id and order', () => {
    expect(shiftHoopTargetTo1Based('kick#0')).toBe('kick#1');
    expect(shiftHoopTargetTo1Based('snare#0,2,1')).toBe('snare#1,3,2');
  });
  it('leaves a drum/kit target (no #) untouched', () => {
    expect(shiftHoopTargetTo1Based('kick')).toBe('kick');
    expect(shiftHoopTargetTo1Based('')).toBe('');
  });
  it('drops non-integer index tokens (never valid pixel refs)', () => {
    expect(shiftHoopTargetTo1Based('kick#0,foo,1.5')).toBe('kick#1');
  });
});

describe('migrateAuthoredHoopTargets — only hoop-scoped nodes with an explicit #index', () => {
  it('leaves drum-scoped and kit-scoped nodes alone', () => {
    const graphs = {
      d: { nodes: [makeNode('effect', 'd', 0, 0, { scope: 'drum', targetId: 'kick' })], edges: [] },
      k: { nodes: [makeNode('effect', 'k', 0, 0, { scope: 'kit' })], edges: [] },
    };
    const out = migrateAuthoredHoopTargets({ graphs });
    expect(targetIdOf(out.graphs?.d)).toBe('kick'); // drum targetId (bare drumId) unchanged
    expect(out.graphs?.k?.nodes[0]?.targetId).toBeUndefined();
  });
  it('is a no-op for a slice with no graphs', () => {
    const slice = { bpm: 120 };
    expect(migrateAuthoredHoopTargets(slice)).toBe(slice);
  });
});

describe('deserializeAuthored — v1 hoop targetIds migrate to 1-based; v2 untouched', () => {
  it('a pre-A1 (v1) hoop clip loads shifted so it lights the SAME physical hoop', () => {
    // Under the A1 compositor grammar the pre-A1 target is broken; the migrated one resolves.
    expect(resolve('kick#0')).toEqual([-1]); // 0 dropped (< 1) → sentinel: lights nothing
    const restored = deserializeAuthored({ version: AUTHORED_PRIOR_VERSION, data: authoredWithHoop('kick#0') });
    expect(targetIdOf(restored?.graphs?.fx)).toBe('kick#1');
    expect(resolve('kick#1')).toEqual([1]); // the first physical hoop — same one "kick#0" meant pre-A1
  });

  it('a current (v2) blob is NOT shifted (idempotent — no double shift on reload)', () => {
    const restored = deserializeAuthored({ version: VERSION, data: authoredWithHoop('kick#1') });
    expect(targetIdOf(restored?.graphs?.fx)).toBe('kick#1');
  });

  it('re-serializing a migrated slice stamps v2, so a second load is a no-op', () => {
    const once = deserializeAuthored({ version: AUTHORED_PRIOR_VERSION, data: authoredWithHoop('kick#0') })!;
    const twice = deserializeAuthored(JSON.parse(JSON.stringify(serializeAuthored(once as AuthoredState))));
    expect(targetIdOf(twice?.graphs?.fx)).toBe('kick#1'); // shifted exactly once, end to end
  });

  it('still rejects an unknown/newer version', () => {
    expect(deserializeAuthored({ version: VERSION + 1, data: authoredWithHoop('kick#0') })).toBeNull();
    expect(deserializeAuthored({ version: 0, data: authoredWithHoop('kick#0') })).toBeNull();
  });
});

describe('deserializeShowLibrary — v1 library migrates every show; v2 untouched', () => {
  const libraryAt = (version: number, targetId: string) => ({
    version,
    data: { shows: { s1: { id: 's1', name: 'Show', authored: authoredWithHoop(targetId) } }, activeShowId: 's1' },
  });

  it('shifts a pre-A1 (v1) library show +1', () => {
    const lib = deserializeShowLibrary(libraryAt(SHOWS_PRIOR_VERSION, 'kick#0'));
    expect(targetIdOf(lib?.shows.s1?.authored.graphs.fx)).toBe('kick#1');
  });

  it('leaves a current (v2) library show alone', () => {
    const lib = deserializeShowLibrary(libraryAt(SHOWS_VERSION, 'kick#1'));
    expect(targetIdOf(lib?.shows.s1?.authored.graphs.fx)).toBe('kick#1');
  });

  it('re-saving a migrated v1 library and reloading it shifts exactly once', () => {
    const once = deserializeShowLibrary(libraryAt(SHOWS_PRIOR_VERSION, 'kick#0'))!;
    const twice = deserializeShowLibrary(JSON.parse(JSON.stringify(serializeShowLibrary(once))));
    expect(targetIdOf(twice?.shows.s1?.authored.graphs.fx)).toBe('kick#1');
  });

  it('still rejects a newer library version', () => {
    expect(deserializeShowLibrary(libraryAt(SHOWS_VERSION + 1, 'kick#0'))).toBeNull();
  });
});

describe('loadShowLibrary — legacy single-blob path migrates too', () => {
  it('wraps a pre-A1 (v1) single blob as the Default Show with hoop targets shifted', () => {
    const single = { version: AUTHORED_PRIOR_VERSION, data: authoredWithHoop('kick#0') };
    const lib = loadShowLibrary(null, single, () => 'new-1');
    expect(lib.activeShowId).toBe('new-1');
    expect(targetIdOf(lib.shows['new-1']?.authored.graphs.fx)).toBe('kick#1');
  });
});

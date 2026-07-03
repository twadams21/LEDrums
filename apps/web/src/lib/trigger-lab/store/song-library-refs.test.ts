import { describe, it, expect } from 'vitest';
import {
  resolveSongRefs,
  detachLibrarySong,
  withLibrarySong,
  renameLibrarySongIn,
  removeLibrarySong,
  addSongRef,
  removeSongRef,
  showsUsingSong,
  planDeleteLibrarySong,
  type ResolvableView,
  type RefBearingShow,
} from './song-library-refs';
import { extractSongClosure, songNamespace, type ClosureSources, type LibrarySong } from './song-library';
import { makeNode } from '../sim.graph-compilation';
import type { EffectDef, Preset, TriggerGraph } from '../sim';
import { makeSection, makeSong, type Song } from '../../app/setlist';
import type { SongLibrary } from '../persistence';

// ---- fixtures (mirror song-library.test.ts) ---------------------------------

const effect = (id: string): EffectDef => ({
  id,
  name: id,
  pattern: 'flash',
  busId: 'base',
  scope: 'kit',
  params: [],
  attackMs: 0,
  sustainMs: 0,
  releaseMs: 0,
});

const preset = (id: string, effectId: string): Preset => ({ id, name: id, effectId, params: {} });

const playGraph = (effectId: string, presetId: string): TriggerGraph => ({
  nodes: [
    makeNode('trigger', 'trigger', 0, 0),
    makeNode('play', 'p1', 0, 0, { kind: 'play', effectId, presetId, params: { hue: 0.5 } }),
  ],
  edges: [{ id: 'e1', from: 'trigger', to: 'p1' }],
});

/** A one-graph, one-look source show + the song that reaches it. `busA` gets a look (fx2:default). */
function buildSource(): { song: Song; sources: ClosureSources } {
  const sources: ClosureSources = {
    graphs: { 'kick:center': playGraph('fx1', 'fx1:snap'), unused: playGraph('fxZ', 'fxZ:default') },
    graphNames: { 'kick:center': 'Kick center' },
    effects: [effect('fx1'), effect('fx2'), effect('fxZ')],
    presets: [preset('fx1:snap', 'fx1'), preset('fx2:default', 'fx2'), preset('fxZ:default', 'fxZ')],
  };
  const song = makeSong('song-src', 'My Song', [makeSection('sec-1', 'Intro', ['kick:center'], { busA: 'fx2' })]);
  return { song, sources };
}

/** Extract `buildSource`'s song into a library closure under `libId`. */
function libraryOf(libId = 'lib-1'): { closure: LibrarySong; library: SongLibrary } {
  const { song, sources } = buildSource();
  const closure = extractSongClosure(song, sources, libId);
  return { closure, library: { songs: { [libId]: closure } } };
}

const emptyView = (): ResolvableView => ({ songs: [], graphs: {}, graphNames: {}, effects: [], presets: [] });

/** A resolved view is renderable when every section graph ref resolves to a present graph, and
    every play node's effect/preset resolves to a present def — the structural "render parity". */
function assertRenderable(view: ResolvableView): void {
  const effectIds = new Set(view.effects.map((e) => e.id));
  const presetIds = new Set(view.presets.map((p) => p.id));
  for (const song of view.songs) {
    for (const sec of song.sections) {
      for (const key of sec.graphs) expect(view.graphs[key], `graph ${key}`).toBeDefined();
      for (const effectId of Object.values(sec.looks)) if (effectId) expect(effectIds.has(effectId)).toBe(true);
    }
  }
  for (const g of Object.values(view.graphs)) {
    for (const n of g.nodes) {
      if (n.kind !== 'play') continue;
      if (n.effectId) expect(effectIds.has(n.effectId), `effect ${n.effectId}`).toBe(true);
      if (n.presetId) expect(presetIds.has(n.presetId), `preset ${n.presetId}`).toBe(true);
    }
  }
}

// ---- resolve ----------------------------------------------------------------

describe('resolveSongRefs — import → resolve → render parity', () => {
  it('materializes a referenced closure into an internally consistent (renderable) view', () => {
    const { library } = libraryOf();
    const view = resolveSongRefs(emptyView(), ['lib-1'], library);

    // the referenced song appears; its content is present + consistent
    expect(view.songs.map((s) => s.id)).toEqual(['lib-1']);
    assertRenderable(view);

    // parity: exactly the reached graph is materialized (the source's `unused` graph is NOT in the
    // closure), namespaced under the per-song prefix
    const ns = songNamespace('lib-1');
    expect(Object.keys(view.graphs)).toEqual([`${ns}kick:center`]);
    expect(view.graphNames[`${ns}kick:center`]).toBe('Kick center');
    // reached effects: play node fx1 + look fx2 (not fxZ — never reached)
    expect(view.effects.map((e) => e.id).sort()).toEqual([`${ns}fx1`, `${ns}fx2`]);
    // reached presets: play preset fx1:snap + look seed fx2:default
    expect(view.presets.map((p) => p.id).sort()).toEqual([`${ns}fx1:snap`, `${ns}fx2:default`]);
  });

  it('preserves the base view and unions collision-free across two references', () => {
    const a = extractSongClosure(...srcArgs('lib-a'));
    const b = extractSongClosure(...srcArgs('lib-b'));
    const library: SongLibrary = { songs: { 'lib-a': a, 'lib-b': b } };
    const base: ResolvableView = { ...emptyView(), effects: [effect('local-fx')], songs: [makeSong('local', 'Local')] };

    const view = resolveSongRefs(base, ['lib-a', 'lib-b'], library);
    expect(view.songs.map((s) => s.id)).toEqual(['local', 'lib-a', 'lib-b']); // base first, then refs in order
    expect(view.effects.some((e) => e.id === 'local-fx')).toBe(true); // base kept
    // the two closures' graph keys are disjoint (per-song namespace), so both survive the union
    expect(Object.keys(view.graphs)).toEqual([`${songNamespace('lib-a')}kick:center`, `${songNamespace('lib-b')}kick:center`]);
    assertRenderable(view);

    // base arrays are not mutated
    expect(base.effects).toHaveLength(1);
    expect(base.songs).toHaveLength(1);
  });

  it('skips a dangling or duplicate reference (faithful, idempotent)', () => {
    const { library } = libraryOf();
    const view = resolveSongRefs(emptyView(), ['missing', 'lib-1', 'lib-1'], library);
    expect(view.songs.map((s) => s.id)).toEqual(['lib-1']); // missing skipped, dup not doubled
  });
});

/** extractSongClosure args for a fresh source under `libId` (spread into the call). */
function srcArgs(libId: string): [Song, ClosureSources, string] {
  const { song, sources } = buildSource();
  return [song, sources, libId];
}

// ---- canonical propagation --------------------------------------------------

describe('resolveSongRefs — canonical propagation', () => {
  it('an edit to the library song shows up in every referencing show’s resolved view', () => {
    const { closure, library } = libraryOf();
    const ns = songNamespace('lib-1');

    // two different shows both reference lib-1
    const showA = resolveSongRefs({ ...emptyView(), songs: [makeSong('a', 'A')] }, ['lib-1'], library);
    const showB = resolveSongRefs({ ...emptyView(), songs: [makeSong('b', 'B')] }, ['lib-1'], library);
    expect(showA.effects.find((e) => e.id === `${ns}fx1`)!.name).toBe('fx1');
    expect(showB.effects.find((e) => e.id === `${ns}fx1`)!.name).toBe('fx1');

    // edit the ONE library copy (rename its fx1 effect) — the canonical source
    const edited: LibrarySong = {
      ...closure,
      effects: closure.effects.map((e) => (e.id === `${ns}fx1` ? { ...e, name: 'RENAMED' } : e)),
    };
    const library2: SongLibrary = { songs: { 'lib-1': edited } };

    // both shows' resolved views reflect it (they share the library copy, hold no copy of their own)
    expect(resolveSongRefs(emptyView(), ['lib-1'], library2).effects.find((e) => e.id === `${ns}fx1`)!.name).toBe('RENAMED');
    expect(resolveSongRefs({ ...emptyView(), songs: [makeSong('b', 'B')] }, ['lib-1'], library2)
      .effects.find((e) => e.id === `${ns}fx1`)!.name).toBe('RENAMED');
  });
});

// ---- detach -----------------------------------------------------------------

describe('detachLibrarySong — clone to a fresh namespace, sever propagation', () => {
  it('re-keys the closure under a fresh namespace and stays renderable', () => {
    const { closure } = libraryOf();
    const detached = detachLibrarySong(closure, 'song-local');
    const newNs = songNamespace('song-local');

    expect(detached.song.id).toBe('song-local');
    expect(Object.keys(detached.graphs)).toEqual([`${newNs}kick:center`]);
    expect(detached.effects.map((e) => e.id).sort()).toEqual([`${newNs}fx1`, `${newNs}fx2`]);
    // as a resolvable view it is internally consistent
    const view: ResolvableView = { songs: [detached.song], graphs: detached.graphs, graphNames: detached.graphNames, effects: detached.effects, presets: detached.presets };
    assertRenderable(view);
    // the section's look effect was re-based too
    expect(detached.song.sections[0]!.looks.busA).toBe(`${newNs}fx2`);
  });

  it('isolates: editing the detached copy never touches the library song (deep-copied)', () => {
    const { closure } = libraryOf();
    const detached = detachLibrarySong(closure, 'song-local');

    // mutate the detached graph node params
    detached.graphs[`${songNamespace('song-local')}kick:center`]!.nodes.find((n) => n.kind === 'play')!.params!.hue = 0.99;
    detached.effects[0]!.name = 'changed';

    // the library closure is untouched
    const libPlay = closure.graphs[`${songNamespace('lib-1')}kick:center`]!.nodes.find((n) => n.kind === 'play')!;
    expect(libPlay.params!.hue).toBe(0.5);
    expect(closure.effects.every((e) => e.name !== 'changed')).toBe(true);
  });
});

// ---- library CRUD + ref-list edits ------------------------------------------

describe('library CRUD + ref-list edits', () => {
  it('withLibrarySong inserts/replaces; renameLibrarySongIn renames + guards; removeLibrarySong drops', () => {
    const { closure } = libraryOf();
    let lib: SongLibrary = { songs: {} };
    lib = withLibrarySong(lib, closure);
    expect(lib.songs['lib-1']).toBe(closure);

    lib = renameLibrarySongIn(lib, 'lib-1', '  New Name  ');
    expect(lib.songs['lib-1']!.name).toBe('New Name'); // trimmed
    expect(renameLibrarySongIn(lib, 'lib-1', '   ')).toBe(lib); // blank → same ref
    expect(renameLibrarySongIn(lib, 'nope', 'x')).toBe(lib); // unknown → same ref

    const removed = removeLibrarySong(lib, 'lib-1');
    expect(removed.songs['lib-1']).toBeUndefined();
    expect(removeLibrarySong(lib, 'nope')).toBe(lib); // unknown → same ref
  });

  it('addSongRef is set-like + idempotent; removeSongRef drops', () => {
    expect(addSongRef([], 'a')).toEqual(['a']);
    const refs = ['a'];
    expect(addSongRef(refs, 'a')).toBe(refs); // already present → same ref
    expect(addSongRef(refs, 'b')).toEqual(['a', 'b']);
    expect(removeSongRef(['a', 'b'], 'a')).toEqual(['b']);
    const r2 = ['a'];
    expect(removeSongRef(r2, 'z')).toBe(r2); // absent → same ref
  });
});

// ---- delete guard -----------------------------------------------------------

describe('planDeleteLibrarySong — blocked while referenced', () => {
  const shows: RefBearingShow[] = [
    { id: 'showA', name: 'Show A', songRefs: ['lib-1'] },
    { id: 'showB', name: 'Show B', songRefs: [] },
    { id: 'showC', name: 'Show C', songRefs: ['lib-1', 'lib-9'] },
  ];

  it('reports the using shows and blocks deletion', () => {
    const { library } = libraryOf();
    const plan = planDeleteLibrarySong(library, shows, 'lib-1');
    expect(plan.kind).toBe('blocked');
    if (plan.kind === 'blocked') {
      expect(plan.usedBy).toEqual([{ id: 'showA', name: 'Show A' }, { id: 'showC', name: 'Show C' }]);
    }
    // nothing removed
    expect(library.songs['lib-1']).toBeDefined();
  });

  it('removes when no show references it', () => {
    const { library } = libraryOf();
    const plan = planDeleteLibrarySong(library, [{ id: 'showB', name: 'Show B', songRefs: [] }], 'lib-1');
    expect(plan.kind).toBe('remove');
    if (plan.kind === 'remove') expect(plan.library.songs['lib-1']).toBeUndefined();
  });

  it('showsUsingSong lists the referencing shows in order', () => {
    expect(showsUsingSong(shows, 'lib-1')).toEqual([{ id: 'showA', name: 'Show A' }, { id: 'showC', name: 'Show C' }]);
    expect(showsUsingSong(shows, 'lib-unused')).toEqual([]);
  });
});

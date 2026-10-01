/* show-builder, v3 (effect chains) path: a v3 authored source → the runtime Show through core
   `effectChain.buildRuntimeShow` — the same builder the server's cold-start restore projects
   from the persisted blob. The graph-era v2 path is covered by show-builder.test.ts. */
import { describe, expect, it } from 'vitest';
import {
  buildPixelModel,
  canvasEffectId,
  effectChain,
  parseKit,
  SHOWS_VERSION_EFFECTS,
  SONGS_VERSION_EFFECTS,
  voice,
  type CanvasScene,
} from '@ledrums/core';
import { buildEffectsShow, buildShow, type EffectsShowSource } from './show-builder';

const solid = (id: string, row: string, column: effectChain.EffectColumn, color = '#ffffff'): effectChain.Effect =>
  effectChain.parseEffect({
    id,
    cell: { row, column },
    generator: { kind: 'solid', style: 'solid', params: { color } },
    amp: { attackMs: 0, length: { ms: 2000 }, releaseMs: 100 },
  });

const scene = (id: string, name = id): CanvasScene => ({
  id,
  name,
  sampler: { kind: 'cylinder' },
  lenses: [],
  elements: [],
});

/** An own song (zone + Always Effects, a master Strobe), a referenced library song, and scenes. */
function source(): EffectsShowSource {
  return {
    format: 'effects',
    songs: [{
      id: 'own', name: 'Own',
      sections: [{
        id: 'verse', name: 'Verse', bars: 8,
        effects: [
          solid('kick-hit', 'kick', { kind: 'zone', slot: 0 }),
          solid('wash', 'kit', { kind: 'always' }, '#0000ff'),
        ],
        master: [{ uid: 'm1', modifierId: 'strobe', params: {}, mix: 1, bypass: false }],
      }],
    }],
    songRefs: ['shared', 'missing'],
    canvasScenes: [scene('mine')],
    songLibrary: {
      shared: {
        id: 'shared', name: 'Shared',
        sections: [{ id: 'lib:shared/chorus', name: 'Chorus', effects: [solid('lib-snare', 'snare', { kind: 'zone', slot: 0 })], master: [] }],
        canvasScenes: [scene('lib:shared/sky')],
      },
    },
  };
}

describe('buildShow — v3 effect-chain source', () => {
  it('builds exactly the Show core builds from the equivalent persisted libraries (server parity)', () => {
    const src = source();
    // The persisted blobs the server restores from: the same show + song library, as envelopes.
    const showLibrary = {
      version: SHOWS_VERSION_EFFECTS,
      data: {
        activeShowId: 'show-1',
        shows: { 'show-1': { id: 'show-1', name: 'Show', authored: { songs: src.songs, songRefs: src.songRefs, canvasScenes: src.canvasScenes } } },
      },
    };
    const songLibrary = { version: SONGS_VERSION_EFFECTS, data: { songs: src.songLibrary } };
    const server = effectChain.buildRuntimeShow(
      effectChain.parseShowLibraryV3(showLibrary),
      effectChain.parseSongLibraryV2(songLibrary),
    ).show;

    expect(buildShow(src)).toEqual(server);
  });

  it('carries own then referenced songs with their effects and master chain; no graph containers', () => {
    const show = buildShow(source());

    expect(show.songs!.map((s) => [s.id, s.sections.map((sec) => sec.id)])).toEqual([
      ['own', ['verse']],
      ['shared', ['lib:shared/chorus']],
    ]);
    const verse = show.songs![0]!.sections[0]!;
    expect(verse.effects?.map((e) => e.id)).toEqual(['kick-hit', 'wash']);
    expect(verse.master?.map((m) => m.modifierId)).toEqual(['strobe']);
    expect(show.graphs).toEqual({});
    expect(show.buses).toEqual([]);
    expect(show.sections).toEqual([]);
    // Scenes: the show's, then the library song's; each gets its virtual canvas EffectDef.
    expect(show.canvasScenes?.map((s) => s.id)).toEqual(['mine', 'lib:shared/sky']);
    expect(show.effects.map((e) => e.id)).toEqual(expect.arrayContaining([canvasEffectId('mine'), canvasEffectId('lib:shared/sky')]));
  });

  it('builds without a song library: referenced songs resolve to nothing', () => {
    const show = buildShow({ ...source(), songLibrary: null });
    expect(show.songs!.map((s) => s.id)).toEqual(['own']);
  });

  it('drops an invalid Effect and reports it, keeping the rest of the section', () => {
    const src = source();
    const broken = { id: 'broken', cell: { row: 'kit', column: { kind: 'nope' } }, generator: { kind: 'solid' } };
    const verse = src.songs[0]!.sections[0]!;
    const withBroken: EffectsShowSource = {
      ...src,
      songs: [{ ...src.songs[0]!, sections: [{ ...verse, effects: [...verse.effects, broken as unknown as effectChain.Effect] }] }],
    };

    const { show, diagnostics } = buildEffectsShow(withBroken);

    expect(show.songs![0]!.sections[0]!.effects?.map((e) => e.id)).toEqual(['kick-hit', 'wash']);
    expect(diagnostics).toEqual([expect.objectContaining({ kind: 'invalid-effect', songId: 'own', sectionId: 'verse', index: 2, id: 'broken' })]);
  });

  it('throws on a structurally unusable source (a section without an id)', () => {
    const src = source();
    const bad = { ...src, songs: [{ ...src.songs[0]!, sections: [{ ...src.songs[0]!.sections[0]!, id: '' }] }] };
    expect(() => buildShow(bad)).toThrow(/show library v3/);
  });

  it('accepts a proxied (live-store) source and never aliases it', () => {
    const src = source();
    // Svelte `$state` hands the builder Proxies, which structuredClone (inside core) rejects.
    const deepProxy = <T>(value: T): T => (value && typeof value === 'object'
      ? new Proxy(value as object, { get: (t, k) => deepProxy(Reflect.get(t, k)) }) as T
      : value);
    const proxied = deepProxy(src);
    expect(() => structuredClone(proxied.canvasScenes[0])).toThrow(); // the hazard is real
    const show = buildShow(proxied);

    show.songs![0]!.sections[0]!.effects![0]!.name = 'mutated';
    show.canvasScenes![0]!.name = 'mutated';
    expect(src.songs[0]!.sections[0]!.effects[0]!.name).not.toBe('mutated');
    expect(src.canvasScenes[0]!.name).toBe('mine');
  });

  it('the built Show plays in the voice engine: a kick zone-0 hit lights the kick', () => {
    const src: EffectsShowSource = {
      format: 'effects',
      songs: [{ id: 'own', name: 'Own', sections: [{ id: 'verse', name: 'Verse', effects: [solid('kick-hit', 'kick', { kind: 'zone', slot: 0 })], master: [] }] }],
      songRefs: [],
      canvasScenes: [],
    };
    const model = buildPixelModel(parseKit({
      global: { ledDensityPxPerM: 30, hoopCount: 2, defaultHoopSpacingMm: 50 },
      drums: ['kick', 'snare'].map((id, i) => ({
        id, diameterIn: 12, hoopSpacingMm: 50, origin: { x: i * 400, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 },
      })),
    }));
    const engine = voice.createVoiceBusEngine();
    engine.setModel(model);
    engine.setShow(buildShow(src));
    const transport = { timeMs: 0, beat: 0, bar: 0, beatInBar: 0, bpm: 120, beatsPerBar: 4, playing: true };
    const lit = (drumId: string): number => {
      const d = model.drumById.get(drumId)!;
      const frame = engine.frame();
      let sum = 0;
      for (let i = d.pixelStart; i < d.pixelStart + d.pixelCount; i++) sum += frame[i * 4]!;
      return sum;
    };

    engine.applyInput({ kind: 'recallSection', songId: 'own', sectionId: 'verse', timeMs: 0 });
    engine.tick(0, 0, transport);
    engine.applyInput({ kind: 'noteOn', drumId: 'kick', zone: '0', velocity: 1, timeMs: 0 });
    for (let t = 10; t <= 50; t += 10) engine.tick(t, 10, { ...transport, timeMs: t });

    expect(lit('kick')).toBeGreaterThan(0);
    expect(lit('snare')).toBe(0);
  });
});

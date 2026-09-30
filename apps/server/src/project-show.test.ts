import { describe, expect, it } from 'vitest';
import { selectionFromLibrary, showFromLibraries } from './project-show';
import { defaultProject, type CanvasScene } from '@ledrums/core';
import { VoiceEngineHost } from './voice-engine-host';

describe('persisted library → runtime Show restore boundary', () => {
  it('restores canvas CC brightness through the real host: CC 0 is dark, CC 127 is lit', async () => {
    const scene: CanvasScene = { id: 'restore-cc', name: 'CC canvas', sampler: { kind: 'cylinder' }, lenses: [],
      elements: [{ kind: 'stripes', angleDeg: 0, widthU: 1, duty: 1, speedUps: 0, hue: 0, sat: 1, softness: 0 }] };
    // A looping Scene Cue on note 70 whose brightness follows CC 1.
    const effect = {
      id: 'canvas', cell: { row: 'kit', column: { kind: 'cue' } }, trigger: { kind: 'cue', source: { midiNote: 70 } },
      generator: { kind: 'scene', params: { sceneId: 'restore-cc' } }, amp: { attackMs: 0, length: 'loop' },
      controls: [{ uid: 'cc', kind: 'cc', settings: { controller: 1 }, mappings: [{ device: 'generator', param: 'brightness', rangeMin: 0, rangeMax: 1 }] }],
    };
    const library = { version: 3, data: { activeShowId: 'show', shows: { show: { authored: {
      songs: [{ id: 'song', name: 'Song', sections: [{ id: 's', name: 'S', effects: [effect], master: [] }] }],
      canvasScenes: [scene],
    } } } } };
    const show = showFromLibraries(library, null)!;
    const project = defaultProject(); project.output.state = 'disabled';
    const host = new VoiceEngineHost(project);
    host.setShow(show);
    try {
      host.applyInput({ kind: 'cc', controller: 1, value: 0 });
      host.applyInput({ kind: 'noteOn', note: 70, velocity: 1 });
      for (let i = 0; i < 180; i++) host.step(5);
      const peak = () => Math.max(...host.engine.frame().filter((_, i) => i % 4 !== 3));
      expect(host.getStats().engine.voiceCount).toBe(1);
      expect(peak()).toBe(0);
      host.applyInput({ kind: 'cc', controller: 1, value: 127 }); host.step(5);
      expect(peak()).toBeGreaterThan(0.9);
    } finally { await host.stop(); }
  });

  it.each([undefined, 0, 1, 4, 2.5, NaN, Infinity, '2', '3'])('rejects unsupported show version %s even for an empty library', (version) => {
    expect(() => showFromLibraries({ version, data: { shows: {} } }, null)).toThrow(/Unsupported show library version/);
  });
  it.each([undefined, 0, 3, 1.5, NaN, Infinity, '1', '2'])('rejects unsupported song version %s even without a show', (version) => {
    expect(() => showFromLibraries(null, { version, data: { songs: {} } })).toThrow(/Unsupported song library version/);
  });
  it('stores an archived graph-model (v2) library but never runs it: no Show, no selection', () => {
    const graphModel = { version: 2, data: { activeShowId: 'show', shows: { show: { authored: {
      graphs: { g: { version: 3, nodes: [], edges: [] } }, songs: [{ id: 'song', name: 'Song', sections: [] }],
      activeSongId: 'song', activeSectionId: null,
    } } } } };
    const before = structuredClone(graphModel);
    expect(showFromLibraries(graphModel, { version: 1, data: { songs: {} } })).toBeNull();
    expect(selectionFromLibrary(graphModel)).toBeUndefined();
    // Even a malformed archive is not parsed: the server keeps it, the web import reads it.
    expect(showFromLibraries({ version: 2, data: 'invalid' }, null)).toBeNull();
    expect(graphModel).toEqual(before);
    // The v1 format (0-based hoop ids) is still refused outright.
    expect(() => showFromLibraries({ ...graphModel, version: 1 }, null)).toThrow(/Unsupported show library version/);
  });

  it('preserves a persisted zero-section active selection through restore', async () => {
    const showLibrary = { version: 3, data: { activeShowId: 'show', shows: { show: { authored: {
      songs: [{ id: 'empty-song', name: 'Empty', sections: [] }],
      activeSongId: 'empty-song', activeSectionId: null,
    } } } } };
    const selection = selectionFromLibrary(showLibrary);
    expect(selection).toEqual({ songId: 'empty-song', sectionId: null });

    const project = defaultProject();
    project.output.state = 'disabled';
    const host = new VoiceEngineHost(project);
    const stage = host.prepareProject(project, showFromLibraries(showLibrary, null), selection);
    stage.commit();
    try {
      host.step(1000 / 120);
      expect(host.getActiveSelection()).toEqual({ activeSongId: 'empty-song', activeSectionId: null });
    } finally { await host.stop(); }
  });
  it('null means no show', () => {
    expect(showFromLibraries(null, null)).toBeNull();
  });

  describe('v3 (effect chains) restore', () => {
    const zoneEffect = (id: string, row: string, slot: number) => ({
      id, cell: { row, column: { kind: 'zone', slot } },
      generator: { kind: 'solid' }, amp: { attackMs: 0, length: { ms: 1000 } },
    });
    const v3 = (effects: unknown[], extra: Record<string, unknown> = {}) => ({ version: 3, data: { activeShowId: 'show', shows: { show: { authored: {
      songs: [{ id: 'song', name: 'Song', sections: [
        { id: 'a', name: 'A', effects, master: [] },
        { id: 'b', name: 'B', effects: [zoneEffect('other', 'snare', 0)], master: [] },
      ] }],
      activeSongId: 'song', activeSectionId: 'a', ...extra,
    } } } } });

    it('restores a v3 library into a running engine: a zone hit renders its Effect', async () => {
      const showLibrary = v3([zoneEffect('kick-hit', 'kick', 0)]);
      const project = defaultProject(); project.output.state = 'disabled';
      const host = new VoiceEngineHost(project);
      host.prepareProject(project, showFromLibraries(showLibrary, null), selectionFromLibrary(showLibrary)).commit();
      try {
        const lit = () => host.engine.frame().some((v, i) => i % 4 !== 3 && v > 0);
        for (let i = 0; i < 4; i++) host.step(5);
        expect(lit()).toBe(false);
        host.applyInput({ kind: 'key', drumId: 'kick', zone: '0', velocity: 1 });
        for (let i = 0; i < 4; i++) host.step(5);
        expect(host.getStats().engine.voiceCount).toBe(1);
        expect(lit()).toBe(true);
      } finally { await host.stop(); }
    });

    it('drops an invalid Effect through the diagnostic sink and keeps the rest', () => {
      const reported: unknown[] = [];
      const showLibrary = v3([{ id: 'bad', cell: { row: 'kit', column: { kind: 'zone', slot: 0 } }, generator: { kind: 'solid' } }, zoneEffect('ok', 'kick', 0)]);
      const runtime = showFromLibraries(showLibrary, null, (d) => reported.push(...d))!;
      expect(runtime.songs![0]!.sections[0]!.effects!.map((e) => e.id)).toEqual(['ok']);
      expect(reported).toEqual([expect.objectContaining({ kind: 'invalid-effect', id: 'bad', sectionId: 'a' })]);
    });

    it('resolves v3 song references only from a v2 song library; an archived v2 show runs nothing', () => {
      const showLibrary = v3([], { songRefs: ['lib'] });
      const librarySong = { id: 'lib', name: 'Library', sections: [{ id: 'lib:lib/s', name: 'S', effects: [zoneEffect('x', 'kick', 0)], master: [] }] };
      const effectSongs = { version: 2, data: { songs: { lib: librarySong } } };
      const graphSongs = { version: 1, data: { songs: { lib: { ...librarySong, graphs: {}, effects: [], presets: [] } } } };
      expect(showFromLibraries(showLibrary, effectSongs)!.songs!.map((s) => s.id)).toEqual(['song', 'lib']);
      expect(showFromLibraries(showLibrary, graphSongs)!.songs!.map((s) => s.id)).toEqual(['song']);
      const graphShow = { version: 2, data: { activeShowId: 'show', shows: { show: { authored: { songs: [], songRefs: ['lib'] } } } } };
      expect(showFromLibraries(graphShow, effectSongs)).toBeNull();
    });

    it('rejects a structurally unusable v3 envelope before any live mutation', () => {
      expect(() => showFromLibraries({ version: 3, data: 'invalid' }, null)).toThrow(/Invalid show library v3/);
    });
  });
});

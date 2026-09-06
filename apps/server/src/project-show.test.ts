import { describe, expect, it } from 'vitest';
import { selectionFromLibrary, showFromLibraries } from './project-show';
import { CANVAS_PARAM_SPEC, defaultProject, type CanvasScene } from '@ledrums/core';
import { VoiceEngineHost } from './voice-engine-host';

describe('persisted library → runtime Show restore boundary', () => {
  it('restores canvas CC brightness through the real host: CC 0 is dark, CC 127 is lit', async () => {
    const scene: CanvasScene = { id: 'restore-cc', name: 'CC canvas', sampler: { kind: 'cylinder' }, lenses: [],
      elements: [{ kind: 'stripes', angleDeg: 0, widthU: 1, duty: 1, speedUps: 0, hue: 0, sat: 1, softness: 0 }] };
    const library = { version: 2, data: { activeShowId: 'show', shows: { show: { authored: {
      buses: [{ id: 'base', name: 'Base', polyphony: 'poly', crossfadeMs: 0 }],
      graphs: { 'graph:canvas': { version: 3, nodes: [
        { id: 'trigger', kind: 'trigger', source: { kind: 'midi', note: 70 } },
        { id: 'effect', kind: 'effect', effectId: 'canvas:restore-cc', presetId: 'canvas:restore-cc:default', mode: 'loop',
          modInputs: [{ param: 'brightness', inMin: 0, inMax: 1, outMin: 0, outMax: 1 }] },
        { id: 'cc', kind: 'cc', ccController: 1 }, { id: 'output', kind: 'output' },
      ], edges: [{ id: 'a', from: 'trigger', to: 'effect' }, { id: 'b', from: 'effect', to: 'output' },
        { id: 'c', from: 'cc', to: 'effect', toPort: 'param:brightness' }] } },
      effects: [], presets: [], songs: [], canvasScenes: [scene],
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
      const params = show.effects.find((effect) => effect.id === 'canvas:restore-cc')!.params;
      expect(params.map((param) => param.key)).toEqual(CANVAS_PARAM_SPEC.map((param) => param.key));
    } finally { await host.stop(); }
  });

  it.each([undefined, 0, 1, 3, 2.5, NaN, Infinity, '2'])('rejects unsupported show version %s even for an empty library', (version) => {
    expect(() => showFromLibraries({ version, data: { shows: {} } }, null)).toThrow(/Unsupported show library version/);
  });
  it.each([undefined, 0, 2, 1.5, NaN, Infinity, '1'])('rejects unsupported song version %s even without a show', (version) => {
    expect(() => showFromLibraries(null, { version, data: { songs: {} } })).toThrow(/Unsupported song library version/);
  });
  it('accepts exactly current versions without shifting a 1-based hoop target', () => {
    const library = { version: 2, data: { activeShowId: 'show', shows: { show: { authored: {
      graphs: { g: { version: 3, nodes: [{ id: 'scope', kind: 'scope', scope: 'hoop', targetId: 'kick#1' }], edges: [] } },
    } } } } };
    expect(showFromLibraries(library, { version: 1, data: { songs: {} } })!.graphs.g!.nodes[0]!.targetId).toBe('kick#1');
    expect(() => showFromLibraries({ ...library, version: 1 }, null)).toThrow(/Unsupported show library version/);
  });

  it('resolves song-library closures, pad slots and active selection without changing the saved blobs', () => {
    const graphs = { 'lib:g': { nodes: [{ id: 'trigger', kind: 'trigger', source: { kind: 'drum', drumId: 'snare', zone: '2' } }], edges: [] } };
    const showLibrary = { version: 2, data: { activeShowId: 'show', shows: { show: { authored: {
      graphs: {}, buses: [], effects: [], presets: [], songs: [], songRefs: ['song', 'song', 'missing'], activeSongId: 'song', activeSectionId: 'section',
    } } } } };
    const songLibrary = { version: 1, data: { songs: { song: { id: 'song', name: 'Library song',
      graphs, effects: [], presets: [], sections: [{ id: 'section', name: 'Section', graphs: ['lib:g'], looks: {} }] } } } };
    const before = structuredClone({ showLibrary, songLibrary });
    const runtime = showFromLibraries(showLibrary, songLibrary)!;
    expect(runtime.songs).toEqual([{ id: 'song', name: 'Library song', sections: [{ id: 'section', name: 'Section',
      performanceGraphKeys: ['lib:g'], slots: { 'snare:2': ['lib:g'] } }] }]);
    expect(selectionFromLibrary(showLibrary)).toEqual({ songId: 'song', sectionId: 'section' });
    expect(runtime.graphs['lib:g']).not.toBe(graphs['lib:g']);
    expect({ showLibrary, songLibrary }).toEqual(before);
  });

  it('cold-restored sections authorize direct MIDI/OSC graphs while retaining drum slots', async () => {
    const graph = (source: { kind: 'drum'; drumId: string; zone: string } | { kind: 'midi'; note: number } | { kind: 'osc'; address: string }) => ({
      version: 3,
      nodes: [
        { id: 'trigger', kind: 'trigger', source },
        { id: 'play', kind: 'play', mode: 'oneshot', scope: 'kit', effectId: 'fx-flash', presetId: '', busId: 'main', params: { brightness: 1 } },
      ],
      edges: [{ id: 'e1', from: 'trigger', to: 'play' }],
    });
    const showLibrary = { version: 2, data: { activeShowId: 'show', shows: { show: { authored: {
      buses: [{ id: 'main', name: 'Main', polyphony: 'poly', crossfadeMs: 0 }],
      graphs: {
        'graph:midi': graph({ kind: 'midi', note: 60 }),
        'graph:osc': graph({ kind: 'osc', address: '/lights' }),
        'graph:drum': graph({ kind: 'drum', drumId: 'kick', zone: '0' }),
        'graph:other': graph({ kind: 'midi', note: 61 }),
        'graph:unassigned': graph({ kind: 'midi', note: 62 }),
      },
      effects: [{ id: 'fx-flash', name: 'Flash', generatorId: 'whole-drum', busId: 'main', scope: 'kit', params: [
        { key: 'brightness', label: 'Brightness', kind: 'number', min: 0, max: 1, default: 1 },
      ], attackMs: 0, sustainMs: 200, releaseMs: 200 }],
      presets: [], songs: [{ id: 'song', name: 'Song', sections: [
        { id: 'active', name: 'Active', graphs: ['graph:midi', 'graph:osc', 'graph:drum'], looks: {} },
        { id: 'other', name: 'Other', graphs: ['graph:other'], looks: {} },
      ] }], activeSongId: 'song', activeSectionId: 'active',
    } } } } };

    const runtime = showFromLibraries(showLibrary, null)!;
    expect(runtime.songs).toEqual([{ id: 'song', name: 'Song', sections: [
      { id: 'active', name: 'Active', performanceGraphKeys: ['graph:midi', 'graph:osc', 'graph:drum'], slots: { 'kick:0': ['graph:drum'] } },
      { id: 'other', name: 'Other', performanceGraphKeys: ['graph:other'], slots: {} },
    ] }]);

    const project = defaultProject();
    project.output.state = 'disabled';
    const host = new VoiceEngineHost(project);
    const events: Array<{ label?: string }> = [];
    host.setMonitor((event) => events.push(event as { label?: string }));
    host.prepareProject(project, runtime, selectionFromLibrary(showLibrary)).commit();
    try {
      host.applyInput({ kind: 'fireGraph', graphKey: 'graph:midi', viewerOnly: true });
      host.applyInput({ kind: 'fireGraph', graphKey: 'graph:osc', viewerOnly: true });
      host.applyInput({ kind: 'fireGraph', graphKey: 'graph:other', viewerOnly: true });
      host.applyInput({ kind: 'fireGraph', graphKey: 'graph:unassigned', viewerOnly: true });
      host.step(1000 / 120);

      expect(events.filter((event) => event.label === 'Graph fired graph:midi')).toHaveLength(1);
      expect(events.filter((event) => event.label === 'Graph fired graph:osc')).toHaveLength(1);
      expect(events.filter((event) => event.label === 'Graph fired graph:other')).toHaveLength(0);
      expect(events.filter((event) => event.label === 'Graph fired graph:unassigned')).toHaveLength(0);
    } finally {
      await host.stop();
    }
  });

  it('null means no show, but malformed opaque envelopes are rejected rather than reusing an old show', () => {
    expect(showFromLibraries(null, null)).toBeNull();
    expect(() => showFromLibraries({ version: 2, data: 'invalid' }, null)).toThrow('Invalid authored');
  });
});

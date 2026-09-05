import { describe, expect, it } from 'vitest';
import { selectionFromLibrary, showFromLibraries } from './project-show';

describe('persisted library → runtime Show restore boundary', () => {
  it('resolves song-library closures, pad slots and active selection without changing the saved blobs', () => {
    const graphs = { 'lib:g': { nodes: [{ id: 'trigger', kind: 'trigger', source: { kind: 'drum', drumId: 'snare', zone: '2' } }], edges: [] } };
    const showLibrary = { version: 1, data: { activeShowId: 'show', shows: { show: { authored: {
      graphs: {}, buses: [], effects: [], presets: [], songs: [], songRefs: ['song', 'song', 'missing'], activeSongId: 'song', activeSectionId: 'section',
    } } } } };
    const songLibrary = { version: 1, data: { songs: { song: { id: 'song', name: 'Library song',
      graphs, effects: [], presets: [], sections: [{ id: 'section', name: 'Section', graphs: ['lib:g'], looks: {} }] } } } };
    const before = structuredClone({ showLibrary, songLibrary });
    const runtime = showFromLibraries(showLibrary, songLibrary)!;
    expect(runtime.songs).toEqual([{ id: 'song', name: 'Library song', sections: [{ id: 'section', name: 'Section', slots: { 'snare:2': ['lib:g'] } }] }]);
    expect(selectionFromLibrary(showLibrary)).toEqual({ songId: 'song', sectionId: 'section' });
    expect(runtime.graphs['lib:g']).not.toBe(graphs['lib:g']);
    expect({ showLibrary, songLibrary }).toEqual(before);
  });
  it('null means no show, but malformed opaque envelopes are rejected rather than reusing an old show', () => {
    expect(showFromLibraries(null, null)).toBeNull();
    expect(() => showFromLibraries({ version: 1, data: 'invalid' }, null)).toThrow('Invalid authored');
  });
});

import { describe, expect, it } from 'vitest';
import { cloneSongGraphs } from './graphs';
import { makeSection, makeSong } from '../../app/setlist';
import type { TriggerGraph } from '../sim';

/* cloneSongGraphs — the deep-copy pass that makes a duplicated SONG independent. Without it a
   duplicate's sections carried the SOURCE's graph keys, so authoring inside the copy wrote
   through into the song it was copied from. Pure module: the key minter is injected. */

const graph = (nodeId: string): TriggerGraph =>
  ({ version: 3, nodes: [{ id: nodeId, kind: 'trigger', x: 0, y: 0 }], edges: [] }) as unknown as TriggerGraph;

function minter(): () => string {
  let n = 0;
  return () => `graph-new-${++n}`;
}

describe('cloneSongGraphs', () => {
  const graphs = { a: graph('na'), b: graph('nb') };
  const graphNames = { a: 'Kick · center', b: 'Snare · rim' };

  it('remaps every section reference onto a freshly minted, deep-copied graph', () => {
    const song = makeSong('song-1', 'Set', [makeSection('s1', 'Intro', ['a', 'b'])]);
    const out = cloneSongGraphs(song, graphs, graphNames, minter());

    expect(out.song.sections[0]!.graphs).toEqual(['graph-new-1', 'graph-new-2']);
    expect(Object.keys(out.graphs)).toEqual(['graph-new-1', 'graph-new-2']);
    // deep copy: a distinct object graph, equal by value
    expect(out.graphs['graph-new-1']).toEqual(graphs.a);
    expect(out.graphs['graph-new-1']).not.toBe(graphs.a);
    expect(out.graphs['graph-new-1']!.nodes[0]).not.toBe(graphs.a.nodes[0]);
  });

  it('carries each graph label over verbatim', () => {
    const song = makeSong('song-1', 'Set', [makeSection('s1', 'Intro', ['a', 'b'])]);
    const out = cloneSongGraphs(song, graphs, graphNames, minter());
    expect(out.graphNames).toEqual({ 'graph-new-1': 'Kick · center', 'graph-new-2': 'Snare · rim' });
  });

  it('preserves cross-section reuse — one clone per SOURCE key, not per placement', () => {
    const song = makeSong('song-1', 'Set', [
      makeSection('s1', 'Intro', ['a', 'b']),
      makeSection('s2', 'Verse', ['a']),
    ]);
    const out = cloneSongGraphs(song, graphs, graphNames, minter());

    expect(Object.keys(out.graphs)).toHaveLength(2); // 'a' cloned once, referenced twice
    expect(out.song.sections[1]!.graphs).toEqual([out.song.sections[0]!.graphs[0]]);
  });

  it('leaves a dangling reference untouched rather than repairing it', () => {
    const song = makeSong('song-1', 'Set', [makeSection('s1', 'Intro', ['a', 'gone'])]);
    const out = cloneSongGraphs(song, graphs, graphNames, minter());

    expect(out.song.sections[0]!.graphs).toEqual(['graph-new-1', 'gone']);
    expect(out.graphs['gone']).toBeUndefined();
  });

  it('does not mutate the input song, graphs, or names', () => {
    const song = makeSong('song-1', 'Set', [makeSection('s1', 'Intro', ['a'])]);
    const out = cloneSongGraphs(song, graphs, graphNames, minter());

    expect(song.sections[0]!.graphs).toEqual(['a']);
    expect(Object.keys(graphs)).toEqual(['a', 'b']);
    expect(graphNames).toEqual({ a: 'Kick · center', b: 'Snare · rim' });
    expect(out.song).not.toBe(song);
  });

  it('keeps the section ids + looks the caller already cloned', () => {
    const song = makeSong('song-1', 'Set', [makeSection('s1', 'Intro', ['a'], { base: 'gen:plasma' })]);
    const out = cloneSongGraphs(song, graphs, graphNames, minter());

    expect(out.song.sections[0]!.id).toBe('s1');
    expect(out.song.sections[0]!.looks).toEqual({ base: 'gen:plasma' });
  });
});

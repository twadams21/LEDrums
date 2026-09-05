import { describe, expect, it } from 'vitest';
import type { SetlistSection } from '../../app/setlist';
import type { TriggerGraph } from '../sim';
import { cloneSectionGraphs } from './graphs';

const graph = (id: string): TriggerGraph =>
  ({ version: 3, nodes: [{ id, kind: 'trigger', x: 0, y: 0 }], edges: [] }) as unknown as TriggerGraph;

describe('cloneSectionGraphs', () => {
  it('deep-copies each source key once and retains labels/order', () => {
    const section: SetlistSection = { id: 's', name: 'Verse', graphs: ['a', 'b', 'a'], looks: { base: null } };
    const sourceA = graph('a-node');
    const sourceB = graph('b-node');
    const out = cloneSectionGraphs(section, { a: sourceA, b: sourceB }, { a: 'Kick', b: 'Snare' }, (() => {
      let n = 0;
      return () => `copy-${++n}`;
    })());

    expect(out.section).toMatchObject({ id: 's', name: 'Verse', graphs: ['copy-1', 'copy-2', 'copy-1'], looks: { base: null } });
    expect(out.graphs).toEqual({ 'copy-1': sourceA, 'copy-2': sourceB });
    expect(out.graphs['copy-1']).not.toBe(sourceA);
    expect(out.graphNames).toEqual({ 'copy-1': 'Kick', 'copy-2': 'Snare' });
  });
});

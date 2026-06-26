import { describe, expect, it } from 'vitest';
import { emptyShow, type GraphNode, type Show, type TriggerGraph, type TriggerSource } from './types';

/* Core mirror of the trigger-source field (U1 T1). Core only carries the `source` shape
   so web graphs pass through `buildShow` structurally — resolution lives in a later slice.
   These guard the field's presence, optionality, and that it is plain serializable data. */

/** A fully-populated trigger node (every GraphNode field set) carrying an optional source. */
function triggerNode(source?: TriggerSource): GraphNode {
  return {
    id: 'trigger',
    kind: 'trigger',
    x: 0,
    y: 0,
    mode: 'oneshot',
    scope: 'kit',
    effectId: '',
    presetId: '',
    busId: '',
    params: {},
    env: {},
    linked: false,
    noRepeat: true,
    on: 'velocity',
    valueMode: 'gate',
    threshold: 0.5,
    invert: false,
    bands: [0.5],
    p: 0.5,
    source,
  };
}

describe('core voice TriggerSource mirror', () => {
  it('a trigger node carries each source variant', () => {
    expect(triggerNode({ kind: 'drum', drumId: 'kick', zone: '0' }).source).toEqual({ kind: 'drum', drumId: 'kick', zone: '0' });
    expect(triggerNode({ kind: 'midi', note: 38 }).source).toEqual({ kind: 'midi', note: 38 });
    expect(triggerNode({ kind: 'midi', cc: 7 }).source).toEqual({ kind: 'midi', cc: 7 });
    expect(triggerNode({ kind: 'osc', address: '/kick' }).source).toEqual({ kind: 'osc', address: '/kick' });
  });

  it('source is optional/additive — a node without one has it undefined', () => {
    expect(triggerNode().source).toBeUndefined();
  });

  it('a Show holds graphs whose trigger node carries a source (plain serializable data)', () => {
    const graph: TriggerGraph = { nodes: [triggerNode({ kind: 'osc', address: '/kick' })], edges: [] };
    const show: Show = { ...emptyShow(), graphs: { 'kick:0': graph } };
    // it survives a structural (JSON) round-trip — pure data, no behaviour attached
    const clone = JSON.parse(JSON.stringify(show)) as Show;
    expect(clone.graphs['kick:0']!.nodes[0]!.source).toEqual({ kind: 'osc', address: '/kick' });
  });
});

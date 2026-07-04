import { describe, expect, it } from 'vitest';
import { materializeLinkedNodes, materializeLinkedNodesAll, normalizeGraphs } from './hydrate';
import { makeNode, type GraphNode, type TriggerGraph } from '../sim';

/* S39 — remove `linked` presets. The hydrate-time migrator materializes each formerly-linked
   play node's params from its shared preset (so its EFFECTIVE render is unchanged), then drops the
   `linked` flag from every node so the field leaves the model. These tests pin the acceptance
   criteria: linked nodes keep their exact (effective) params post-migration, the pass is
   idempotent + alias-stable, and unlinked nodes are untouched apart from the dropped flag. */

/** Attach the legacy `linked` flag onto a node (the field is gone from GraphNode, so cast). */
function withLinked(node: GraphNode, linked: boolean): GraphNode {
  return { ...node, linked } as GraphNode;
}

/** A graph with one play node carrying the legacy `linked` flag + its own private params. */
function linkedGraph(linked: boolean, ownParams: Record<string, number>): TriggerGraph {
  return {
    nodes: [
      makeNode('trigger', 'trigger'),
      withLinked(makeNode('play', 'p1', 0, 0, { effectId: 'fx', presetId: 'fx:wide', params: ownParams }), linked),
    ],
    edges: [{ id: 'e0', from: 'trigger', to: 'p1' }],
  };
}

const PRESET_PARAMS = { hue: 200, brightness: 0.8 };
const presetParamsFor = (id: string) => (id === 'fx:wide' ? PRESET_PARAMS : undefined);

describe('materializeLinkedNodes — S39 linked → snapshot migration', () => {
  it('a linked node adopts its preset params (its effective render) and drops the flag', () => {
    const out = materializeLinkedNodes(linkedGraph(true, { hue: 0, brightness: 0.1 }), presetParamsFor);
    const p1 = out.nodes.find((n) => n.id === 'p1')!;
    expect(p1.params).toEqual(PRESET_PARAMS);
    expect(p1.params).not.toBe(PRESET_PARAMS); // a private copy, not the shared object
    expect('linked' in (p1 as unknown as Record<string, unknown>)).toBe(false);
  });

  it('an unlinked node keeps its own params; only the flag is dropped', () => {
    const own = { hue: 10, brightness: 0.2 };
    const out = materializeLinkedNodes(linkedGraph(false, own), presetParamsFor);
    const p1 = out.nodes.find((n) => n.id === 'p1')!;
    expect(p1.params).toEqual(own);
    expect('linked' in (p1 as unknown as Record<string, unknown>)).toBe(false);
  });

  it('a linked node whose preset is unknown keeps its own params (mirrors the old unlink branch)', () => {
    const own = { hue: 33, brightness: 0.3 };
    const out = materializeLinkedNodes(linkedGraph(true, own), () => undefined);
    const p1 = out.nodes.find((n) => n.id === 'p1')!;
    expect(p1.params).toEqual(own);
    expect('linked' in (p1 as unknown as Record<string, unknown>)).toBe(false);
  });

  it('is idempotent + alias-stable: a graph with no `linked` field is returned by reference', () => {
    const migrated = materializeLinkedNodes(linkedGraph(true, { hue: 0 }), presetParamsFor);
    expect(materializeLinkedNodes(migrated, presetParamsFor)).toBe(migrated); // no-op re-run
    // A freshly-authored graph (makeNode no longer sets `linked`) is likewise untouched.
    const fresh: TriggerGraph = { nodes: [makeNode('play', 'p', 0, 0, { effectId: 'fx' })], edges: [] };
    expect(materializeLinkedNodes(fresh, presetParamsFor)).toBe(fresh);
  });

  it('materializeLinkedNodesAll keeps each unchanged graph by reference', () => {
    const dirty = linkedGraph(true, { hue: 0 });
    const clean: TriggerGraph = { nodes: [makeNode('trigger', 'trigger')], edges: [] };
    const out = materializeLinkedNodesAll({ a: dirty, b: clean }, presetParamsFor);
    expect(out.a).not.toBe(dirty);
    expect(out.b).toBe(clean);
  });

  it('runs inside the full normalizeGraphs pass (linked node materialized, flag gone)', () => {
    const { graphs } = normalizeGraphs(
      { 'kick:1': linkedGraph(true, { hue: 0, brightness: 0.1 }) },
      {},
      [],
      () => [],
      presetParamsFor,
    );
    const p1 = graphs['kick:1']!.nodes.find((n) => n.id === 'p1')!;
    expect(p1.params).toEqual(PRESET_PARAMS);
    expect('linked' in (p1 as unknown as Record<string, unknown>)).toBe(false);
  });
});

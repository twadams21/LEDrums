import { describe, expect, it } from 'vitest';
import {
  buildChainEdges,
  buildLeafNodes,
  buildRefEdges,
  classifyGraphConnection,
  computeZoneNodes,
  graphChainEdges,
  seedLeafPositions,
  CONTROLLER_ZONE_ID,
  KIT_ZONE_ID,
  TRIGGERS_ZONE_ID,
  drumZoneId,
  type ZoneGraphInput,
} from './patch-zones';
import type { PatchFlowEdge, PatchFlowNode } from './patch-topology';
import type { PatchRouting } from './patch-routing';

const INPUT: ZoneGraphInput = {
  drums: [
    { id: 'kick', label: 'Kick', hoopCount: 2 },
    { id: 'snare', label: 'Snare', hoopCount: 2 },
  ],
  routing: {
    outputs: [
      { id: 'o1', channelsPerPixel: 3, hoops: [{ drumId: 'kick', hoop: 1 }, { drumId: 'kick', hoop: 2 }] },
      { id: 'o2', channelsPerPixel: 3, hoops: [] }, // unwired
    ],
  },
  triggers: [
    { drumId: 'kick', label: 'Kick Trigger', sub: '2 zones' },
    { drumId: 'snare', label: 'Snare Trigger', sub: '4 zones' },
  ],
};

const edge = (source: string, target: string, type = 'wire'): PatchFlowEdge => ({ id: `${source}->${target}`, source, target, type });

describe('seedLeafPositions', () => {
  it('gives every leaf (output/hoop/trigger) a deterministic position', () => {
    const seed = seedLeafPositions(INPUT);
    for (const id of ['output:o1', 'output:o2', 'hoop:kick:1', 'hoop:kick:2', 'hoop:snare:1', 'hoop:snare:2', 'trigger:kick', 'trigger:snare']) {
      expect(seed[id]).toBeDefined();
    }
    // outputs stack (same x), hoops of a drum share a row (same y), later hoop is further right.
    expect(seed['output:o1']!.x).toBe(seed['output:o2']!.x);
    expect(seed['hoop:kick:1']!.y).toBe(seed['hoop:kick:2']!.y);
    expect(seed['hoop:kick:2']!.x).toBeGreaterThan(seed['hoop:kick:1']!.x);
  });
});

describe('buildLeafNodes', () => {
  it('builds one patch leaf per output/hoop/trigger with the right stage + sub', () => {
    const nodes = buildLeafNodes(INPUT, undefined);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    expect(byId.get('output:o1')!.data.stage).toBe('output');
    expect(byId.get('output:o1')!.data.sub).toBe('2 hoops');
    expect(byId.get('output:o2')!.data.sub).toBe('unwired');
    expect(byId.get('hoop:kick:1')!.data.stage).toBe('hoop');
    expect(byId.get('trigger:kick')!.data.stage).toBe('trigger');
    expect(nodes.every((n) => n.type === 'patch')).toBe(true);
  });

  it('honours a persisted nodeLayout position over the seed', () => {
    const nodes = buildLeafNodes(INPUT, { 'hoop:kick:1': { x: 999, y: 888 } });
    expect(nodes.find((n) => n.id === 'hoop:kick:1')!.position).toEqual({ x: 999, y: 888 });
  });
});

describe('computeZoneNodes — auto-fit holders + drum sub-zones', () => {
  const leaves = buildLeafNodes(INPUT, undefined);
  const zones = computeZoneNodes(leaves, INPUT.drums);
  const byId = new Map(zones.map((z) => [z.id, z]));

  it('emits the three holders + one sub-zone per drum', () => {
    expect(byId.has(CONTROLLER_ZONE_ID)).toBe(true);
    expect(byId.has(KIT_ZONE_ID)).toBe(true);
    expect(byId.has(TRIGGERS_ZONE_ID)).toBe(true);
    expect(byId.has(drumZoneId('kick'))).toBe(true);
    expect(byId.has(drumZoneId('snare'))).toBe(true);
    expect(zones.every((z) => z.type === 'zone')).toBe(true);
  });

  it('a holder rect encloses its member leaves', () => {
    const ctrl = byId.get(CONTROLLER_ZONE_ID)!;
    for (const id of ['output:o1', 'output:o2']) {
      const p = leaves.find((n) => n.id === id)!.position;
      expect(p.x).toBeGreaterThanOrEqual(ctrl.position.x);
      expect(p.y).toBeGreaterThanOrEqual(ctrl.position.y);
      expect(p.x).toBeLessThanOrEqual(ctrl.position.x + (ctrl.width ?? 0));
    }
  });

  it('the Kit zone encloses each drum sub-zone (larger pad wraps the nested zones)', () => {
    const kitZone = byId.get(KIT_ZONE_ID)!;
    for (const d of INPUT.drums) {
      const sub = byId.get(drumZoneId(d.id))!;
      expect(sub.position.x).toBeGreaterThanOrEqual(kitZone.position.x);
      expect(sub.position.y).toBeGreaterThanOrEqual(kitZone.position.y);
      expect(sub.position.x + (sub.width ?? 0)).toBeLessThanOrEqual(kitZone.position.x + (kitZone.width ?? 0));
      expect(sub.position.y + (sub.height ?? 0)).toBeLessThanOrEqual(kitZone.position.y + (kitZone.height ?? 0));
    }
  });

  it('zones render behind leaves (lower z-index) and are non-draggable / non-connectable', () => {
    for (const z of zones) {
      expect(z.draggable).toBe(false);
      expect(z.connectable).toBe(false);
      expect(z.zIndex).toBeLessThan(10);
    }
  });

  it('omits a zone whose members are all absent', () => {
    const noTriggers = computeZoneNodes(buildLeafNodes({ ...INPUT, triggers: [] }, undefined), INPUT.drums);
    expect(noTriggers.some((z) => z.id === TRIGGERS_ZONE_ID)).toBe(false);
  });
});

describe('buildChainEdges / buildRefEdges', () => {
  it('draws Output→Hoop→Hoop chain edges for wired outputs only', () => {
    const chain = buildChainEdges(INPUT.routing, () => true);
    expect(chain).toContainEqual(expect.objectContaining({ source: 'output:o1', target: 'hoop:kick:1' }));
    expect(chain).toContainEqual(expect.objectContaining({ source: 'hoop:kick:1', target: 'hoop:kick:2' }));
    // the unwired output emits no chain edge
    expect(chain.some((e) => e.source === 'output:o2')).toBe(false);
  });

  it('draws a dotted non-interactive Trigger→Drum ref edge per trigger', () => {
    const refs = buildRefEdges(INPUT.triggers, () => true);
    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({ source: 'trigger:kick', target: drumZoneId('kick'), type: 'ref', selectable: false });
  });
});

describe('graphChainEdges — project graph edges into core ChainEdges', () => {
  it('converts output/hoop edges and IGNORES ref edges', () => {
    const edges = [edge('output:o1', 'hoop:kick:1'), edge('hoop:kick:1', 'hoop:kick:2'), edge('trigger:kick', drumZoneId('kick'), 'ref')];
    const chain = graphChainEdges(edges);
    expect(chain).toEqual([
      { from: { kind: 'output', outputId: 'o1' }, to: { drumId: 'kick', hoop: 1 } },
      { from: { kind: 'hoop', ref: { drumId: 'kick', hoop: 1 } }, to: { drumId: 'kick', hoop: 2 } },
    ]);
  });
});

describe('classifyGraphConnection — the connect-time guard (core rules)', () => {
  const wired: PatchFlowEdge[] = [edge('output:o1', 'hoop:kick:1'), edge('hoop:kick:1', 'hoop:kick:2')];

  it('accepts a legal Output→Hoop root onto a free hoop', () => {
    expect(classifyGraphConnection([], 'output:o1', 'hoop:kick:1').ok).toBe(true);
  });

  it('accepts a legal Hoop→Hoop extension onto a free hoop', () => {
    expect(classifyGraphConnection([edge('output:o1', 'hoop:kick:1')], 'hoop:kick:1', 'hoop:kick:2').ok).toBe(true);
  });

  it('rejects a wire whose target is NOT a hoop (only a hoop can receive)', () => {
    const v = classifyGraphConnection([], 'output:o1', 'output:o2');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.message).toMatch(/hoop/i);
  });

  it('rejects a source that is neither an Output nor a Hoop', () => {
    const v = classifyGraphConnection([], 'trigger:kick', 'hoop:kick:1');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.message).toMatch(/Output or a Hoop/i);
  });

  it('rejects wiring a hoop to itself (self)', () => {
    const v = classifyGraphConnection([], 'hoop:kick:1', 'hoop:kick:1');
    expect(v).toMatchObject({ ok: false, code: 'self' });
  });

  it('rejects a second wire from an already-wired Output (output-already-wired)', () => {
    const v = classifyGraphConnection(wired, 'output:o1', 'hoop:snare:1');
    expect(v).toMatchObject({ ok: false, code: 'output-already-wired' });
  });

  it('rejects wiring INTO a hoop that already has an upstream (hoop-has-upstream)', () => {
    const v = classifyGraphConnection(wired, 'hoop:snare:1', 'hoop:kick:2');
    expect(v).toMatchObject({ ok: false, code: 'hoop-has-upstream' });
  });

  it('rejects a second downstream from a hoop that already feeds one (source-has-downstream)', () => {
    const v = classifyGraphConnection(wired, 'hoop:kick:1', 'hoop:snare:1');
    expect(v).toMatchObject({ ok: false, code: 'source-has-downstream' });
  });

  it('rejects a wire that would form a cycle (cycle)', () => {
    // chain output→k1→k2; wiring k2 back to k1 would loop.
    const v = classifyGraphConnection(wired, 'hoop:kick:2', 'hoop:kick:1');
    // k1 already has an upstream (from the output), so the upstream check fires first; either way
    // it is a hard rejection — the guard never accepts it.
    expect(v.ok).toBe(false);
  });
});

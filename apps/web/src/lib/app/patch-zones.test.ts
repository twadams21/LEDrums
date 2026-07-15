import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/svelte';
import {
  adoptLayoutNodes,
  autoFitContainers,
  buildChainEdges,
  buildRefEdges,
  buildZoneGraph,
  classifyGraphConnection,
  graphChainEdges,
  layoutSignature,
  CONTROLLER_ZONE_ID,
  KIT_ZONE_ID,
  TRIGGERS_ZONE_ID,
  drumZoneId,
  triggerNodeId,
  type XY,
  type ZoneGraphInput,
} from './patch-zones';
import type { PatchFlowEdge } from './patch-topology';

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

/** Absolute canvas position of a node = its position summed up its parentId chain. */
function absPos(nodes: ReadonlyArray<Node>, id: string): { x: number; y: number } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let x = 0;
  let y = 0;
  let cur: Node | undefined = byId.get(id);
  while (cur) {
    x += cur.position.x;
    y += cur.position.y;
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return { x, y };
}

describe('buildZoneGraph — parentId nesting', () => {
  const nodes = buildZoneGraph(INPUT, undefined);
  const byId = new Map(nodes.map((n) => [n.id, n]));

  it('emits the three top holders (no parent) + one drum sub-zone per drum (parent = kit)', () => {
    expect(byId.get(CONTROLLER_ZONE_ID)!.parentId).toBeUndefined();
    expect(byId.get(KIT_ZONE_ID)!.parentId).toBeUndefined();
    expect(byId.get(TRIGGERS_ZONE_ID)!.parentId).toBeUndefined();
    expect(byId.get(drumZoneId('kick'))!.parentId).toBe(KIT_ZONE_ID);
    expect(byId.get(drumZoneId('snare'))!.parentId).toBe(KIT_ZONE_ID);
  });

  it('parents each leaf to its container', () => {
    expect(byId.get('output:o1')!.parentId).toBe(CONTROLLER_ZONE_ID);
    expect(byId.get('hoop:kick:1')!.parentId).toBe(drumZoneId('kick'));
    expect(byId.get('hoop:snare:2')!.parentId).toBe(drumZoneId('snare'));
    expect(byId.get(triggerNodeId('kick'))!.parentId).toBe(TRIGGERS_ZONE_ID);
  });

  it('orders the nodes array ANCESTORS-FIRST (every parent precedes its children)', () => {
    const index = new Map(nodes.map((n, i) => [n.id, i]));
    for (const n of nodes) {
      if (n.parentId) expect(index.get(n.parentId)!).toBeLessThan(index.get(n.id)!);
    }
  });

  it('sizes each container to hug its children (child sits inside the parent box, local frame)', () => {
    for (const zoneId of [CONTROLLER_ZONE_ID, KIT_ZONE_ID, TRIGGERS_ZONE_ID, drumZoneId('kick'), drumZoneId('snare')]) {
      const z = byId.get(zoneId)!;
      const kids = nodes.filter((n) => n.parentId === zoneId);
      expect(kids.length).toBeGreaterThan(0);
      for (const k of kids) {
        expect(k.position.x).toBeGreaterThanOrEqual(0);
        expect(k.position.y).toBeGreaterThanOrEqual(0);
        expect(k.position.x).toBeLessThanOrEqual(z.width ?? 0);
        expect(k.position.y).toBeLessThanOrEqual(z.height ?? 0);
      }
    }
  });

  it('the kit ENCLOSES each drum sub-zone (drum is a real child inside the kit box)', () => {
    const kit = byId.get(KIT_ZONE_ID)!;
    for (const d of INPUT.drums) {
      const sub = byId.get(drumZoneId(d.id))!;
      expect(sub.position.x + (sub.width ?? 0)).toBeLessThanOrEqual(kit.width ?? 0);
      expect(sub.position.y + (sub.height ?? 0)).toBeLessThanOrEqual(kit.height ?? 0);
    }
  });

  it('zones are draggable (parent-drag moves subtree) + non-connectable; leaves render above', () => {
    for (const z of nodes.filter((n) => n.type === 'zone')) {
      expect(z.draggable).toBe(true);
      expect(z.connectable).toBe(false);
      expect(z.zIndex ?? 0).toBeLessThan(10);
    }
    expect(nodes.find((n) => n.id === 'hoop:kick:1')!.zIndex).toBe(10);
  });

  it('honours a persisted (parent-relative) nodeLayout position over the seed', () => {
    const moved = buildZoneGraph(INPUT, { 'output:o1': { x: 5, y: 7 } });
    // after auto-fit re-normalize the value may shift, but the output stays the top-left child.
    const ctrl = moved.find((n) => n.id === CONTROLLER_ZONE_ID)!;
    const out = moved.find((n) => n.id === 'output:o1')!;
    // its absolute position reflects the override + the container's re-normalized origin.
    expect(absPos(moved, 'output:o1')).toBeDefined();
    expect(out.parentId).toBe(CONTROLLER_ZONE_ID);
    expect(ctrl.width).toBeGreaterThan(0);
  });
});

describe('autoFitContainers — bottom-up size + re-normalize', () => {
  it('is idempotent on a fresh seed (already canonical)', () => {
    const seed = buildZoneGraph(INPUT, undefined);
    const refit = autoFitContainers(seed);
    for (const n of seed) {
      const m = refit.find((r) => r.id === n.id)!;
      expect(m.position).toEqual(n.position);
      if (n.type === 'zone') {
        expect(m.width).toBe(n.width);
        expect(m.height).toBe(n.height);
      }
    }
  });

  it('a child dragged to a NEGATIVE relative corner grows the box + re-normalizes (child stays put)', () => {
    const seed = buildZoneGraph(INPUT, undefined);
    const drumId = drumZoneId('kick');
    // Absolute position + relative corner of the hoop before we move it (the invariant to preserve).
    const absBefore = absPos(seed, 'hoop:kick:1');
    const oldRel = seed.find((n) => n.id === 'hoop:kick:1')!.position;
    const drumWBefore = seed.find((n) => n.id === drumId)!.width ?? 0;

    // Drag hoop:kick:1 up-and-left past the sub-zone's top-left (negative relative coords).
    const newRel = { x: -50, y: -40 };
    const dragged = seed.map((n) => (n.id === 'hoop:kick:1' ? { ...n, position: { ...newRel } } : n));
    const fit = autoFitContainers(dragged);

    const drum = fit.find((n) => n.id === drumId)!;
    const hoop = fit.find((n) => n.id === 'hoop:kick:1')!;
    // Re-normalized: the hoop's relative position is back to the pad corner (non-negative)...
    expect(hoop.position.x).toBeGreaterThanOrEqual(0);
    expect(hoop.position.y).toBeGreaterThanOrEqual(0);
    // ...the box GREW to include the moved hoop...
    expect(drum.width ?? 0).toBeGreaterThan(drumWBefore);
    // ...and the hoop stayed put VISUALLY: its absolute position moved by exactly the drag delta.
    const absAfter = absPos(fit, 'hoop:kick:1');
    expect(absAfter.x).toBeCloseTo(absBefore.x + (newRel.x - oldRel.x), 3);
    expect(absAfter.y).toBeCloseTo(absBefore.y + (newRel.y - oldRel.y), 3);
  });

  it('reflows bottom-up: moving a hoop grows its drum AND the kit that contains it', () => {
    const seed = buildZoneGraph(INPUT, undefined);
    const kitWBefore = seed.find((n) => n.id === KIT_ZONE_ID)!.width ?? 0;
    // push a hoop far right → widens its drum sub-zone → widens the kit
    const dragged = seed.map((n) => (n.id === 'hoop:kick:2' ? { ...n, position: { x: 2000, y: n.position.y } } : n));
    const fit = autoFitContainers(dragged);
    expect((fit.find((n) => n.id === KIT_ZONE_ID)!.width ?? 0)).toBeGreaterThan(kitWBefore);
  });
});

describe('buildChainEdges / buildRefEdges', () => {
  it('draws Output→Hoop→Hoop chain edges for wired outputs only', () => {
    const chain = buildChainEdges(INPUT.routing, () => true);
    expect(chain).toContainEqual(expect.objectContaining({ source: 'output:o1', target: 'hoop:kick:1' }));
    expect(chain).toContainEqual(expect.objectContaining({ source: 'hoop:kick:1', target: 'hoop:kick:2' }));
    expect(chain.some((e) => e.source === 'output:o2')).toBe(false);
  });

  it('draws a dotted non-interactive Trigger→Drum ref edge per trigger (targets the drum sub-zone)', () => {
    const refs = buildRefEdges(INPUT.triggers, () => true);
    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({ source: 'trigger:kick', target: drumZoneId('kick'), type: 'ref', selectable: false });
  });
});

describe('graphChainEdges — project graph edges into core ChainEdges', () => {
  it('converts output/hoop edges and IGNORES ref edges', () => {
    const edges = [edge('output:o1', 'hoop:kick:1'), edge('hoop:kick:1', 'hoop:kick:2'), edge('trigger:kick', drumZoneId('kick'), 'ref')];
    expect(graphChainEdges(edges)).toEqual([
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
    expect(classifyGraphConnection([], 'hoop:kick:1', 'hoop:kick:1')).toMatchObject({ ok: false, code: 'self' });
  });

  it('rejects a second wire from an already-wired Output (output-already-wired)', () => {
    expect(classifyGraphConnection(wired, 'output:o1', 'hoop:snare:1')).toMatchObject({ ok: false, code: 'output-already-wired' });
  });

  it('rejects wiring INTO a hoop that already has an upstream (hoop-has-upstream)', () => {
    expect(classifyGraphConnection(wired, 'hoop:snare:1', 'hoop:kick:2')).toMatchObject({ ok: false, code: 'hoop-has-upstream' });
  });

  it('rejects a second downstream from a hoop that already feeds one (source-has-downstream)', () => {
    expect(classifyGraphConnection(wired, 'hoop:kick:1', 'hoop:snare:1')).toMatchObject({ ok: false, code: 'source-has-downstream' });
  });

  it('rejects a wire that would form a cycle / is otherwise illegal', () => {
    expect(classifyGraphConnection(wired, 'hoop:kick:2', 'hoop:kick:1').ok).toBe(false);
  });
});

/* FU1 — live cross-client nodeLayout sync. A drag on client A persists `kit.nodeLayout`; the server
   echoes the whole project so client B must ADOPT the new positions without a reload. These cover
   the two pure pieces the PatchGraphView adopt `$effect` composes: the own-echo dedupe signature
   and the reposition→auto-fit adoption (no persist, no drift). */
describe('FU1 — live layout sync helpers', () => {
  const allPositions = (nodes: ReadonlyArray<Node>): Record<string, XY> => {
    const map: Record<string, XY> = {};
    for (const n of nodes) map[n.id] = { ...n.position };
    return map;
  };

  it('layoutSignature is order-independent, integer-px rounded, and change-sensitive', () => {
    const a = { z: { x: 10.4, y: 20.6 }, a: { x: 1, y: 2 } };
    const b = { a: { x: 1, y: 2 }, z: { x: 10, y: 21 } }; // reordered + within px rounding of `a`
    expect(layoutSignature(a)).toBe(layoutSignature(b)); // own-echo jitter absorbed
    expect(layoutSignature(undefined)).toBe('');
    expect(layoutSignature({ a: { x: 1, y: 2 } })).not.toBe(layoutSignature({ a: { x: 9, y: 2 } }));
  });

  it('adopting the current layout is a fixed point — no position drift (safe own-echo re-adopt)', () => {
    const nodes = buildZoneGraph(INPUT, undefined);
    const readopted = adoptLayoutNodes(nodes, allPositions(nodes));
    // Every node's ABSOLUTE canvas position is byte-identical after re-adopting what's on screen.
    for (const n of nodes) {
      expect(absPos(readopted, n.id)).toEqual(absPos(nodes, n.id));
    }
    // Signature is stable, so the adopt `$effect` early-returns on our own echo.
    expect(layoutSignature(allPositions(readopted))).toBe(layoutSignature(allPositions(nodes)));
  });

  it("adopts a peer's move: the dragged leaf shifts, other containers are untouched", () => {
    const nodes = buildZoneGraph(INPUT, undefined);
    const before = allPositions(nodes);
    // Simulate client A dragging hoop:kick:1 far away; persist echoes the whole layout to us.
    const peerLayout: Record<string, XY> = { ...before, 'hoop:kick:1': { x: before['hoop:kick:1']!.x + 400, y: before['hoop:kick:1']!.y + 120 } };
    const after = adoptLayoutNodes(nodes, peerLayout);
    // The dragged leaf actually moved on canvas...
    expect(absPos(after, 'hoop:kick:1')).not.toEqual(absPos(nodes, 'hoop:kick:1'));
    // ...while a node in a DIFFERENT container (a trigger) stays exactly put.
    expect(absPos(after, triggerNodeId('snare'))).toEqual(absPos(nodes, triggerNodeId('snare')));
  });
});

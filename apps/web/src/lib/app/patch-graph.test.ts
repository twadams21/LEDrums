import { describe, expect, it } from 'vitest';
import {
  buildOutputHalf,
  defaultRouting,
  hoopNodeId,
  outputNodeId,
  parseHoopNodeId,
  parseOutputNodeId,
  routingFromGraph,
  type OutputHalfLayout,
} from './patch-graph';
import { patchToOutputs, type PatchRouting } from './patch-routing';
import type { PatchFlowEdge, PatchFlowNode, PatchStage } from './patch-topology';

/* The pure Patch-graph ⇄ routing seam (S3). Covers the 0-based-core ⇄ 1-based-node hoop
   bridge, the fallback chunker, the output-half builder, and — the load-bearing one —
   the rewire round-trip: draw a routing into flow nodes/edges, read it back by vertical
   order, and recompile to the SAME OutputConfig[] (so a rewire never drifts pixel order). */

// --- tiny flow-node/edge factories -------------------------------------------------
function node(id: string, stage: PatchStage, y: number, x: number): PatchFlowNode {
  return { id, type: 'patch', position: { x, y }, data: { label: id, sub: '', stage, role: '' } };
}
const edge = (source: string, target: string): PatchFlowEdge => ({ id: `${source}->${target}`, source, target });

const LAYOUT: OutputHalfLayout = { colDataline: 1000, colOutput: 1200, controllerId: 'controller', midY: 0 };

describe('hoop node id ⇄ HoopRef (0-based core ⇄ 1-based node)', () => {
  it('bridges the index base in both directions', () => {
    expect(hoopNodeId({ drumId: 'snare', hoop: 0 })).toBe('hoop:snare:1');
    expect(hoopNodeId({ drumId: 'tom1', hoop: 3 })).toBe('hoop:tom1:4');
    expect(parseHoopNodeId('hoop:snare:1')).toEqual({ drumId: 'snare', hoop: 0 });
    expect(parseHoopNodeId('hoop:tom1:4')).toEqual({ drumId: 'tom1', hoop: 3 });
  });
  it('rejects non-hoop / malformed ids', () => {
    expect(parseHoopNodeId('output:1')).toBeNull();
    expect(parseHoopNodeId('controller')).toBeNull();
    expect(parseHoopNodeId('hoop:snare')).toBeNull();
  });
});

describe('output node id ⇄ OutputConfig.id', () => {
  it('round-trips and rejects non-output ids', () => {
    expect(outputNodeId('2')).toBe('output:2');
    expect(parseOutputNodeId('output:2')).toBe('2');
    expect(parseOutputNodeId('dataline:1')).toBeNull();
  });
});

describe('defaultRouting (fallback when the project declares no outputs)', () => {
  it('chunks the drum-ordered hoop chain into datalines, one output per chunk', () => {
    const r = defaultRouting([{ id: 'a', hoopCount: 2 }, { id: 'b', hoopCount: 1 }], { hoopsPerDataLine: 2 });
    expect(r.outputs.map((o) => o.id)).toEqual(['1', '2']);
    expect(r.outputs[0]!.dataLines[0]!.hoops).toEqual([
      { drumId: 'a', hoop: 0 },
      { drumId: 'a', hoop: 1 },
    ]);
    expect(r.outputs[1]!.dataLines[0]!.hoops).toEqual([{ drumId: 'b', hoop: 0 }]);
  });
  it('is empty for no drums', () => {
    expect(defaultRouting([]).outputs).toEqual([]);
  });
});

describe('buildOutputHalf', () => {
  it('emits dataline + output nodes and the hoop→dataline→output→controller edges', () => {
    const routing: PatchRouting = {
      outputs: [
        {
          id: '1',
          startUniverse: 0,
          channelsPerPixel: 3,
          dataLines: [{ id: 'x', hoops: [{ drumId: 'a', hoop: 0 }, { drumId: 'a', hoop: 1 }] }],
        },
      ],
    };
    const { nodes, edges } = buildOutputHalf(routing, LAYOUT);
    expect(nodes.filter((n) => n.data.stage === 'dataline')).toHaveLength(1);
    const out = nodes.find((n) => n.data.stage === 'output')!;
    const dl = nodes.find((n) => n.data.stage === 'dataline')!;
    expect(out.id).toBe('output:1');
    expect(edges).toContainEqual(expect.objectContaining({ source: 'hoop:a:1', target: dl.id }));
    expect(edges).toContainEqual(expect.objectContaining({ source: 'hoop:a:2', target: dl.id }));
    expect(edges).toContainEqual(expect.objectContaining({ source: dl.id, target: 'output:1' }));
    expect(edges).toContainEqual(expect.objectContaining({ source: 'output:1', target: 'controller' }));
  });

  it('skips hoop→dataline edges for hoops with no node (hasHoop guard)', () => {
    const routing: PatchRouting = {
      outputs: [
        {
          id: '1',
          startUniverse: 0,
          channelsPerPixel: 3,
          dataLines: [{ id: 'x', hoops: [{ drumId: 'a', hoop: 0 }, { drumId: 'ghost', hoop: 9 }] }],
        },
      ],
    };
    const { edges } = buildOutputHalf(routing, { ...LAYOUT, hasHoop: (id) => id === 'hoop:a:1' });
    expect(edges.some((e) => e.source === 'hoop:a:1')).toBe(true);
    expect(edges.some((e) => e.source === 'hoop:ghost:10')).toBe(false);
  });
});

describe('routingFromGraph', () => {
  it('orders outputs / datalines / hoops by vertical (y) position, not array/id order', () => {
    const nodes: PatchFlowNode[] = [
      node('hoop:a:1', 'hoop', 30, 0), // a:1 (hoop 0) sits BELOW a:2 (hoop 1)
      node('hoop:a:2', 'hoop', 10, 0),
      node('dataline:1', 'dataline', 20, 1000),
      node('output:1', 'output', 20, 1200),
    ];
    const edges = [edge('hoop:a:1', 'dataline:1'), edge('hoop:a:2', 'dataline:1'), edge('dataline:1', 'output:1')];
    const r = routingFromGraph(nodes, edges);
    expect(r.outputs[0]!.dataLines[0]!.hoops).toEqual([
      { drumId: 'a', hoop: 1 }, // y=10 first
      { drumId: 'a', hoop: 0 }, // y=30 second
    ]);
  });

  it('ignores mis-staged / stray wires (a hoop wired straight to an output)', () => {
    const nodes: PatchFlowNode[] = [
      node('hoop:a:1', 'hoop', 0, 0),
      node('output:1', 'output', 0, 1200),
    ];
    // hoop→output skips the dataline stage → not a valid routing edge → dropped
    const r = routingFromGraph(nodes, [edge('hoop:a:1', 'output:1')]);
    expect(r.outputs).toEqual([{ id: '1', startUniverse: 0, channelsPerPixel: 3, dataLines: [] }]);
  });

  it('reads per-output scalars via getScalars (else a sensible default)', () => {
    const nodes = [node('output:7', 'output', 0, 1200)];
    const r = routingFromGraph(nodes, [], (id) =>
      id === '7' ? { startUniverse: 5, channelsPerPixel: 4 } : { startUniverse: 0, channelsPerPixel: 3 },
    );
    expect(r.outputs[0]).toMatchObject({ id: '7', startUniverse: 5, channelsPerPixel: 4 });
  });
});

describe('rewire round-trip: routing → graph → routing preserves transmit order', () => {
  /** Hoop nodes in transmit order with ASCENDING y, so the read-back reproduces order. */
  function hoopNodes(routing: PatchRouting): PatchFlowNode[] {
    const seen = new Set<string>();
    const out: PatchFlowNode[] = [];
    let y = 0;
    for (const o of routing.outputs)
      for (const dl of o.dataLines)
        for (const h of dl.hoops) {
          const id = hoopNodeId(h);
          if (seen.has(id)) continue;
          seen.add(id);
          out.push(node(id, 'hoop', y, 0));
          y += 10;
        }
    return out;
  }

  it('recompiles to the identical OutputConfig[] (contiguous, drum-boundary, multi-output)', () => {
    const routing: PatchRouting = {
      outputs: [
        {
          id: '1',
          startUniverse: 0,
          channelsPerPixel: 3,
          dataLines: [
            { id: 'a', hoops: [{ drumId: 'kick', hoop: 0 }, { drumId: 'kick', hoop: 1 }] },
            { id: 'b', hoops: [{ drumId: 'snare', hoop: 0 }] },
          ],
        },
        {
          id: '2',
          startUniverse: 10,
          channelsPerPixel: 4,
          dataLines: [{ id: 'c', hoops: [{ drumId: 'snare', hoop: 1 }, { drumId: 'tom1', hoop: 0 }] }],
        },
      ],
    };
    const oh = buildOutputHalf(routing, LAYOUT);
    const readBack = routingFromGraph([...hoopNodes(routing), ...oh.nodes], oh.edges, (id) => {
      const o = routing.outputs.find((x) => x.id === id)!;
      return { startUniverse: o.startUniverse, channelsPerPixel: o.channelsPerPixel };
    });
    expect(patchToOutputs(readBack)).toEqual(patchToOutputs(routing));
  });
});

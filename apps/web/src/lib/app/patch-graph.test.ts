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
import { patchToOutputs, pixelRanges, type PatchRouting } from './patch-routing';
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
    // default scalars are dense — no startUniverse emitted.
    expect(r.outputs).toEqual([{ id: '1', channelsPerPixel: 3, dataLines: [] }]);
  });

  it('reads per-output scalars via getScalars (default = dense, no startUniverse)', () => {
    const nodes = [node('output:7', 'output', 0, 1200)];
    const r = routingFromGraph(nodes, [], (id) =>
      id === '7' ? { startUniverse: 5, channelsPerPixel: 4 } : { channelsPerPixel: 3 },
    );
    expect(r.outputs[0]).toMatchObject({ id: '7', startUniverse: 5, channelsPerPixel: 4 });
  });

  it('recovers a data line startUniverse via getLineUniverse (by output id + line index)', () => {
    const nodes: PatchFlowNode[] = [
      node('hoop:a:1', 'hoop', 0, 0),
      node('hoop:a:2', 'hoop', 20, 0),
      node('dataline:1', 'dataline', 0, 1000), // index 0 within output:1
      node('dataline:2', 'dataline', 20, 1000), // index 1 within output:1
      node('output:1', 'output', 10, 1200),
    ];
    const edges = [
      edge('hoop:a:1', 'dataline:1'),
      edge('hoop:a:2', 'dataline:2'),
      edge('dataline:1', 'output:1'),
      edge('dataline:2', 'output:1'),
    ];
    // only the second line (index 1) carries a snap.
    const r = routingFromGraph(nodes, edges, undefined, (outputId, i) =>
      outputId === '1' && i === 1 ? 7 : undefined,
    );
    expect(r.outputs[0]!.dataLines[0]!.startUniverse).toBeUndefined();
    expect(r.outputs[0]!.dataLines[1]!.startUniverse).toBe(7);
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

  it('recompiles to the identical OutputConfig[] (data lines 1:1, drum-boundary, multi-output)', () => {
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
    // buildOutputHalf re-mints data-line node ids, so compare modulo the cosmetic line id:
    // the load-bearing invariant is the per-output, per-line SEGMENT stream + line count/order.
    const norm = (cfgs: ReturnType<typeof patchToOutputs>) =>
      cfgs.map((c) => ({ ...c, dataLines: c.dataLines.map((d, i) => ({ ...d, id: i })) }));
    expect(norm(patchToOutputs(readBack))).toEqual(norm(patchToOutputs(routing)));
    // ...and the data-line count is preserved 1:1 (wire-in-N-stays-N).
    expect(patchToOutputs(readBack).flatMap((c) => c.dataLines)).toHaveLength(3);
  });
});

describe('live read-out (S5b): pixelRanges over routingFromGraph keys spans by graph node id', () => {
  /* The Inspector's first/last-pixel read-out derives from the LIVE graph routing, not from
     a re-chunked snapshot of committed outputs. routingFromGraph keeps each DataLine.id and
     each output id equal to the selected node's id (a dataline node verbatim, an output via
     parseOutputNodeId), so pixelRanges' byDataLine/byOutput resolve for a just-added palette
     line ('dataline:new-N') and stay correct after an un-remounted drag-reorder — exactly the
     cases the old '${outputId}:dl${n}' snapshot ids could never match. */
  const px = (): number => 10; // every hoop = 10px

  it('resolves a span for a palette data line by its node id', () => {
    const nodes: PatchFlowNode[] = [
      node('hoop:a:1', 'hoop', 0, 0),
      node('hoop:a:2', 'hoop', 10, 0),
      node('dataline:new-1', 'dataline', 5, 1000), // palette-added id — never matches a re-chunked id
      node('output:new-1', 'output', 5, 1200),
      node('controller', 'controller', 5, 1400),
    ];
    const edges = [
      edge('hoop:a:1', 'dataline:new-1'),
      edge('hoop:a:2', 'dataline:new-1'),
      edge('dataline:new-1', 'output:new-1'),
      edge('output:new-1', 'controller'),
    ];
    const { byDataLine, byOutput } = pixelRanges(routingFromGraph(nodes, edges), px);
    expect(byDataLine['dataline:new-1']).toEqual({ first: 0, last: 19 });
    expect(byOutput['new-1']).toEqual({ first: 0, last: 19 }); // output id = parseOutputNodeId('output:new-1')
  });

  it('updates a data line span after a drag-reorder without a remount (y-order swap)', () => {
    // Two data lines feeding one output; each carries one hoop. Reordering them by vertical
    // position swaps their transmit order — and therefore their pixel spans — with no remount.
    const graph = (dl1Y: number, dl2Y: number): { nodes: PatchFlowNode[]; edges: PatchFlowEdge[] } => ({
      nodes: [
        node('hoop:a:1', 'hoop', dl1Y, 0),
        node('hoop:b:1', 'hoop', dl2Y, 0),
        node('dataline:1', 'dataline', dl1Y, 1000),
        node('dataline:2', 'dataline', dl2Y, 1000),
        node('output:1', 'output', (dl1Y + dl2Y) / 2, 1200),
      ],
      edges: [
        edge('hoop:a:1', 'dataline:1'),
        edge('hoop:b:1', 'dataline:2'),
        edge('dataline:1', 'output:1'),
        edge('dataline:2', 'output:1'),
      ],
    });

    const before = graph(0, 20); // dataline:1 above dataline:2 → transmits first
    const r1 = pixelRanges(routingFromGraph(before.nodes, before.edges), px);
    expect(r1.byDataLine['dataline:1']).toEqual({ first: 0, last: 9 });
    expect(r1.byDataLine['dataline:2']).toEqual({ first: 10, last: 19 });

    const after = graph(20, 0); // drag dataline:2 ABOVE dataline:1 → it now transmits first
    const r2 = pixelRanges(routingFromGraph(after.nodes, after.edges), px);
    expect(r2.byDataLine['dataline:2']).toEqual({ first: 0, last: 9 });
    expect(r2.byDataLine['dataline:1']).toEqual({ first: 10, last: 19 });
  });
});

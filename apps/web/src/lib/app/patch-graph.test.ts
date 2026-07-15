import { describe, expect, it, vi } from 'vitest';
import type { OutputConfig } from '@ledrums/core';
import {
  buildOutputHalf,
  defaultRouting,
  hoopNodeId,
  outputNodeId,
  outputsSignature,
  parseHoopNodeId,
  parseOutputNodeId,
  rebuildOutputHalf,
  routingFromGraph,
  routingSignature,
  type OutputHalfLayout,
} from './patch-graph';
import { parseKit } from '@ledrums/core';
import { hasHoopFanOut, outputsToPatch, patchToOutputs, pixelRanges, type PatchRouting } from './patch-routing';
import type { PatchFlowEdge, PatchFlowNode, PatchStage } from './patch-topology';
import { guardFlowCallback } from './views/flow-guard';

/* The pure Patch-graph ⇄ routing seam (S3). Covers the (uniformly 1-based, A1) hoop node-id
   grammar, the fallback chunker, the output-half builder, and — the load-bearing one — the
   rewire round-trip: draw a routing into flow nodes/edges, read it back by WALKING THE WIRE
   CHAIN (Output→Hoop→Hoop, D1: not y-position), and recompile to the SAME OutputConfig[] (so a
   rewire never drifts pixel order). */

// --- tiny flow-node/edge factories -------------------------------------------------
function node(id: string, stage: PatchStage, y: number, x: number): PatchFlowNode {
  return { id, type: 'patch', position: { x, y }, data: { label: id, sub: '', stage, role: '' } };
}
const edge = (source: string, target: string): PatchFlowEdge => ({ id: `${source}->${target}`, source, target });

const LAYOUT: OutputHalfLayout = { colOutput: 1200, controllerId: 'controller', midY: 0 };

describe('hoop node id ⇄ HoopRef (both 1-based, A1)', () => {
  it('round-trips the shared 1-based hoop number in both directions', () => {
    expect(hoopNodeId({ drumId: 'snare', hoop: 1 })).toBe('hoop:snare:1');
    expect(hoopNodeId({ drumId: 'tom1', hoop: 4 })).toBe('hoop:tom1:4');
    expect(parseHoopNodeId('hoop:snare:1')).toEqual({ drumId: 'snare', hoop: 1 });
    expect(parseHoopNodeId('hoop:tom1:4')).toEqual({ drumId: 'tom1', hoop: 4 });
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
    expect(parseOutputNodeId('hoop:a:1')).toBeNull();
  });
});

describe('defaultRouting (fallback when the project declares no outputs)', () => {
  it('chunks the drum-ordered hoop chain into outputs, one per chunk (Output = one run)', () => {
    const r = defaultRouting([{ id: 'a', hoopCount: 2 }, { id: 'b', hoopCount: 1 }], { hoopsPerOutput: 2 });
    expect(r.outputs.map((o) => o.id)).toEqual(['1', '2']);
    expect(r.outputs[0]!.hoops).toEqual([
      { drumId: 'a', hoop: 1 },
      { drumId: 'a', hoop: 2 },
    ]);
    expect(r.outputs[1]!.hoops).toEqual([{ drumId: 'b', hoop: 1 }]);
  });
  it('is empty for no drums', () => {
    expect(defaultRouting([]).outputs).toEqual([]);
  });
});

describe('buildOutputHalf', () => {
  it('emits an Output node and the Output→Hoop→Hoop chain + output→controller edges', () => {
    const routing: PatchRouting = {
      outputs: [{ id: '1', startUniverse: 0, channelsPerPixel: 3, hoops: [{ drumId: 'a', hoop: 1 }, { drumId: 'a', hoop: 2 }] }],
    };
    const { nodes, edges } = buildOutputHalf(routing, LAYOUT);
    expect(nodes.filter((n) => n.data.stage === 'output')).toHaveLength(1);
    const out = nodes.find((n) => n.data.stage === 'output')!;
    expect(out.id).toBe('output:1');
    expect(edges).toContainEqual(expect.objectContaining({ source: 'output:1', target: 'hoop:a:1' }));
    expect(edges).toContainEqual(expect.objectContaining({ source: 'hoop:a:1', target: 'hoop:a:2' }));
    expect(edges).toContainEqual(expect.objectContaining({ source: 'output:1', target: 'controller' }));
  });

  it('never emits duplicate node/edge keys from a corrupt routing (each_key_duplicate guard)', () => {
    // A shape-valid-but-integrity-invalid routing (reachable via paste / setProject bypass):
    // the same hoop repeated within one output's chain, and two outputs sharing an id. Either
    // would mint a duplicate flow key and crash SvelteFlow's keyed each — the builder must not.
    const routing: PatchRouting = {
      outputs: [
        { id: '1', channelsPerPixel: 3, hoops: [{ drumId: 'a', hoop: 1 }, { drumId: 'a', hoop: 1 }] },
        { id: '1', channelsPerPixel: 3, hoops: [{ drumId: 'b', hoop: 1 }] },
      ],
    };
    const { nodes, edges } = buildOutputHalf(routing, LAYOUT);
    expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length); // all node ids unique
    expect(new Set(edges.map((e) => e.id)).size).toBe(edges.length); // all edge ids unique
    // the repeated hoop collapses to a single output→hoop edge
    expect(edges.filter((e) => e.source === 'output:1' && e.target === 'hoop:a:1')).toHaveLength(1);
    // the duplicate output id keeps only the first output node
    expect(nodes.filter((n) => n.id === 'output:1')).toHaveLength(1);
  });

  it('skips chain edges onto hoops with no node (hasHoop guard)', () => {
    const routing: PatchRouting = {
      outputs: [{ id: '1', startUniverse: 0, channelsPerPixel: 3, hoops: [{ drumId: 'a', hoop: 1 }, { drumId: 'ghost', hoop: 9 }] }],
    };
    const { edges } = buildOutputHalf(routing, { ...LAYOUT, hasHoop: (id) => id === 'hoop:a:1' });
    expect(edges).toContainEqual(expect.objectContaining({ source: 'output:1', target: 'hoop:a:1' }));
    expect(edges.some((e) => e.source === 'hoop:ghost:9' || e.target === 'hoop:ghost:9')).toBe(false);
  });
});

describe('routingFromGraph', () => {
  it('orders each run by WALKING THE WIRE CHAIN, not by y-position', () => {
    // Chain is output→a:1→a:2, but a:1 sits BELOW a:2 (larger y). A y-sort would give [a:2, a:1];
    // the wire walk gives [a:1, a:2] — proving order comes from the chain, not geometry.
    const nodes: PatchFlowNode[] = [
      node('output:1', 'output', 0, 1200),
      node('hoop:a:1', 'hoop', 100, 0), // first in the chain, but lowest on screen
      node('hoop:a:2', 'hoop', 0, 0),
    ];
    const edges = [edge('output:1', 'hoop:a:1'), edge('hoop:a:1', 'hoop:a:2')];
    const r = routingFromGraph(nodes, edges);
    expect(r.outputs[0]!.hoops).toEqual([
      { drumId: 'a', hoop: 1 },
      { drumId: 'a', hoop: 2 },
    ]);
  });

  it('leaves an output with no output→hoop wire as an empty run', () => {
    const nodes: PatchFlowNode[] = [node('hoop:a:1', 'hoop', 0, 0), node('output:1', 'output', 0, 1200)];
    // a hoop→output wire is not a chain root (only output→hoop is) → ignored → empty run.
    const r = routingFromGraph(nodes, [edge('hoop:a:1', 'output:1')]);
    expect(r.outputs).toEqual([{ id: '1', channelsPerPixel: 3, hoops: [] }]);
  });

  it('is cycle-safe and collapses parallel output→hoop edges (never spins / double-lists)', () => {
    // Two edges from the output into the same hoop (a transiently-corrupt graph); the walk takes
    // the topmost and the seen-guard stops it listing the hoop twice or looping forever.
    const nodes: PatchFlowNode[] = [node('hoop:a:1', 'hoop', 0, 0), node('output:1', 'output', 0, 1200)];
    const edges = [
      edge('output:1', 'hoop:a:1'),
      { id: 'output:1->hoop:a:1:dup', source: 'output:1', target: 'hoop:a:1' },
    ];
    const r = routingFromGraph(nodes, edges);
    expect(r.outputs[0]!.hoops).toEqual([{ drumId: 'a', hoop: 1 }]);
  });

  it('reads per-output scalars via getScalars (default = dense, no startUniverse)', () => {
    const nodes = [node('output:7', 'output', 0, 1200)];
    const r = routingFromGraph(nodes, [], (id) =>
      id === '7' ? { startUniverse: 5, channelsPerPixel: 4, rgbOrder: 'GRB' } : { channelsPerPixel: 3 },
    );
    expect(r.outputs[0]).toMatchObject({ id: '7', startUniverse: 5, channelsPerPixel: 4, rgbOrder: 'GRB' });
  });

  it('orders OUTPUTS themselves top→bottom for a stable output list', () => {
    const nodes: PatchFlowNode[] = [
      node('output:2', 'output', 30, 1200), // below
      node('output:1', 'output', 10, 1200), // above
    ];
    const r = routingFromGraph(nodes, []);
    expect(r.outputs.map((o) => o.id)).toEqual(['1', '2']);
  });
});

describe('rewire round-trip: routing → graph → routing preserves transmit order', () => {
  /** Hoop nodes for a routing (ascending y — position is cosmetic; the chain edges carry order). */
  function hoopNodes(routing: PatchRouting): PatchFlowNode[] {
    const seen = new Set<string>();
    const out: PatchFlowNode[] = [];
    let y = 0;
    for (const o of routing.outputs)
      for (const h of o.hoops) {
        const id = hoopNodeId(h);
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(node(id, 'hoop', y, 0));
        y += 10;
      }
    return out;
  }

  it('recompiles to the identical OutputConfig[] (1:1 outputs, drum-boundary, multi-output)', () => {
    const routing: PatchRouting = {
      outputs: [
        { id: '1', startUniverse: 0, channelsPerPixel: 3, hoops: [{ drumId: 'kick', hoop: 1 }, { drumId: 'kick', hoop: 2 }, { drumId: 'snare', hoop: 1 }] },
        { id: '2', startUniverse: 10, channelsPerPixel: 4, hoops: [{ drumId: 'snare', hoop: 2 }, { drumId: 'tom1', hoop: 1 }] },
      ],
    };
    const oh = buildOutputHalf(routing, LAYOUT);
    const readBack = routingFromGraph([...hoopNodes(routing), ...oh.nodes], oh.edges, (id) => {
      const o = routing.outputs.find((x) => x.id === id)!;
      return { startUniverse: o.startUniverse, channelsPerPixel: o.channelsPerPixel };
    });
    // Output ids are preserved 1:1 (node id ⇄ output id), so the recompile is byte-identical.
    expect(patchToOutputs(readBack)).toEqual(patchToOutputs(routing));
    expect(patchToOutputs(readBack)).toHaveLength(2);
  });
});

describe('routingSignature / outputsSignature (the cold-load adopt discriminator)', () => {
  /* The Patch view re-adopts the server's `kit.outputs` only when their canonical signature
     differs from what's already drawn — so a routing and the OutputConfig[] it compiles to MUST
     share one signature (else the echo of the user's own rewire would snap the graph back). */
  const routing: PatchRouting = {
    outputs: [
      { id: '1', channelsPerPixel: 3, hoops: [{ drumId: 'kick', hoop: 1 }, { drumId: 'kick', hoop: 2 }, { drumId: 'snare', hoop: 1 }] },
      { id: '2', startUniverse: 4, channelsPerPixel: 4, hoops: [{ drumId: 'tom1', hoop: 1 }] },
    ],
  };

  it('a routing and the OutputConfig[] it compiles to share one signature (echo = no-op)', () => {
    expect(outputsSignature(patchToOutputs(routing))).toBe(routingSignature(routing));
  });

  it('is stable across a repeated outputs → routing → outputs round-trip (canonical normal form)', () => {
    const once = patchToOutputs(routing);
    const twice = patchToOutputs(outputsToPatch(once));
    expect(outputsSignature(twice)).toBe(outputsSignature(once));
  });

  it('is insensitive to OutputConfig key order (same wiring → same signature)', () => {
    const canonical: OutputConfig[] = [
      { id: '1', channelsPerPixel: 3, segments: [{ drumId: 'kick', hoopStart: 1, hoopEnd: 2 }] },
    ];
    // same wiring, keys inserted in a different order (as a re-serializing server might)
    const reordered: OutputConfig[] = [
      { segments: [{ drumId: 'kick', hoopStart: 1, hoopEnd: 2 }], channelsPerPixel: 3, id: '1' },
    ];
    expect(outputsSignature(reordered)).toBe(outputsSignature(canonical));
  });

  it('a genuine external change yields a different signature (so adopt fires)', () => {
    const external: PatchRouting = {
      outputs: [{ id: '1', channelsPerPixel: 3, hoops: [{ drumId: 'kick', hoop: 1 }] }],
    };
    expect(routingSignature(external)).not.toBe(routingSignature(routing));
  });
});

describe('rebuildOutputHalf (S02 self-heal): re-derive the output half from authoritative routing', () => {
  /* The Patch guard, on a thrown handler, re-derives the output half from the project's
     authoritative outputs — discarding a half-applied local mutation — while leaving the
     input half + controller sink intact. This is the pure math the view's forceRebuild binds
     to; tested through the derivation helpers (no browser), per the acceptance. */

  /** Authoritative routing (dense scalars, so routingFromGraph's defaults compare 1:1). */
  const auth: PatchRouting = {
    outputs: [
      { id: '1', channelsPerPixel: 3, hoops: [{ drumId: 'kick', hoop: 1 }, { drumId: 'kick', hoop: 2 }, { drumId: 'snare', hoop: 1 }] },
      { id: '2', channelsPerPixel: 3, hoops: [{ drumId: 'snare', hoop: 2 }] },
    ],
  };

  /** Build a full graph (input-half hoop nodes + controller sink + the output half) that
      DRAWS `routing`, mirroring the view's mount composition. */
  function fullGraph(routing: PatchRouting): {
    nodes: PatchFlowNode[];
    edges: PatchFlowEdge[];
    layout: OutputHalfLayout;
  } {
    const hoopIds = new Set<string>();
    const hoopNodes: PatchFlowNode[] = [];
    let y = 0;
    for (const o of routing.outputs)
      for (const h of o.hoops) {
        const id = hoopNodeId(h);
        if (hoopIds.has(id)) continue;
        hoopIds.add(id);
        hoopNodes.push(node(id, 'hoop', y, 0));
        y += 10;
      }
    const layout: OutputHalfLayout = { ...LAYOUT, hasHoop: (id) => hoopIds.has(id) };
    const oh = buildOutputHalf(routing, layout);
    return { nodes: [...hoopNodes, node('controller', 'controller', 0, 1400), ...oh.nodes], edges: oh.edges, layout };
  }

  const sig = (g: { nodes: ReadonlyArray<PatchFlowNode>; edges: ReadonlyArray<PatchFlowEdge> }): string =>
    routingSignature(routingFromGraph(g.nodes, g.edges));

  it('re-derives canvas state equal to a fresh derivation, discarding a half-applied mutation', () => {
    const clean = fullGraph(auth);
    const cleanSig = sig(clean);
    // "Derived fresh from store.project.kit.outputs" == the authoritative segment stream.
    expect(cleanSig).toBe(outputsSignature(patchToOutputs(auth)));

    // Half-applied mutation: a stray misrouted output node + a chain edge dropped and re-pointed
    // (as a throw mid-handler could leave). The read-back now diverges from authoritative.
    const corrupted = {
      nodes: [...clean.nodes, node('output:99', 'output', 500, 1200)],
      edges: [
        ...clean.edges.filter((e) => e.source !== 'output:1'), // dropped output:1's chain root
        edge('output:99', 'hoop:kick:1'), // stray wire from the ghost output
      ],
    };
    expect(sig(corrupted)).not.toBe(cleanSig); // genuinely corrupt

    const healed = rebuildOutputHalf(auth, corrupted, clean.layout);
    // Re-derived state === state derived fresh from the authoritative routing.
    expect(sig(healed)).toBe(cleanSig);
    // The ghost output node is gone; no stray output-half nodes survive.
    expect(healed.nodes.some((n) => n.id === 'output:99')).toBe(false);
  });

  it('leaves the input half + controller sink untouched', () => {
    const clean = fullGraph(auth);
    const inputBefore = clean.nodes.filter((n) => n.data.stage === 'hoop' || n.data.stage === 'controller');
    const healed = rebuildOutputHalf(auth, clean, clean.layout);
    const inputAfter = healed.nodes.filter((n) => n.data.stage === 'hoop' || n.data.stage === 'controller');
    expect(inputAfter).toEqual(inputBefore);
  });

  it('preserves a surviving output node position (a forced rebuild does not fight a nudged layout)', () => {
    const clean = fullGraph(auth);
    const nudged = {
      nodes: clean.nodes.map((n) => (n.id === 'output:1' ? { ...n, position: { x: 9999, y: 7777 } } : n)),
      edges: clean.edges,
    };
    const healed = rebuildOutputHalf(auth, nudged, clean.layout);
    expect(healed.nodes.find((n) => n.id === 'output:1')!.position).toEqual({ x: 9999, y: 7777 });
  });

  it('a guarded throw reports the fault AND self-heals to the authoritative state', () => {
    // Compose exactly what the view's guard does: guardFlowCallback → onFault(report + rebuild).
    let graph = fullGraph(auth) as { nodes: PatchFlowNode[]; edges: PatchFlowEdge[]; layout: OutputHalfLayout };
    const layout = graph.layout;
    const reportError = vi.fn();

    const onFault = (where: string, err: unknown): void => {
      reportError('patch-graph', where, String(err));
      const rebuilt = rebuildOutputHalf(auth, graph, layout); // re-derive from authoritative
      graph = { ...graph, nodes: rebuilt.nodes, edges: rebuilt.edges };
    };
    // A handler that applies a partial mutation, THEN throws (the canvas is left half-mutated).
    const badHandler = guardFlowCallback(
      'reconnect',
      () => {
        graph.edges = [...graph.edges.filter((e) => e.source !== 'output:1'), edge('output:99', 'hoop:kick:1')];
        graph.nodes = [...graph.nodes, node('output:99', 'output', 500, 1200)];
        throw new Error('boom');
      },
      onFault,
    );

    badHandler();

    expect(reportError).toHaveBeenCalledWith('patch-graph', 'reconnect', expect.stringContaining('boom'));
    // healed to the authoritative segment stream, not left half-mutated
    expect(sig(graph)).toBe(outputsSignature(patchToOutputs(auth)));
    expect(graph.nodes.some((n) => n.id === 'output:99')).toBe(false);
  });
});

describe('live read-out (S5b): pixelRanges over routingFromGraph keys spans by output node id', () => {
  /* The Inspector's first/last-pixel read-out derives from the LIVE graph routing, not from a
     re-chunked snapshot of committed outputs. routingFromGraph keeps each output id equal to the
     selected node's id (via parseOutputNodeId), so pixelRanges' byOutput resolves for a
     just-added palette output ('output:new-N') and stays correct after an un-remounted drag. */
  const px = (): number => 10; // every hoop = 10px

  it('resolves a span for a palette output by its node id', () => {
    const nodes: PatchFlowNode[] = [
      node('hoop:a:1', 'hoop', 0, 0),
      node('hoop:a:2', 'hoop', 10, 0),
      node('output:new-1', 'output', 5, 1200),
      node('controller', 'controller', 5, 1400),
    ];
    const edges = [
      edge('output:new-1', 'hoop:a:1'),
      edge('hoop:a:1', 'hoop:a:2'),
      edge('output:new-1', 'controller'),
    ];
    const { byOutput } = pixelRanges(routingFromGraph(nodes, edges), px);
    expect(byOutput['new-1']).toEqual({ first: 0, last: 19 }); // output id = parseOutputNodeId('output:new-1')
  });

  it('updates output spans after a drag-reorder of the OUTPUTS (y-order swap, no remount)', () => {
    // Two outputs, one hoop each. Output transmit order is top→bottom, so swapping their y swaps
    // their global pixel spans with no remount.
    const graph = (o1Y: number, o2Y: number): { nodes: PatchFlowNode[]; edges: PatchFlowEdge[] } => ({
      nodes: [
        node('hoop:a:1', 'hoop', 0, 0),
        node('hoop:b:1', 'hoop', 40, 0),
        node('output:1', 'output', o1Y, 1200),
        node('output:2', 'output', o2Y, 1200),
      ],
      edges: [edge('output:1', 'hoop:a:1'), edge('output:2', 'hoop:b:1')],
    });

    const before = graph(0, 20); // output:1 above output:2 → transmits first
    const r1 = pixelRanges(routingFromGraph(before.nodes, before.edges), px);
    expect(r1.byOutput['1']).toEqual({ first: 0, last: 9 });
    expect(r1.byOutput['2']).toEqual({ first: 10, last: 19 });

    const after = graph(20, 0); // drag output:2 ABOVE output:1 → it now transmits first
    const r2 = pixelRanges(routingFromGraph(after.nodes, after.edges), px);
    expect(r2.byOutput['2']).toEqual({ first: 0, last: 9 });
    expect(r2.byOutput['1']).toEqual({ first: 10, last: 19 });
  });
});

describe('connect-time fan-out guard (S11) — routingFromGraph ∘ hasHoopFanOut', () => {
  // The exact composition PatchGraphView.onBeforeConnect runs: read the PROSPECTIVE graph
  // (current edges + the candidate wire) back to a routing and ask S07's core rule.
  const kit = parseKit({
    global: { ledDensityPxPerM: 100, hoopCount: 1, defaultHoopSpacingMm: 50 },
    drums: [
      { id: 'snare', diameterIn: 6, hoopSpacingMm: 50, hoopCount: 2, pixelsPerHoop: 10, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
    ],
    outputs: [],
  });

  // snare#1 (node `hoop:snare:1`) currently rooted by output:o1; output:o2 is unwired.
  const baseNodes: PatchFlowNode[] = [
    node('hoop:snare:1', 'hoop', 0, 800),
    node('hoop:snare:2', 'hoop', 40, 800),
    node('output:o1', 'output', 0, 1200),
    node('output:o2', 'output', 40, 1200),
  ];
  const baseEdges: PatchFlowEdge[] = [edge('output:o1', 'hoop:snare:1')];

  it('the live routing (no candidate wire) is clean — the guard never false-positives', () => {
    expect(hasHoopFanOut(kit, routingFromGraph(baseNodes, baseEdges))).toBe(false);
  });

  it('a NEW wire driving the same hoop from a second output is flagged (would be rejected)', () => {
    const probe = edge('output:o2', 'hoop:snare:1'); // snare#1 now driven by o1 AND o2 → fan-out
    const prospective = routingFromGraph(baseNodes, [...baseEdges, probe]);
    expect(hasHoopFanOut(kit, prospective)).toBe(true);
  });

  it('a RE-HOME (move the one root wire to the other output) is clean — reconnect is not a fan-out', () => {
    // onReconnect updates the edge in place: output:o1→snare#1 REPLACED by output:o2→snare#1.
    const moved = baseEdges.map((e) => (e.source === 'output:o1' ? edge('output:o2', 'hoop:snare:1') : e));
    expect(hasHoopFanOut(kit, routingFromGraph(baseNodes, moved))).toBe(false);
  });
});

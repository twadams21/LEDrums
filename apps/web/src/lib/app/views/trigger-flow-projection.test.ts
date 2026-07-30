import { describe, expect, it } from 'vitest';
import { makeNode, type GraphNode, type NodeKind, type TriggerGraph } from '../../trigger-lab/sim';
import { normalizeGraphs } from '../../trigger-lab/store/hydrate';
import {
  emptyTriggerProjectionCache,
  projectionDesyncIds,
  projectTriggerFlowNodes,
  resetProjectionCache,
  triggerEdgeSignature,
  triggerNodeSignature,
} from './trigger-flow-projection';

describe('projectTriggerFlowNodes', () => {
  it('rebuilds a same-id node when the authoritative graph position changes under the same key', () => {
    const graph: TriggerGraph = { nodes: [makeNode('trigger', 'trigger', 10, 20)], edges: [] };
    const first = projectTriggerFlowNodes({
      graph,
      graphKey: 'graph-a',
      selectedNodeId: null,
      previousNodes: [],
      cache: emptyTriggerProjectionCache(),
    });
    const moved: TriggerGraph = { nodes: [makeNode('trigger', 'trigger', 700, 800)], edges: [] };

    const second = projectTriggerFlowNodes({
      graph: moved,
      graphKey: 'graph-a',
      selectedNodeId: null,
      previousNodes: first.nodes,
      cache: first.cache,
    });

    expect(second.nodes[0]).not.toBe(first.nodes[0]);
    expect(second.nodes[0]!.position).toEqual({ x: 700, y: 800 });
  });

  it('rebuilds a same-id node when modulation parameter rows change its handles', () => {
    const graph: TriggerGraph = {
      nodes: [makeNode('effect', 'p1', 10, 20, { effectId: 'gen:radial-wash' })],
      edges: [],
    };
    const first = projectTriggerFlowNodes({
      graph,
      graphKey: 'graph-a',
      selectedNodeId: null,
      previousNodes: [],
      cache: emptyTriggerProjectionCache(),
    });
    const modulated: TriggerGraph = {
      nodes: [
        makeNode('effect', 'p1', 10, 20, {
          effectId: 'gen:radial-wash',
          modInputs: [{ param: 'brightness' }],
        }),
      ],
      edges: [],
    };

    const second = projectTriggerFlowNodes({
      graph: modulated,
      graphKey: 'graph-a',
      selectedNodeId: null,
      previousNodes: first.nodes,
      cache: first.cache,
    });

    expect(second.nodes[0]).not.toBe(first.nodes[0]);
  });

  // R01 (GH #80) regression — the vanishing/reappearing wire. A Mix node renders ONE input
  // handle per incoming flow edge (`mix-edge:<edgeId>`). Adding a wire into a Mix node changes
  // its handle SET but not any node FIELD, so a signature that ignores incoming edges made the
  // projection reuse the mix node with stale measured handleBounds — xyflow then had nowhere to
  // attach the new edge, so the wire vanished until a refresh re-measured. The mix node must
  // rebuild when its incoming flow-edge set changes (mirrors the modulation-rows case above).
  it('rebuilds a Mix node when an incoming flow edge is added (handle set changed)', () => {
    const base = (edges: TriggerGraph['edges']): TriggerGraph => ({
      version: 3,
      nodes: [
        makeNode('trigger', 'trigger', 0, 0),
        makeNode('effect', 'e1', 100, 0, { effectId: 'gen:radial-wash' }),
        makeNode('effect', 'e2', 100, 120, { effectId: 'gen:radial-wash' }),
        makeNode('mix', 'm1', 300, 60),
        makeNode('output', 'output', 500, 60),
      ],
      edges,
    });
    const before = base([{ id: 'w1', from: 'e1', to: 'm1' }]);
    const after = base([
      { id: 'w1', from: 'e1', to: 'm1' },
      { id: 'w2', from: 'e2', to: 'm1' },
    ]);

    const first = projectTriggerFlowNodes({
      graph: before,
      graphKey: 'graph-a',
      selectedNodeId: null,
      previousNodes: [],
      cache: emptyTriggerProjectionCache(),
    });
    const second = projectTriggerFlowNodes({
      graph: after,
      graphKey: 'graph-a',
      selectedNodeId: null,
      previousNodes: first.nodes,
      cache: first.cache,
    });

    const mixBefore = first.nodes.find((n) => n.id === 'm1')!;
    const mixAfter = second.nodes.find((n) => n.id === 'm1')!;
    expect(mixAfter).not.toBe(mixBefore); // rebuilt → xyflow re-measures the new mix-row handle
  });

  it('folds a Mix node incoming flow-edge set into its signature (add / remove / dedupe)', () => {
    const nodes = [makeNode('trigger', 'trigger', 0, 0), makeNode('mix', 'm1', 100, 0)];
    const sig = (edges: TriggerGraph['edges']) => triggerNodeSignature(nodes[1]!, { version: 3, nodes, edges });

    const none = sig([]);
    const one = sig([{ id: 'w1', from: 'a', to: 'm1' }]);
    const two = sig([
      { id: 'w1', from: 'a', to: 'm1' },
      { id: 'w2', from: 'b', to: 'm1' },
    ]);
    expect(one).not.toBe(none); // adding an incoming flow edge changes the signature
    expect(two).not.toBe(one); // a second incoming edge changes it again
    // A modulation / mod wire is NOT a mix input row — it must not perturb the flow-row set.
    const modOnly = sig([{ id: 'w3', from: 'env', to: 'm1', toPort: 'param:brightness' }]);
    expect(modOnly).toBe(none);
    // Signature is order-independent of edge declaration order (row identity is the set).
    const twoReordered = sig([
      { id: 'w2', from: 'b', to: 'm1' },
      { id: 'w1', from: 'a', to: 'm1' },
    ]);
    expect(twoReordered).toBe(two);
  });

  it('does not reuse flow-node positions across graph keys when node ids match', () => {
    const graphA: TriggerGraph = { nodes: [makeNode('trigger', 'trigger', 10, 20)], edges: [] };
    const graphB: TriggerGraph = { nodes: [makeNode('trigger', 'trigger', 700, 800)], edges: [] };

    const first = projectTriggerFlowNodes({
      graph: graphA,
      graphKey: 'graph-a',
      selectedNodeId: null,
      previousNodes: [],
      cache: emptyTriggerProjectionCache(),
    });
    const previousNodes = first.nodes.map((n) =>
      n.id === 'trigger' ? { ...n, position: { x: 10, y: 20 } } : n,
    );

    const second = projectTriggerFlowNodes({
      graph: graphB,
      graphKey: 'graph-b',
      selectedNodeId: null,
      previousNodes,
      cache: first.cache,
    });

    expect(second.nodes.find((n) => n.id === 'trigger')!.position).toEqual({ x: 700, y: 800 });
  });

  it('still reuses flow-node objects within the same graph when structure and selection are unchanged', () => {
    const graph: TriggerGraph = { nodes: [makeNode('trigger', 'trigger', 10, 20)], edges: [] };

    const first = projectTriggerFlowNodes({
      graph,
      graphKey: 'graph-a',
      selectedNodeId: null,
      previousNodes: [],
      cache: emptyTriggerProjectionCache(),
    });
    const second = projectTriggerFlowNodes({
      graph,
      graphKey: 'graph-a',
      selectedNodeId: null,
      previousNodes: first.nodes,
      cache: first.cache,
    });

    expect(second.nodes[0]).toBe(first.nodes[0]);
  });

  // Item 1.4 regression: a selection-only change must clone the PREVIOUS flow node (live
  // position + measured handleBounds), never rebuild from the store projection — otherwise
  // selecting a just-dragged node snaps it back to its stale store position.
  it('preserves the live position when only the selection changes', () => {
    const graph: TriggerGraph = { nodes: [makeNode('trigger', 'trigger', 10, 20)], edges: [] };

    const first = projectTriggerFlowNodes({
      graph,
      graphKey: 'graph-a',
      selectedNodeId: null,
      previousNodes: [],
      cache: emptyTriggerProjectionCache(),
    });
    // simulate an xyflow drag the store has not synced yet
    const dragged = first.nodes.map((n) => ({ ...n, position: { x: 500, y: 600 } }));

    const selected = projectTriggerFlowNodes({
      graph,
      graphKey: 'graph-a',
      selectedNodeId: 'trigger',
      previousNodes: dragged,
      cache: first.cache,
    });
    expect(selected.nodes[0]!.selected).toBe(true);
    expect(selected.nodes[0]!.position).toEqual({ x: 500, y: 600 }); // live position kept

    const deselected = projectTriggerFlowNodes({
      graph,
      graphKey: 'graph-a',
      selectedNodeId: null,
      previousNodes: selected.nodes,
      cache: selected.cache,
    });
    expect(deselected.nodes[0]!.selected).toBe(false);
    expect(deselected.nodes[0]!.position).toEqual({ x: 500, y: 600 }); // still kept on deselect
  });

  // Incident 09 regression (extends the PR #37 suite): a graph switch must rebuild same-id
  // nodes from the NEW graph — never reuse the previous graph's node object OR its cache.
  it('rebuilds same-id nodes from the new graph after a switch (no cross-graph reuse of kind/position/cache)', () => {
    const graphA: TriggerGraph = {
      nodes: [makeNode('trigger', 'trigger', 0, 0), makeNode('random', 'x', 1, 1)],
      edges: [],
    };
    const graphB: TriggerGraph = {
      nodes: [makeNode('trigger', 'trigger', 0, 0), makeNode('toggle', 'x', 9, 9)],
      edges: [],
    };

    const first = projectTriggerFlowNodes({
      graph: graphA,
      graphKey: 'A',
      selectedNodeId: null,
      previousNodes: [],
      cache: emptyTriggerProjectionCache(),
    });
    const second = projectTriggerFlowNodes({
      graph: graphB,
      graphKey: 'B',
      selectedNodeId: null,
      previousNodes: first.nodes,
      cache: first.cache,
    });

    const x = second.nodes.find((n) => n.id === 'x')!;
    expect(x.data.kind).toBe('toggle'); // rebuilt from graphB, not reused from graphA (random)
    expect(x.position).toEqual({ x: 9, y: 9 }); // graphB position, not graphA's
    expect(second.cache.graphKey).toBe('B'); // cache re-keyed to the new graph
    expect(second.cache.nodeSigs.get('x')).toContain('toggle'); // new-graph signature written through
  });
});

describe('resetProjectionCache', () => {
  it('returns an empty sentinel (no graphKey, no signatures)', () => {
    const c = resetProjectionCache();
    expect(c.graphKey).toBeNull();
    expect(c.nodeSigs.size).toBe(0);
  });

  it('breaks cross-graph reuse when used on the error path / graph-open: a reset cache forces a full rebuild', () => {
    const graph: TriggerGraph = { nodes: [makeNode('trigger', 'trigger', 5, 5)], edges: [] };
    const first = projectTriggerFlowNodes({
      graph,
      graphKey: 'A',
      selectedNodeId: null,
      previousNodes: [],
      cache: emptyTriggerProjectionCache(),
    });
    // Same graph + key, but a reset cache (as the view assigns on a fault) → no object reuse.
    const afterReset = projectTriggerFlowNodes({
      graph,
      graphKey: 'A',
      selectedNodeId: null,
      previousNodes: first.nodes,
      cache: resetProjectionCache(),
    });
    expect(afterReset.nodes[0]).not.toBe(first.nodes[0]); // rebuilt fresh, cache was reset
    expect(afterReset.cache.graphKey).toBe('A'); // and re-established on success
  });
});

describe('projectionDesyncIds', () => {
  it('is empty when the rendered ids and the store graph agree', () => {
    expect(projectionDesyncIds(['a', 'b', 'c'], ['a', 'b', 'c'])).toEqual([]);
    expect(projectionDesyncIds(['a', 'b'], ['a', 'b', 'c'])).toEqual([]); // graph superset is fine
  });

  it('returns rendered flow-node ids missing from the store graph (the desync telemetry)', () => {
    expect(projectionDesyncIds(['a', 'ghost', 'c'], ['a', 'c'])).toEqual(['ghost']);
    expect(projectionDesyncIds(['g1', 'g2'], [])).toEqual(['g1', 'g2']);
    expect(projectionDesyncIds([], ['a'])).toEqual([]);
  });
});

// repeated-switches-0001 regression (INIT-06 S1): the signature switch spelled only `case 'play':`,
// but graph-integrity.ts:148/154 rewrite every `play` node to `effect` inside
// normalizeTriggerGraphToGen3, and hydrate.ts runs that normalisation on every graph reaching the
// store — so the 'play' arm was UNREACHABLE and every real effect node fell through to
// `default: return base`. Its effectId / playType / canvasScene never entered the signature, so
// projectTriggerFlowNodes reused the previous flow-node object verbatim when an effect node's
// effect changed. These three assertions are what proves the arm is live.
describe('triggerNodeSignature — canonical effect nodes', () => {
  const effect = (over: Partial<GraphNode>) => makeNode('effect', 'e1', 10, 20, over);

  it('folds effectId into the signature of a canonical effect node', () => {
    expect(triggerNodeSignature(effect({ effectId: 'gen:radial-wash' }))).not.toBe(
      triggerNodeSignature(effect({ effectId: 'gen:strobe' })),
    );
  });

  it('folds playType into the signature of a canonical effect node', () => {
    expect(triggerNodeSignature(effect({ effectId: 'gen:radial-wash', playType: 'hits' }))).not.toBe(
      triggerNodeSignature(effect({ effectId: 'gen:radial-wash', playType: 'waves' })),
    );
  });

  it('folds canvasScene into the signature of a canonical effect node', () => {
    expect(triggerNodeSignature(effect({ effectId: 'gen:canvas', canvasScene: 'scene-a' }))).not.toBe(
      triggerNodeSignature(effect({ effectId: 'gen:canvas', canvasScene: 'scene-b' })),
    );
  });
});

// INIT-06 chunk 06C — THE ORDERING PROOF for the `play` KIND_SIG entry's removal. The comment at
// :297 asserts that normalisation rewrites `play` → `effect` before any signature is computed;
// this makes it a measured fact through the REAL hydrate path (`normalizeGraphs`), not a claim.
// If that ordering ever inverted, the alias would reach `triggerNodeSignature` with no arm to
// serve it — so this test is what licenses dropping the entry.
describe('load path — a persisted `play` node never reaches triggerNodeSignature as `play`', () => {
  const legacyDoc = (): TriggerGraph => ({
    // Hand-built old-shape doc: the alias is cast in, as the velocity-fold suite does for a
    // retired `SwitchOn` — the authoring union cannot spell it.
    nodes: [
      makeNode('trigger', 'trigger', 0, 0),
      { ...makeNode('effect', 'p1', 12, 34, { effectId: 'gen:strobe' }), kind: 'play' as unknown as NodeKind },
    ],
    edges: [{ id: 'e1', from: 'trigger', to: 'p1' }],
  });

  it('hydrate normalises the alias away before the projection sees the graph', () => {
    const { graphs } = normalizeGraphs({ 'kick:0': legacyDoc() }, {}, [], () => [], () => undefined);
    const g = graphs['kick:0']!;
    expect(g.nodes.map((n) => n.kind as string)).not.toContain('play');
    const p1 = g.nodes.find((n) => n.id === 'p1')!;
    expect(p1.kind).toBe('effect');
    const sig = triggerNodeSignature(p1, g);
    expect(sig).toContain(':effect:'); // signed by the effect arm...
    expect(sig).toContain(':effect=gen:strobe'); // ...which really read the effect fields
    expect(sig).not.toContain(':play:');
  });
});

// INIT-06 S6 PARITY ORACLE. The switch (with its kind-absorbing `default: return base`) became a
// total `Record<NodeKind, SigFn>` with no default arm. These strings were CAPTURED from the
// pre-refactor function at the parent commit — they are measured bytes, not a re-derivation, so a
// miscount of which kinds contribute nothing fails here rather than shipping. Every node below is
// built from ONE over-populated field bag, so an arm that reads a field belonging to another kind
// would change its string and be caught.
const SIG_FIELDS = {
  modInputs: [{ param: 'brightness' }, { param: 'hue' }],
  on: 'value', valueMode: 'bands', threshold: 0.4, invert: true, bands: [0.2, 0.8],
  effectId: 'gen:radial-wash', playType: 'waves', canvasScene: 'scene-a', presetId: 'p1', busId: 'b1',
  modifierId: 'trail', bypass: true,
  mixBlendMode: 'screen',
  p: 0.3,
  delayMode: 'beats', ms: 250, division: '1/8',
  noRepeat: true,
  scope: 'hoop', targetId: 'snare#1,3',
  source: { kind: 'drum', drumId: 'kick', zone: 'head' },
  lfo: { waveform: 'sine', rateMode: 'hz', rateHz: 2, division: '1/4', phase: 0.25 },
  ccController: 74, ccChannel: 3, ccSource: 'midi', oscAddress: '/led/x',
  noteNumber: 48, noteChannel: 2, noteMode: 'velocity', noteReleaseMs: 120,
  randomDistribution: 'gaussian', randomSteps: 7,
  params: { brightness: 0.5 },
  env: { brightness: { kind: 'decay', amount: 1, points: [{ t: 0, v: 1 }, { t: 1, v: 0 }] } },
} satisfies Partial<GraphNode>;

const SIG_GOLDENS: Record<string, string> = {
  trigger: 'n-trigger:trigger:pos=12,34:mod=brightness,hue',
  effect: 'n-effect:effect:pos=12,34:mod=brightness,hue:playType=waves:effect=gen:radial-wash:canvas=scene-a',
  all: 'n-all:all:pos=12,34:mod=brightness,hue',
  random: 'n-random:random:pos=12,34:mod=brightness,hue',
  sequence: 'n-sequence:sequence:pos=12,34:mod=brightness,hue',
  switch: 'n-switch:switch:pos=12,34:mod=brightness,hue:on=value:valueMode=bands:bands=0.2,0.8',
  chance: 'n-chance:chance:pos=12,34:mod=brightness,hue',
  toggle: 'n-toggle:toggle:pos=12,34:mod=brightness,hue',
  delay: 'n-delay:delay:pos=12,34:mod=brightness,hue',
  modifier: 'n-modifier:modifier:pos=12,34:mod=brightness,hue:modifier=trail',
  mix: 'n-mix:mix:pos=12,34:mod=brightness,hue:mix=screen:rows=w1,w2',
  scope: 'n-scope:scope:pos=12,34:mod=brightness,hue',
  output: 'n-output:output:pos=12,34:mod=brightness,hue',
  envelope: 'n-envelope:envelope:pos=12,34:mod=brightness,hue',
  lfo: 'n-lfo:lfo:pos=12,34:mod=brightness,hue:lfo=sine:hz:2:1/4:0.25',
  cc: 'n-cc:cc:pos=12,34:mod=brightness,hue:cc=74:3',
  note: 'n-note:note:pos=12,34:mod=brightness,hue:note=48:2:velocity:120',
  osc: 'n-osc:osc:pos=12,34:mod=brightness,hue:osc=/led/x',
  randomMod: 'n-randomMod:randomMod:pos=12,34:mod=brightness,hue:random=gaussian:7',
};

// Locally listed on purpose: if CanonicalGraphNodeKind grows, this array does NOT grow with it, so
// the totality test below fails and someone has to decide what the new kind signs.
const CANONICAL_KINDS = [
  'trigger', 'effect', 'all', 'random', 'sequence', 'switch', 'chance', 'toggle', 'delay',
  'modifier', 'mix', 'scope', 'output', 'envelope', 'lfo', 'cc', 'note', 'osc', 'randomMod',
] as const;

describe('triggerNodeSignature — golden table over every canonical kind', () => {
  const sigOf = (kind: NodeKind) => {
    const n = makeNode(kind, `n-${kind}`, 12, 34, SIG_FIELDS);
    return triggerNodeSignature(n, {
      version: 3,
      nodes: [n],
      edges: [
        { id: 'w1', from: 'a', to: `n-${kind}` },
        { id: 'w2', from: 'b', to: `n-${kind}` },
        { id: 'w3', from: 'env', to: `n-${kind}`, toPort: 'param:brightness' },
      ],
    });
  };

  for (const kind of CANONICAL_KINDS) {
    it(`signs a ${kind} node byte-identically to the pre-Record switch`, () => {
      expect(sigOf(kind)).toBe(SIG_GOLDENS[kind]);
    });
  }

  it('covers all 19 canonical kinds with a golden (no kind silently untested)', () => {
    expect(CANONICAL_KINDS).toHaveLength(19);
    expect(Object.keys(SIG_GOLDENS).sort()).toEqual([...CANONICAL_KINDS].sort());
  });

  // The measured count the plan corrected from "eight" to TEN. This is the assertion that makes
  // "these kinds contribute nothing" a decision rather than a fallthrough — if a future arm starts
  // contributing, or a new kind lands as baseOnly, this number has to be changed deliberately.
  it('exactly TEN canonical kinds contribute nothing beyond base', () => {
    const baseOnlyKinds = CANONICAL_KINDS.filter((k) => sigOf(k) === `n-${k}:${k}:pos=12,34:mod=brightness,hue`);
    expect([...baseOnlyKinds].sort()).toEqual(
      ['all', 'chance', 'delay', 'envelope', 'output', 'random', 'scope', 'sequence', 'toggle', 'trigger'].sort(),
    );
    expect(baseOnlyKinds).toHaveLength(10);
  });
});

/**
 * S11 DECISION, pinned so it cannot be silently "fixed": the signature is INVARIANT to
 * `bypass`, `ccSource` and `oscAddress`, and that is correct in this tree.
 *
 * primitive-obsession-0009 read these as omissions, on the premise that a node face which
 * depends on a field must have that field in its signature or the face goes stale. That premise
 * does not hold here. `graphToFlowNodes` puts ONLY `{ kind }` in a flow node's `data`; the face
 * looks its model up live (`TriggerNode.svelte:59`, `$derived(store.selectedGraph?.nodes.find(…))`)
 * and derives the bypass subtitle and `.bypassed` class from it (`:94`, `:321`). A bypass toggle
 * therefore repaints through Svelte reactivity with no help from this cache.
 *
 * What the signature actually governs is whether the xyflow node OBJECT is REUSED, carrying its
 * measured `handleBounds`. Adding a field that changes no handle costs a rebuild and discards
 * those bounds for nothing — the R01/GH#80 vanishing-wire class this cache exists to prevent.
 * The plan's own rule for this case: keep the retype, drop the addition.
 *
 * `ccSource`/`oscAddress` fail on a second count too: neither is reachable on a live `cc` node.
 * `store.setCcNodeSource` has no component caller (only store.surface.test.ts), `oscNodeAddress`
 * guards `kind === 'osc'`, and `hydrate.ts:363-365` migrates a persisted `cc` + `ccSource:'osc'`
 * node to kind `osc` on load. The `osc` kind carries its own arm and DOES sign its address.
 */
describe('triggerNodeSignature — fields deliberately NOT signed', () => {
  const sig = (kind: NodeKind, over: Partial<GraphNode>) =>
    triggerNodeSignature({ ...makeNode(kind, `n-${kind}`, 12, 34, SIG_FIELDS), ...over } as GraphNode);

  it('a modifier bypass toggle does not rebuild the node (the face repaints reactively)', () => {
    expect(sig('modifier', { bypass: true })).toBe(sig('modifier', { bypass: false }));
  });

  it('a cc node ignores ccSource and oscAddress (unreachable on `cc`; hydrate migrates them to kind `osc`)', () => {
    expect(sig('cc', { ccSource: 'osc', oscAddress: '/live/1' })).toBe(sig('cc', { ccSource: 'midi', oscAddress: '' }));
  });

  it('but an `osc` node DOES sign its address — the kind that can actually carry one', () => {
    expect(sig('osc', { oscAddress: '/live/1' })).not.toBe(sig('osc', { oscAddress: '/live/2' }));
  });
});

describe('triggerEdgeSignature', () => {
  it('includes source and target ports so handle-only wire changes rebuild edges', () => {
    expect(triggerEdgeSignature({ id: 'e1', from: 'sw', fromPort: 'band-0', to: 'p', toPort: 'in' })).not.toBe(
      triggerEdgeSignature({ id: 'e1', from: 'sw', fromPort: 'band-1', to: 'p', toPort: 'in' }),
    );
    expect(triggerEdgeSignature({ id: 'e2', from: 'env', to: 'p', toPort: 'param:brightness' })).not.toBe(
      triggerEdgeSignature({ id: 'e2', from: 'env', to: 'p', toPort: 'param:hue' }),
    );
  });
});

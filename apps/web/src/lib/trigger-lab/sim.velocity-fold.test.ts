import { describe, expect, it } from 'vitest';
import { BUSES, EFFECTS, PRESETS } from './fixtures';
import {
  Sim,
  foldVelocitySwitch,
  foldVelocitySwitches,
  makeNode,
  type GraphEdge,
  type GraphNode,
  type SwitchOn,
  type TriggerCtx,
  type TriggerGraph,
} from './sim';

/* The velocity→value fold migration. `velocity` was a near-duplicate of `value` (an even
   split on the trigger's normalized intensity by child count); these cover that an
   `on:'velocity'` switch folds into a behaviour-EQUIVALENT `value`+`bands` switch:
   N even bands + each outgoing edge re-homed onto its `band-${i}` handle in target-y
   order, with routing parity, the N≤1 / N=0 edge cases, idempotency, and that
   section/beat (and already-folded) graphs are left untouched. */

const EFFECT_IDS = ['chase', 'sparkle', 'whole', 'rip', 'strobe'];

/** trigger → switch(on:'velocity') → N play children (child i at y=i*40, ascending, each on
    a distinct effect so a fired child is identifiable). `edgeOrder` inserts the child edges
    in a custom order to prove the fold sorts band ports by target y, not edge order. */
function velocityGraph(n: number, edgeOrder?: number[]): TriggerGraph {
  const nodes: GraphNode[] = [
    makeNode('trigger', 'trigger', 0, 0),
    // `velocity` is gone from SwitchOn — cast in to simulate a legacy/persisted graph.
    makeNode('switch', 'sw', 200, 0, { on: 'velocity' as unknown as SwitchOn }),
  ];
  for (let i = 0; i < n; i++) {
    const eff = EFFECT_IDS[i % EFFECT_IDS.length]!;
    nodes.push(makeNode('play', `c${i}`, 400, i * 40, { effectId: eff, presetId: `${eff}:default` }));
  }
  const order = edgeOrder ?? [...Array(n).keys()];
  const edges: GraphEdge[] = [{ id: 'e-t', from: 'trigger', to: 'sw' }];
  for (const i of order) edges.push({ id: `e${i}`, from: 'sw', to: `c${i}` });
  return { nodes, edges };
}

const sw = (g: TriggerGraph): GraphNode => g.nodes.find((n) => n.id === 'sw')!;
const portByTarget = (g: TriggerGraph): Map<string, string | undefined> =>
  new Map(g.edges.filter((e) => e.from === 'sw').map((e) => [e.to, e.fromPort]));

function mk(): Sim {
  return new Sim(BUSES.map((b) => ({ ...b })), EFFECTS.map((e) => ({ ...e })), PRESETS.map((p) => ({ ...p })));
}
function ctxV(velocity: number): TriggerCtx {
  return { velocity, sectionIndex: 0, sectionCount: 3, beatPhase: 0, sourceDrumId: 'd', bpm: 120 };
}
/** The pre-fold `switchIndexN` velocity formula: child = min(N−1, floor(v·N)). */
const oldVelocityChild = (n: number, v: number): number => Math.min(n - 1, Math.floor(v * n));

describe('foldVelocitySwitch — structure', () => {
  it('migrates an N-child velocity switch to value+bands with N even cutoffs', () => {
    const node = sw(foldVelocitySwitch(velocityGraph(3)));
    expect(node.on).toBe('value');
    expect(node.valueMode).toBe('bands');
    expect(node.bands).toEqual([1 / 3, 2 / 3]); // 3 even bands
  });

  it('re-homes each outgoing edge onto band-0…band-{N-1} in target-y order', () => {
    const ports = portByTarget(foldVelocitySwitch(velocityGraph(3)));
    expect(ports.get('c0')).toBe('band-0');
    expect(ports.get('c1')).toBe('band-1');
    expect(ports.get('c2')).toBe('band-2');
  });

  it('assigns band ports by target y, independent of edge insertion order', () => {
    // edges inserted reversed (c2, c1, c0) — band-0 must still map to c0 (lowest y)
    const ports = portByTarget(foldVelocitySwitch(velocityGraph(3, [2, 1, 0])));
    expect(ports.get('c0')).toBe('band-0');
    expect(ports.get('c1')).toBe('band-1');
    expect(ports.get('c2')).toBe('band-2');
  });
});

describe('foldVelocitySwitch — routing parity', () => {
  it('routes a sample velocity to the same child the old velocity switch would (per N)', () => {
    for (const n of [2, 3, 4, 5]) {
      const g = foldVelocitySwitch(velocityGraph(n));
      for (let i = 0; i < n; i++) {
        const v = (i + 0.5) / n; // band midpoint — away from exact cutoffs (≤ boundary)
        const sim = mk();
        sim.triggerGraph('pad', g, ctxV(v));
        const expected = EFFECT_IDS[oldVelocityChild(n, v) % EFFECT_IDS.length];
        expect(sim.voices.map((x) => x.effectId)).toEqual([expected]);
      }
    }
  });
});

describe('foldVelocitySwitch — edge cases', () => {
  it('N=1 → a single band; the one edge fires for any value (as a 1-child velocity always did)', () => {
    const g = foldVelocitySwitch(velocityGraph(1));
    expect(sw(g).bands).toEqual([]);
    expect(portByTarget(g).get('c0')).toBe('band-0');
    for (const v of [0.1, 0.9]) {
      const sim = mk();
      sim.triggerGraph('pad', g, ctxV(v));
      expect(sim.voices.map((x) => x.effectId)).toEqual(['chase']); // c0
    }
  });

  it('N=0 → empty bands, no wired edges, fires nothing', () => {
    const g = foldVelocitySwitch(velocityGraph(0));
    expect(sw(g).bands).toEqual([]);
    expect(g.edges.filter((e) => e.from === 'sw')).toEqual([]);
    const sim = mk();
    sim.triggerGraph('pad', g, ctxV(0.5));
    expect(sim.voices.map((x) => x.effectId)).toEqual([]);
  });
});

describe('foldVelocitySwitch — idempotency + untouched graphs', () => {
  it('folding a migrated graph again is a no-op (same reference)', () => {
    const once = foldVelocitySwitch(velocityGraph(3));
    const twice = foldVelocitySwitch(once);
    expect(twice).toBe(once); // no velocity switch remains → returned by reference
  });

  it('leaves a section switch untouched (same reference)', () => {
    const g: TriggerGraph = {
      nodes: [
        makeNode('trigger', 'trigger', 0, 0),
        makeNode('switch', 'sw', 200, 0, { on: 'section' }),
        makeNode('play', 'c0', 400, 0, { effectId: 'chase' }),
      ],
      edges: [
        { id: 'e-t', from: 'trigger', to: 'sw' },
        { id: 'e0', from: 'sw', to: 'c0' },
      ],
    };
    expect(foldVelocitySwitch(g)).toBe(g);
  });
});

describe('foldVelocitySwitches — over a keyed map', () => {
  it('migrates each graph that has a velocity switch, keeping unaffected graphs by reference', () => {
    const plain: TriggerGraph = { nodes: [makeNode('trigger', 'trigger', 0, 0)], edges: [] };
    const out = foldVelocitySwitches({ velo: velocityGraph(2), plain });
    expect(out.plain).toBe(plain); // unaffected → same ref
    expect(sw(out.velo!).on).toBe('value');
    expect(sw(out.velo!).valueMode).toBe('bands');
    expect(sw(out.velo!).bands).toEqual([0.5]);
  });
});

import { describe, it, expect } from 'vitest';
import {
  resolveNodeModulations,
  nodeModSource,
  paramKeyOf,
  isModSourceKind,
  ENVELOPE_NODE_KEY,
} from './modulation-graph';
import { resolveModifierChain } from './modifier-graph';
import { evalGraph, type EvalState, type PlayAction, type TriggerCtx } from './eval-graph';
import { VoicePool, type SpawnDeps } from './voice-pool';
import { applyEffectiveParams } from './compositor';
import { defaultEnvelope } from './envelope';
import { Prng } from './prng';
import type { Bus, EffectDef, Envelope, GraphEdge, GraphNode, TriggerGraph } from './types';

/** Minimal all-kinds GraphNode (only the fields for its `kind` matter). */
function node(kind: GraphNode['kind'], id: string, over: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    kind,
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
    on: 'value',
    valueMode: 'gate',
    threshold: 0.5,
    invert: false,
    bands: [0.5],
    p: 0.5,
    delayMode: 'time',
    ms: 0,
    division: '1/8',
    ...over,
  };
}

function edge(id: string, from: string, to: string, over: Partial<GraphEdge> = {}): GraphEdge {
  return { id, from, to, ...over };
}

/** An envelope source node carrying a shape in the well-known slot. */
function envNode(id: string, env: Envelope, over: Partial<GraphNode> = {}): GraphNode {
  return node('envelope', id, { env: { [ENVELOPE_NODE_KEY]: env }, ...over });
}

function freshState(): EvalState {
  return {
    seqIndex: new Map(),
    lastPick: new Map(),
    latched: new Map(),
    prng: new Prng(1),
    presetsById: new Map(),
    isVoiceAlive: () => false,
  };
}

const ctx: TriggerCtx = {
  velocity: 1,
  sectionIndex: 0,
  sectionCount: 1,
  beatPhase: 0,
  sourceDrumId: 'kick',
  bpm: 120,
};

// ---- primitives -------------------------------------------------------------

describe('paramKeyOf', () => {
  it('extracts the key from a param toPort, null for everything else', () => {
    expect(paramKeyOf('param:brightness')).toBe('brightness');
    expect(paramKeyOf('param:size')).toBe('size');
    expect(paramKeyOf('in')).toBeNull();
    expect(paramKeyOf('mod')).toBeNull();
    expect(paramKeyOf(undefined)).toBeNull();
  });
});

describe('isModSourceKind', () => {
  it('is true only for modulation source kinds', () => {
    expect(isModSourceKind('envelope')).toBe(true);
    expect(isModSourceKind('play')).toBe(false);
    expect(isModSourceKind('modifier')).toBe(false);
    expect(isModSourceKind('trigger')).toBe(false);
  });
});

describe('nodeModSource', () => {
  it('builds an envelope source from the node shape slot', () => {
    const env = defaultEnvelope('rise');
    const src = nodeModSource(envNode('e', env));
    expect(src).toEqual({ kind: 'envelope', env });
  });
  it('falls back to a decay envelope when the shape is unauthored', () => {
    const src = nodeModSource(node('envelope', 'e'));
    expect(src?.kind).toBe('envelope');
    expect((src as { env: Envelope }).env.kind).toBe('decay');
  });
  it('returns null for a non-source node', () => {
    expect(nodeModSource(node('play', 'p'))).toBeNull();
    expect(nodeModSource(node('modifier', 'm'))).toBeNull();
  });
});

// ---- resolveNodeModulations (pure) ------------------------------------------

describe('resolveNodeModulations', () => {
  const env = defaultEnvelope('rise');

  it('resolves one envelope→param edge into one mapping, edge settings verbatim', () => {
    const g: TriggerGraph = {
      nodes: [envNode('e', env), node('play', 'p')],
      edges: [edge('w', 'e', 'p', { toPort: 'param:brightness', amount: 0.75, invert: true, rangeMin: 0.2, rangeMax: 0.9 })],
    };
    const m = resolveNodeModulations(g, g.nodes[1]!);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({
      targetParam: 'brightness',
      amount: 0.75,
      invert: true,
      rangeMin: 0.2,
      rangeMax: 0.9,
      source: { kind: 'envelope', env },
    });
  });

  it('defaults amount=1, invert=false, range=[0,1] when the edge omits them (no specs)', () => {
    const g: TriggerGraph = {
      nodes: [envNode('e', env), node('play', 'p')],
      edges: [edge('w', 'e', 'p', { toPort: 'param:speed' })],
    };
    const m = resolveNodeModulations(g, g.nodes[1]!);
    expect(m[0]).toMatchObject({ amount: 1, invert: false, rangeMin: 0, rangeMax: 1 });
  });

  it('defaults the range to the param spec min/max and drops non-number params when specs are given', () => {
    const g: TriggerGraph = {
      nodes: [envNode('e', env), node('play', 'p')],
      edges: [
        edge('w1', 'e', 'p', { toPort: 'param:size' }),
        edge('w2', 'e', 'p', { toPort: 'param:mode' }),
      ],
    };
    const specs = [
      { key: 'size', kind: 'number', min: 2, max: 8 },
      { key: 'mode', kind: 'enum' },
    ];
    const m = resolveNodeModulations(g, g.nodes[1]!, specs);
    expect(m).toHaveLength(1); // the enum param is dropped
    expect(m[0]).toMatchObject({ targetParam: 'size', rangeMin: 2, rangeMax: 8 });
  });

  it('skips non-source wires and dangling sources, never throwing', () => {
    const g: TriggerGraph = {
      nodes: [node('modifier', 'm'), node('play', 'p')],
      edges: [
        edge('w1', 'm', 'p', { toPort: 'param:brightness' }), // a modifier is not a mod source
        edge('w2', 'ghost', 'p', { toPort: 'param:brightness' }), // dangling
      ],
    };
    expect(resolveNodeModulations(g, g.nodes[1]!)).toEqual([]);
  });

  it('resolves several envelope wires onto one param as several mappings (they sum at render)', () => {
    const g: TriggerGraph = {
      nodes: [envNode('e1', env), envNode('e2', defaultEnvelope('decay')), node('play', 'p')],
      edges: [
        edge('w1', 'e1', 'p', { toPort: 'param:brightness' }),
        edge('w2', 'e2', 'p', { toPort: 'param:brightness' }),
      ],
    };
    expect(resolveNodeModulations(g, g.nodes[2]!)).toHaveLength(2);
  });
});

// ---- eval-graph integration -------------------------------------------------

const effect: EffectDef = {
  id: 'fx',
  name: 'fx',
  pattern: 'flash',
  busId: 'main',
  scope: 'kit',
  params: [{ key: 'brightness', label: 'Brightness', kind: 'number', min: 0, max: 1, default: 0.5 }],
  attackMs: 0,
  sustainMs: 1000,
  releaseMs: 0,
};
const bus: Bus = { id: 'main', name: 'Main', polyphony: 'poly', crossfadeMs: 0 };

function firstPlay(graph: TriggerGraph): PlayAction | undefined {
  return evalGraph(freshState(), graph, 'pad', ctx).find((a): a is PlayAction => a.kind === 'play');
}

describe('evalGraph — play modulations + inert source', () => {
  it('populates PlayAction.modulations from incoming param edges', () => {
    const g: TriggerGraph = {
      nodes: [
        node('trigger', 'trigger'),
        node('play', 'p', { effectId: 'fx', params: { brightness: 0.5 } }),
        envNode('e', defaultEnvelope('rise')),
      ],
      edges: [
        edge('t', 'trigger', 'p'),
        edge('w', 'e', 'p', { toPort: 'param:brightness' }),
      ],
    };
    const play = firstPlay(g);
    expect(play?.modulations).toHaveLength(1);
    expect(play?.modulations?.[0]?.targetParam).toBe('brightness');
  });

  it('leaves modulations undefined when nothing is wired', () => {
    const g: TriggerGraph = {
      nodes: [node('trigger', 'trigger'), node('play', 'p', { effectId: 'fx' })],
      edges: [edge('t', 'trigger', 'p')],
    };
    expect(firstPlay(g)?.modulations).toBeUndefined();
  });

  it('an envelope node fires no children (inert in trigger flow)', () => {
    // Even if a play node were (illegally) wired as a flow child of an envelope, eval emits nothing.
    const g: TriggerGraph = {
      nodes: [node('trigger', 'trigger'), envNode('e', defaultEnvelope('rise')), node('play', 'p', { effectId: 'fx' })],
      edges: [edge('t', 'trigger', 'e'), edge('flow', 'e', 'p')],
    };
    expect(evalGraph(freshState(), g, 'pad', ctx)).toEqual([]);
  });
});

// ---- modifier env bridge + modifier param edges -----------------------------

describe('resolveModifierChain — modifier modulations', () => {
  it("bridges a modifier node's authored env into the link's modulations (group-H residual)", () => {
    const play = node('play', 'p', { effectId: 'fx' });
    // trail carries a numeric `decayMs` param — author an envelope on it.
    const trail = node('modifier', 'm', { modifierId: 'trail', params: { decayMs: 250, mode: 'add' }, env: { decayMs: defaultEnvelope('decay') } });
    const g: TriggerGraph = { nodes: [play, trail], edges: [edge('w', 'm', 'p', { toPort: 'mod' })] };
    const chain = resolveModifierChain(g, play);
    expect(chain).toHaveLength(1);
    expect(chain[0]?.modulations).toBeDefined();
    expect(chain[0]?.modulations?.[0]?.targetParam).toBe('decayMs');
  });

  it('resolves an envelope wired into a modifier param row', () => {
    const play = node('play', 'p', { effectId: 'fx' });
    const trail = node('modifier', 'm', { modifierId: 'trail', params: { decayMs: 250, mode: 'add' } });
    const env = envNode('e', defaultEnvelope('rise'));
    const g: TriggerGraph = {
      nodes: [play, trail, env],
      edges: [edge('w1', 'm', 'p', { toPort: 'mod' }), edge('w2', 'e', 'm', { toPort: 'param:decayMs' })],
    };
    const chain = resolveModifierChain(g, play);
    expect(chain[0]?.modulations?.some((m) => m.targetParam === 'decayMs')).toBe(true);
  });

  it('leaves modulations undefined when the modifier has no env and no param wires', () => {
    const play = node('play', 'p', { effectId: 'fx' });
    const trail = node('modifier', 'm', { modifierId: 'trail', params: { decayMs: 250, mode: 'add' } });
    const g: TriggerGraph = { nodes: [play, trail], edges: [edge('w', 'm', 'p', { toPort: 'mod' })] };
    expect(resolveModifierChain(g, play)[0]?.modulations).toBeUndefined();
  });
});

// ---- end-to-end: graph → spawn → render sweep (the "engine" path) -----------

describe('modulation graph — end to end (engine render path)', () => {
  const deps = (timeMs: number): SpawnDeps => ({
    effectsById: new Map([['fx', effect]]),
    busById: new Map([['main', bus]]),
    latched: new Map(),
    timeMs,
  });

  /** Build a graph whose one play node exposes `brightness`, driven by one rise envelope. */
  function riseGraph(playId = 'p'): TriggerGraph {
    return {
      nodes: [
        node('trigger', 'trigger'),
        node('play', playId, { effectId: 'fx', params: { brightness: 0.5 } }),
        envNode('e', defaultEnvelope('rise')),
      ],
      edges: [edge('t', 'trigger', playId), edge('w', 'e', playId, { toPort: 'param:brightness' })],
    };
  }

  it('animates the exposed param over the voice life (a rise envelope lifts brightness)', () => {
    const play = firstPlay(riseGraph())!;
    const pool = new VoicePool();
    const v = pool.spawn(play, 'kick', 1, deps(0))!;
    // life = 1000ms; sample early vs late.
    const early = applyEffectiveParams(v, 50, 120).brightness as number;
    const late = applyEffectiveParams(v, 950, 120).brightness as number;
    expect(late).toBeGreaterThan(early);
    expect(early).toBeLessThan(0.5); // rise starts below the 0.5 base
    expect(late).toBeGreaterThan(0.9); // and climbs toward the range max
  });

  it('one envelope driving two target nodes runs independent phases (per-voice)', () => {
    // Two play nodes, each exposing brightness, both wired from ONE envelope node.
    const g: TriggerGraph = {
      nodes: [
        node('trigger', 'trigger'),
        node('play', 'p1', { effectId: 'fx', params: { brightness: 0.5 } }),
        node('play', 'p2', { effectId: 'fx', params: { brightness: 0.5 } }),
        envNode('e', defaultEnvelope('rise')),
      ],
      edges: [
        edge('t1', 'trigger', 'p1'),
        edge('t2', 'trigger', 'p2'),
        edge('w1', 'e', 'p1', { toPort: 'param:brightness' }),
        edge('w2', 'e', 'p2', { toPort: 'param:brightness' }),
      ],
    };
    const plays = evalGraph(freshState(), g, 'pad', ctx).filter((a): a is PlayAction => a.kind === 'play');
    expect(plays).toHaveLength(2);
    const pool = new VoicePool();
    const vEarly = pool.spawn(plays[0]!, 'kick', 1, deps(0))!; // born at 0
    const vLate = pool.spawn(plays[1]!, 'kick', 1, deps(600))!; // born at 600
    // Sample BOTH at the same wall clock: their ages (hence phases) differ → different values.
    const a = applyEffectiveParams(vEarly, 800, 120).brightness as number; // age 800
    const b = applyEffectiveParams(vLate, 800, 120).brightness as number; // age 200
    expect(a).toBeGreaterThan(b); // the older voice is further up the rise
  });
});

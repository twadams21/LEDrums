/* The `reset` node — snap a targeted `sequence` node's step position back to the first child.

   The node exists so a SEPARATE, MIDI-bound graph (a footswitch) can reset a sequencer that lives
   in a pad graph. Those two run under different eval state prefixes, so the reset addresses its
   target by (graph key, node id) and clears every prefix that node currently runs under. */
import { describe, expect, it } from 'vitest';
import { evalChildren, evalFromNodes, evalGraph, isResetStateKey, type EvalState, type PlayAction, type TriggerCtx } from './eval-graph';
import { Prng } from './prng';
import type { GraphEdge, GraphNode, TriggerGraph } from './types';

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

const edge = (id: string, from: string, to: string): GraphEdge => ({ id, from, to });

const state = (): EvalState => ({
  seqIndex: new Map(),
  lastPick: new Map(),
  latched: new Map(),
  prng: new Prng(1),
  presetsById: new Map(),
  isVoiceAlive: () => false,
});

const ctx: TriggerCtx = {
  velocity: 1,
  sectionIndex: 0,
  sectionCount: 1,
  beatPhase: 0,
  sourceDrumId: 'kick',
  bpm: 120,
};

const played = (s: EvalState, g: TriggerGraph, pad: string): string | undefined =>
  evalGraph(s, g, pad, ctx).find((a): a is PlayAction => a.kind === 'play')?.effectId;

/** A pad graph whose `sequence` node ('seq') cycles three effects. */
const seqGraph: TriggerGraph = {
  version: 3,
  nodes: [
    node('trigger', 't'),
    node('sequence', 'seq'),
    node('effect', 'a', { effectId: 'A' }),
    node('effect', 'b', { effectId: 'B' }),
    node('effect', 'c', { effectId: 'C' }),
    node('output', 'output'),
  ],
  edges: [
    edge('e0', 't', 'seq'),
    edge('e1', 'seq', 'a'),
    edge('e2', 'seq', 'b'),
    edge('e3', 'seq', 'c'),
    edge('e4', 'a', 'output'),
    edge('e5', 'b', 'output'),
    edge('e6', 'c', 'output'),
  ],
};

/** A standalone graph holding only a reset — the shape a MIDI-bound footswitch graph takes. */
const resetOnly = (targetGraphKey?: string, targetNodeId?: string): TriggerGraph => ({
  version: 3,
  nodes: [node('trigger', 't'), node('reset', 'r', { targetGraphKey, targetNodeId }), node('output', 'output')],
  edges: [edge('e0', 't', 'r')],
});

describe('isResetStateKey', () => {
  it('matches the bare-prefix form (pad fallback / direct MIDI-OSC binding)', () => {
    expect(isResetStateKey('kick:0#seq', 'kick:0', 'seq')).toBe(true);
  });

  it('matches the section-slot form, whatever the slot index', () => {
    expect(isResetStateKey('kick:0#0#seq', 'kick:0', 'seq')).toBe(true);
    expect(isResetStateKey('kick:0#12#seq', 'kick:0', 'seq')).toBe(true);
  });

  it('does not let one graph key claim another that merely shares a prefix', () => {
    expect(isResetStateKey('kick:0#seq', 'kick', 'seq')).toBe(false);
    expect(isResetStateKey('graph-10#seq', 'graph-1', 'seq')).toBe(false);
  });

  it('rejects a non-numeric middle segment, so a nested key cannot match', () => {
    expect(isResetStateKey('kick:0#other#seq', 'kick:0', 'seq')).toBe(false);
  });

  it('requires the node id to match exactly', () => {
    expect(isResetStateKey('kick:0#seq2', 'kick:0', 'seq')).toBe(false);
  });

  it('handles namespaced library graph keys without regex escaping trouble', () => {
    expect(isResetStateKey('lib:song-3/kick:0#2#seq', 'lib:song-3/kick:0', 'seq')).toBe(true);
  });
});

describe('reset node', () => {
  it('snaps the target sequence back to its first child', () => {
    const s = state();
    expect(played(s, seqGraph, 'kick:0')).toBe('A');
    expect(played(s, seqGraph, 'kick:0')).toBe('B');

    evalGraph(s, resetOnly('kick:0', 'seq'), 'foot', ctx);
    expect(played(s, seqGraph, 'kick:0')).toBe('A'); // back to step 1, not C
  });

  it('reaches a target running under a DIFFERENT state prefix (the footswitch case)', () => {
    const s = state();
    played(s, seqGraph, 'kick:0');
    played(s, seqGraph, 'kick:0'); // sequencer is now on step 3

    // the reset graph evaluates under its own prefix ('midi-graph'), yet still clears kick:0's key
    evalGraph(s, resetOnly('kick:0', 'seq'), 'midi-graph', ctx);
    expect(played(s, seqGraph, 'kick:0')).toBe('A');
  });

  it('resets every slot instance of a layered target, not just one', () => {
    const s = state();
    // the same graph layered into two section slots keeps two independent counters
    played(s, seqGraph, 'kick:0#0');
    played(s, seqGraph, 'kick:0#1');
    expect(played(s, seqGraph, 'kick:0#0')).toBe('B');
    expect(played(s, seqGraph, 'kick:0#1')).toBe('B');

    evalGraph(s, resetOnly('kick:0', 'seq'), 'foot', ctx);
    expect(played(s, seqGraph, 'kick:0#0')).toBe('A');
    expect(played(s, seqGraph, 'kick:0#1')).toBe('A');
  });

  it('leaves OTHER sequence nodes alone', () => {
    const s = state();
    played(s, seqGraph, 'kick:0');
    played(s, seqGraph, 'snare:0'); // a different pad, same graph shape

    evalGraph(s, resetOnly('kick:0', 'seq'), 'foot', ctx);
    expect(played(s, seqGraph, 'kick:0')).toBe('A'); // reset
    expect(played(s, seqGraph, 'snare:0')).toBe('B'); // untouched, carried on
  });

  it('touches neither Random no-repeat memory nor Toggle latches', () => {
    const s = state();
    s.lastPick.set('kick:0#rnd', 2);
    s.latched.set('kick:0#tog', 'voice-9');
    s.seqIndex.set('kick:0#seq', 5);

    evalGraph(s, resetOnly('kick:0', 'seq'), 'foot', ctx);

    expect(s.seqIndex.has('kick:0#seq')).toBe(false);
    expect(s.lastPick.get('kick:0#rnd')).toBe(2);
    expect(s.latched.get('kick:0#tog')).toBe('voice-9');
  });

  it('is a silent no-op when the target is unset or dangling', () => {
    const s = state();
    s.seqIndex.set('kick:0#seq', 3);

    expect(() => evalGraph(s, resetOnly(undefined, undefined), 'foot', ctx)).not.toThrow();
    expect(() => evalGraph(s, resetOnly('kick:0', undefined), 'foot', ctx)).not.toThrow();
    expect(() => evalGraph(s, resetOnly('deleted-graph', 'gone'), 'foot', ctx)).not.toThrow();
    expect(s.seqIndex.get('kick:0#seq')).toBe(3); // nothing cleared
  });

  it('passes the trigger through to its children', () => {
    const s = state();
    const chained: TriggerGraph = {
      version: 3,
      nodes: [
        node('trigger', 't'),
        node('reset', 'r', { targetGraphKey: 'kick:0', targetNodeId: 'seq' }),
        node('effect', 'fx', { effectId: 'PASSED' }),
        node('output', 'output'),
      ],
      edges: [edge('e0', 't', 'r'), edge('e1', 'r', 'fx'), edge('e2', 'fx', 'output')],
    };
    expect(played(s, chained, 'foot')).toBe('PASSED');
  });

  it('resets a sequence in its OWN graph before that sequence fires on the same hit', () => {
    const s = state();
    // trigger → reset(seq) → seq → {A,B,C}: the reset runs first, so every hit replays step 1.
    const selfResetting: TriggerGraph = {
      version: 3,
      nodes: seqGraph.nodes.concat(node('reset', 'r', { targetGraphKey: 'kick:0', targetNodeId: 'seq' })),
      edges: [edge('e0', 't', 'r'), edge('e0b', 'r', 'seq'), ...seqGraph.edges.slice(1)],
    };
    expect(played(s, selfResetting, 'kick:0')).toBe('A');
    expect(played(s, selfResetting, 'kick:0')).toBe('A');
    expect(played(s, selfResetting, 'kick:0')).toBe('A');
  });

  it('a reset bound to its own source does NOT reset on the graph trigger flow', () => {
    // Co-location: the reset lives in the SEQUENCER'S OWN graph, wired inline. Were it to reset on
    // every hit the sequence could never advance past step 1 — the trap this rule exists to avoid.
    const s = state();
    const inline: TriggerGraph = {
      version: 3,
      nodes: seqGraph.nodes.concat(
        node('reset', 'r', { targetGraphKey: 'kick:0', targetNodeId: 'seq', source: { kind: 'midi', note: 61 } }),
      ),
      edges: [edge('e0', 't', 'r'), edge('e0b', 'r', 'seq'), ...seqGraph.edges.slice(1)],
    };
    expect(played(s, inline, 'kick:0')).toBe('A');
    expect(played(s, inline, 'kick:0')).toBe('B'); // advanced — the inline reset stayed passive
    expect(played(s, inline, 'kick:0')).toBe('C');
  });

  it('the same bound reset DOES reset when eval is entered at it (its own note)', () => {
    const s = state();
    const inline: TriggerGraph = {
      version: 3,
      nodes: seqGraph.nodes.concat(
        node('reset', 'r', { targetGraphKey: 'kick:0', targetNodeId: 'seq', source: { kind: 'midi', note: 61 } }),
      ),
      edges: [edge('e0', 't', 'r'), edge('e0b', 'r', 'seq'), ...seqGraph.edges.slice(1)],
    };
    played(s, inline, 'kick:0');
    played(s, inline, 'kick:0'); // now on step 3

    // entering AT the reset clears the counter, then passes through — so this hit plays step 1
    const viaOwnSource = evalFromNodes(s, inline, 'kick:0', ['r'], ctx).find((a): a is PlayAction => a.kind === 'play');
    expect(viaOwnSource?.effectId).toBe('A');
    expect(played(s, inline, 'kick:0')).toBe('B'); // and the pad path carries on from there
  });

  it('an UNBOUND reset keeps resetting on flow (unchanged behaviour)', () => {
    const s = state();
    const inline: TriggerGraph = {
      version: 3,
      nodes: seqGraph.nodes.concat(node('reset', 'r', { targetGraphKey: 'kick:0', targetNodeId: 'seq' })),
      edges: [edge('e0', 't', 'r'), edge('e0b', 'r', 'seq'), ...seqGraph.edges.slice(1)],
    };
    expect(played(s, inline, 'kick:0')).toBe('A');
    expect(played(s, inline, 'kick:0')).toBe('A'); // still resets every hit
  });

  it('a bound reset reached through a delay drain stays a pass-through', () => {
    // evalChildren carries no own-source licence: arriving via a delay is ordinary flow.
    const s = state();
    s.seqIndex.set('kick:0#seq', 4);
    const g: TriggerGraph = {
      version: 3,
      nodes: [
        node('trigger', 't'),
        node('reset', 'r', { targetGraphKey: 'kick:0', targetNodeId: 'seq', source: { kind: 'midi', note: 61 } }),
        node('output', 'output'),
      ],
      edges: [edge('e0', 't', 'r')],
    };
    evalChildren(s, g, 'kick:0', ['r'], ctx, '', new Set());
    expect(s.seqIndex.get('kick:0#seq')).toBe(4); // untouched
  });

  it('entering at a bound reset still honours an unset target (no throw, nothing cleared)', () => {
    const s = state();
    s.seqIndex.set('kick:0#seq', 2);
    const g: TriggerGraph = {
      version: 3,
      nodes: [node('trigger', 't'), node('reset', 'r', { source: { kind: 'midi', note: 61 } }), node('output', 'output')],
      edges: [edge('e0', 't', 'r')],
    };
    expect(() => evalFromNodes(s, g, 'kick:0', ['r'], ctx)).not.toThrow();
    expect(s.seqIndex.get('kick:0#seq')).toBe(2);
  });

  it('is deterministic — identical input sequences reproduce identically', () => {
    const run = (): (string | undefined)[] => {
      const s = state();
      const out = [played(s, seqGraph, 'kick:0'), played(s, seqGraph, 'kick:0')];
      evalGraph(s, resetOnly('kick:0', 'seq'), 'foot', ctx);
      out.push(played(s, seqGraph, 'kick:0'), played(s, seqGraph, 'kick:0'));
      return out;
    };
    expect(run()).toEqual(run());
    expect(run()).toEqual(['A', 'B', 'A', 'B']);
  });
});

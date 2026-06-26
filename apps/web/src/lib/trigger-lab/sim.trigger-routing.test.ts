import { describe, expect, it } from 'vitest';
import {
  makeNode,
  resolveGraphsForFire,
  sourceMatchesFire,
  triggerSourceOf,
  type TriggerGraph,
  type TriggerSource,
} from './sim';

/* U3 — offline DIRECT trigger-source resolution (the web mirror of the engine's
   resolveDirectGraphs). Zone-map precedence is the store's padKey path; these cover the
   second half: a raw MIDI note / OSC address → the authored graph(s) bound to it, with
   the fire's normalized value. */

/** trigger(source) → (a graph the offline resolver can match by source). */
function sourcedGraph(source?: TriggerSource): TriggerGraph {
  return {
    nodes: [makeNode('trigger', 'trigger', 0, 0, source ? { source } : {}), makeNode('play', 'p', 0, 0, { effectId: 'fxA' })],
    edges: [{ id: 'e0', from: 'trigger', to: 'p' }],
  };
}

describe('triggerSourceOf', () => {
  it('reads the trigger node source, or undefined when none is bound', () => {
    expect(triggerSourceOf(sourcedGraph({ kind: 'midi', note: 38 }))).toEqual({ kind: 'midi', note: 38 });
    expect(triggerSourceOf(sourcedGraph())).toBeUndefined();
  });
});

describe('sourceMatchesFire', () => {
  it('matches a MIDI note fire to a note source', () => {
    expect(sourceMatchesFire({ kind: 'midi', note: 60 }, { kind: 'midi', note: 60, value: 100 })).toBe(true);
    expect(sourceMatchesFire({ kind: 'midi', note: 60 }, { kind: 'midi', note: 61, value: 100 })).toBe(false);
  });

  it('matches a CC fire to a cc source (and not a note source)', () => {
    expect(sourceMatchesFire({ kind: 'midi', cc: 7 }, { kind: 'midi', cc: 7, value: 64 })).toBe(true);
    expect(sourceMatchesFire({ kind: 'midi', note: 7 }, { kind: 'midi', cc: 7, value: 64 })).toBe(false);
    expect(sourceMatchesFire({ kind: 'midi', cc: 7 }, { kind: 'midi', note: 7, value: 64 })).toBe(false);
  });

  it('matches an OSC address fire to an osc source', () => {
    expect(sourceMatchesFire({ kind: 'osc', address: '/kick' }, { kind: 'osc', address: '/kick', arg: 1 })).toBe(true);
    expect(sourceMatchesFire({ kind: 'osc', address: '/kick' }, { kind: 'osc', address: '/snare', arg: 1 })).toBe(false);
  });

  it('a drum source never matches a raw midi/osc fire (pad-bound)', () => {
    const drum: TriggerSource = { kind: 'drum', drumId: 'kick', zone: 'center' };
    expect(sourceMatchesFire(drum, { kind: 'midi', note: 36, value: 100 })).toBe(false);
    expect(sourceMatchesFire(drum, { kind: 'osc', address: '/kick', arg: 1 })).toBe(false);
  });

  it('an unbound source (undefined) matches nothing', () => {
    expect(sourceMatchesFire(undefined, { kind: 'midi', note: 36, value: 100 })).toBe(false);
  });
});

describe('resolveGraphsForFire', () => {
  const graphs = {
    'graph:note': sourcedGraph({ kind: 'midi', note: 60 }),
    'graph:cc': sourcedGraph({ kind: 'midi', cc: 7 }),
    'graph:osc': sourcedGraph({ kind: 'osc', address: '/kick' }),
    'kick:center': sourcedGraph({ kind: 'drum', drumId: 'kick', zone: 'center' }),
    'graph:none': sourcedGraph(),
  };

  it('resolves a raw MIDI note to the graph bound to that note', () => {
    const r = resolveGraphsForFire(graphs, { kind: 'midi', note: 60, value: 127 });
    expect(r.map((x) => x.key)).toEqual(['graph:note']);
    expect(r[0]!.value).toBe(1); // 127/127
  });

  it('resolves a raw OSC address to the graph bound to that address', () => {
    const r = resolveGraphsForFire(graphs, { kind: 'osc', address: '/kick', arg: 0.5 });
    expect(r.map((x) => x.key)).toEqual(['graph:osc']);
    expect(r[0]!.value).toBe(0.5);
  });

  it('returns nothing for an unmapped note / address (no double-fire onto pad/drum graphs)', () => {
    expect(resolveGraphsForFire(graphs, { kind: 'midi', note: 99, value: 100 })).toEqual([]);
    expect(resolveGraphsForFire(graphs, { kind: 'osc', address: '/nope', arg: 1 })).toEqual([]);
  });

  it('value normalization feeds eval identically across sources (the half-strength parity)', () => {
    const viaMidi = resolveGraphsForFire(graphs, { kind: 'midi', note: 60, value: 63.5 })[0]!.value;
    const viaOsc = resolveGraphsForFire(graphs, { kind: 'osc', address: '/kick', arg: 0.5 })[0]!.value;
    expect(viaMidi).toBeCloseTo(0.5);
    expect(viaOsc).toBe(0.5);
  });

  it('fires every graph bound to the same note (multiple direct bindings)', () => {
    const multi = { a: sourcedGraph({ kind: 'midi', note: 40 }), b: sourcedGraph({ kind: 'midi', note: 40 }) };
    expect(resolveGraphsForFire(multi, { kind: 'midi', note: 40, value: 100 }).map((x) => x.key).sort()).toEqual(['a', 'b']);
  });
});

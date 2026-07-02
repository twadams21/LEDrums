import { describe, expect, it } from 'vitest';
import { makeNode, type TriggerGraph } from '../sim';
import { canConnect, canReconnect } from './graph-wiring';

/* Incident 09 acceptance: wiring validation must RETURN a verdict, never throw — a throw from
   a connect/reconnect guard is what propagates into xyflow mid-gesture and blanks the canvas.
   These are pure fuzz + targeted tests over the invalid-input space (unknown ids, self-connects,
   cross-graph ids, port mismatches). */

/** A small valid graph: trigger → random → play, plus an isolated toggle. */
function sampleGraph(): TriggerGraph {
  return {
    nodes: [
      makeNode('trigger', 'trigger', 0, 0),
      makeNode('random', 'r1', 100, 0),
      makeNode('play', 'p1', 200, 0),
      makeNode('toggle', 't1', 100, 100),
    ],
    edges: [
      { id: 'e1', from: 'trigger', to: 'r1' },
      { id: 'e2', from: 'r1', to: 'p1' },
    ],
  };
}

/** Deterministic PRNG so a fuzz failure is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const graph = sampleGraph();
const knownIds = graph.nodes.map((n) => n.id);
// ids the graph does NOT contain: empty, whitespace-mangled, cross-graph-shaped, unicode, and
// dangerous prototype keys — the shapes a malformed drag / stale reference could produce.
const alienIds = ['', 'trigger ', 'r1\n', 'n:9999', '💥', 'undefined', '__proto__', 'nodes', 'toString'];
const idPool = [...knownIds, ...alienIds];
const ports: Array<string | undefined> = [undefined, 'band-0', 'band-999', '', 'default', '💥'];

function pick<T>(arr: readonly T[], rand: () => number): T {
  return arr[Math.floor(rand() * arr.length)]!;
}

describe('graph-wiring validation never throws (fuzz)', () => {
  it('canConnect returns a boolean and never throws for any id/port combination', () => {
    const rand = mulberry32(1);
    for (let i = 0; i < 5000; i++) {
      const from = pick(idPool, rand);
      const to = pick(idPool, rand);
      const port = pick(ports, rand);
      let result: unknown;
      expect(() => {
        result = canConnect(graph, from, to, port);
      }).not.toThrow();
      expect(typeof result).toBe('boolean');
    }
  });

  it('canReconnect returns a boolean and never throws for any edge/id/port combination', () => {
    const rand = mulberry32(2);
    const edgePool = [...graph.edges.map((e) => e.id), ...alienIds];
    for (let i = 0; i < 5000; i++) {
      const edgeId = pick(edgePool, rand);
      const from = pick(idPool, rand);
      const to = pick(idPool, rand);
      const port = pick(ports, rand);
      let result: unknown;
      expect(() => {
        result = canReconnect(graph, edgeId, from, to, port);
      }).not.toThrow();
      expect(typeof result).toBe('boolean');
    }
  });
});

describe('graph-wiring validation — targeted verdicts (no throw)', () => {
  it('rejects self-connects, unknown ids, and cross-graph ids', () => {
    expect(canConnect(graph, 'r1', 'r1')).toBe(false); // self
    expect(canConnect(graph, 'ghost', 'p1')).toBe(false); // unknown source
    expect(canConnect(graph, 'r1', 'ghost')).toBe(false); // unknown target
    expect(canConnect(graph, 'nope-a', 'nope-b')).toBe(false); // both cross-graph
    expect(canConnect(graph, '__proto__', 'p1')).toBe(false); // prototype-key id
  });

  it('rejects wiring out of a sink or into a source-only node (direction)', () => {
    expect(canConnect(graph, 'p1', 'r1')).toBe(false); // play has no output
    expect(canConnect(graph, 'r1', 'trigger')).toBe(false); // trigger has no input
  });

  it('accepts a legal new wire and a legal reconnect', () => {
    expect(canConnect(graph, 'trigger', 't1')).toBe(true); // trigger → toggle
    expect(canReconnect(graph, 'e2', 'r1', 't1')).toBe(true); // repoint e2's target r1 → t1
  });

  it('rejects an exact duplicate wire but allows different bands to the same child', () => {
    const g: TriggerGraph = {
      nodes: [
        makeNode('switch', 's1', 0, 0, { on: 'value', valueMode: 'bands', bands: [0.3, 0.6] }),
        makeNode('play', 'p1', 100, 0),
      ],
      edges: [{ id: 'e1', from: 's1', to: 'p1', fromPort: 'band-0' }],
    };
    expect(canConnect(g, 's1', 'p1', 'band-0')).toBe(false); // exact (source-port → target) dup
    expect(canConnect(g, 's1', 'p1', 'band-1')).toBe(true); // different band, same child is fine
  });

  it('rejects a wire that would form a cycle, without throwing', () => {
    const g: TriggerGraph = {
      nodes: [makeNode('random', 'a', 0, 0), makeNode('random', 'b', 100, 0)],
      edges: [{ id: 'e1', from: 'a', to: 'b' }],
    };
    expect(canConnect(g, 'b', 'a')).toBe(false); // would create an a↔b cycle
  });

  it('canReconnect rejects an unknown edge id without throwing', () => {
    expect(canReconnect(graph, 'no-such-edge', 'r1', 't1')).toBe(false);
  });
});

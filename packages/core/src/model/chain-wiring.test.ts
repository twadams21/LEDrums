import { describe, expect, it } from 'vitest';
import { classifyChainConnection, hoopKey, sourceKey, type ChainEdge } from './chain-wiring';

// D1 chain-wiring rules — the per-wire structural guard shared by the client editor and any
// server-side edge validation. Each `it` below is one legal accept OR one rejection code.

const h = (drumId: string, hoop: number) => ({ drumId, hoop });
const fromOut = (outputId: string) => ({ kind: 'output' as const, outputId });
const fromHoop = (drumId: string, hoop: number) => ({ kind: 'hoop' as const, ref: h(drumId, hoop) });
const edge = (from: ChainEdge['from'], to: ChainEdge['to']): ChainEdge => ({ from, to });

describe('classifyChainConnection — accepts legal wires', () => {
  it('accepts an Output → Hoop wire into a fresh graph', () => {
    expect(classifyChainConnection([], edge(fromOut('o1'), h('kick', 1)))).toEqual({ ok: true });
  });

  it('accepts a Hoop → Hoop wire extending a chain', () => {
    const edges = [edge(fromOut('o1'), h('kick', 1))];
    expect(classifyChainConnection(edges, edge(fromHoop('kick', 1), h('kick', 2)))).toEqual({ ok: true });
  });

  it('accepts an as-yet-unrooted Hoop → Hoop pair (rooting is a completeness concern, not a wire error)', () => {
    // No output wired yet — the pair is unrooted (an uncovered warning later), but the WIRE is legal.
    expect(classifyChainConnection([], edge(fromHoop('kick', 2), h('kick', 3)))).toEqual({ ok: true });
  });

  it('accepts a second output starting its own distinct hoop', () => {
    const edges = [edge(fromOut('o1'), h('kick', 1))];
    expect(classifyChainConnection(edges, edge(fromOut('o2'), h('snare', 1)))).toEqual({ ok: true });
  });
});

describe('classifyChainConnection — rejects each illegal wire', () => {
  it('rejects a hoop wiring to itself (self)', () => {
    const v = classifyChainConnection([], edge(fromHoop('kick', 1), h('kick', 1)));
    expect(v).toMatchObject({ ok: false, code: 'self' });
  });

  it('rejects a second wire out of an already-wired output (output-already-wired)', () => {
    const edges = [edge(fromOut('o1'), h('kick', 1))];
    const v = classifyChainConnection(edges, edge(fromOut('o1'), h('kick', 2)));
    expect(v).toMatchObject({ ok: false, code: 'output-already-wired' });
  });

  it('rejects a hoop that already has an upstream (hoop-has-upstream / fan-in)', () => {
    const edges = [edge(fromOut('o1'), h('kick', 2))]; // kick#2 already fed by o1
    const v = classifyChainConnection(edges, edge(fromHoop('kick', 1), h('kick', 2)));
    expect(v).toMatchObject({ ok: false, code: 'hoop-has-upstream' });
  });

  it('rejects a source hoop that already has a downstream (source-has-downstream / fan-out)', () => {
    const edges = [edge(fromOut('o1'), h('kick', 1)), edge(fromHoop('kick', 1), h('kick', 2))];
    const v = classifyChainConnection(edges, edge(fromHoop('kick', 1), h('kick', 3)));
    expect(v).toMatchObject({ ok: false, code: 'source-has-downstream' });
  });

  it('rejects a wire that would close a loop (cycle)', () => {
    // o1 → k1 → k2 → k3; wiring k3 → k1 would loop back.
    const edges = [
      edge(fromOut('o1'), h('kick', 1)),
      edge(fromHoop('kick', 1), h('kick', 2)),
      edge(fromHoop('kick', 2), h('kick', 3)),
    ];
    const v = classifyChainConnection(edges, edge(fromHoop('kick', 3), h('kick', 1)));
    // k1 already has an upstream (o1) → fan-in is reported first; both are correct rejections.
    expect(v.ok).toBe(false);
  });

  it('rejects a pure cycle on an unrooted pair (cycle, no fan-in to mask it)', () => {
    // Unrooted k1 → k2; wiring k2 → k1 loops (k1 has NO upstream yet, so cycle is the reason).
    const edges = [edge(fromHoop('kick', 1), h('kick', 2))];
    const v = classifyChainConnection(edges, edge(fromHoop('kick', 2), h('kick', 1)));
    expect(v).toMatchObject({ ok: false, code: 'cycle' });
  });
});

describe('key helpers', () => {
  it('hoopKey / sourceKey are stable + collision-free', () => {
    expect(hoopKey(h('kick', 1))).toBe('hoop:kick:1');
    expect(sourceKey(fromOut('o1'))).toBe('output:o1');
    expect(sourceKey(fromHoop('kick', 1))).toBe('hoop:kick:1');
  });
});

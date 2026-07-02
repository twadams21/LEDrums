import { describe, expect, it } from 'vitest';
import { migrateGraphEnvelopes, migrateGraphsEnvelopes, normalizeGraphs } from './hydrate';
import { adsrToPoints, makeNode, type AdsrShape, type Envelope, type TriggerGraph } from '../sim';

/* S24 — the S23-deferred hydrate wiring: persisted legacy envelope shapes normalize to v2
   (attackLevel + per-segment eases) on load, behaviour-preserving, idempotent, alias-stable. */

/** A persisted envelope built from a shape — its `points` are the shape's render curve. */
const envOf = (adsr: AdsrShape): Envelope => ({ kind: 'custom', amount: 1, points: adsrToPoints(adsr), adsr });

const legacyCurve0: AdsrShape = { attack: 0.2, decay: 0.3, sustain: 0.5, release: 0.25, curve: 0 };
const legacyCurveHalf: AdsrShape = { attack: 0.2, decay: 0.3, sustain: 0.5, release: 0.25, curve: 0.5 };

const graphWith = (adsr: AdsrShape): TriggerGraph => ({
  nodes: [
    makeNode('trigger', 'trigger'),
    makeNode('play', 'p1', 0, 0, { effectId: 'gen:radial-wash', env: { hue: envOf(adsr) } }),
  ],
  edges: [{ id: 'e0', from: 'trigger', to: 'p1' }],
});

describe('migrateGraphEnvelopes', () => {
  it('normalizes a legacy curve-0 shape to v2 (attackLevel + linear eases, curve dropped)', () => {
    const g = graphWith(legacyCurve0);
    const out = migrateGraphEnvelopes(g);
    const adsr = (out.nodes.find((n) => n.id === 'p1')!.env.hue!.adsr)!;
    expect(adsr.attackLevel).toBe(1);
    expect(adsr.attackEase).toEqual({ fn: 'linear', dir: 'in' });
    expect(adsr.decayEase).toEqual({ fn: 'linear', dir: 'in' });
    expect(adsr.releaseEase).toEqual({ fn: 'linear', dir: 'in' });
    expect(adsr.curve).toBeUndefined();
  });

  it('is behaviour-preserving — the persisted render points are untouched', () => {
    const g = graphWith(legacyCurve0);
    const before = g.nodes.find((n) => n.id === 'p1')!.env.hue!.points;
    const out = migrateGraphEnvelopes(g);
    const after = out.nodes.find((n) => n.id === 'p1')!.env.hue!;
    expect(after.points).toBe(before); // same reference — points not regenerated
    expect(after.points).toEqual(adsrToPoints(after.adsr!)); // …and still correct for the v2 shape
  });

  it('retains a non-representable curve on the fallback, only defaulting attackLevel', () => {
    const out = migrateGraphEnvelopes(graphWith(legacyCurveHalf));
    const adsr = out.nodes.find((n) => n.id === 'p1')!.env.hue!.adsr!;
    expect(adsr.curve).toBe(0.5);
    expect(adsr.attackLevel).toBe(1);
    expect(adsr.attackEase).toBeUndefined();
  });

  it('rebuilds only the changed play node; the trigger node keeps its reference', () => {
    const g = graphWith(legacyCurve0);
    const trigBefore = g.nodes.find((n) => n.id === 'trigger')!;
    const out = migrateGraphEnvelopes(g);
    expect(out).not.toBe(g); // graph rebuilt (a shape changed)
    expect(out.nodes.find((n) => n.id === 'trigger')!).toBe(trigBefore); // untouched node kept
    expect(out.edges).toBe(g.edges);
  });

  it('is a no-op (same graph ref) for an already-v2 shape', () => {
    const v2: AdsrShape = {
      attack: 0.2, decay: 0.3, sustain: 0.5, release: 0.25, attackLevel: 1,
      attackEase: { fn: 'cubic', dir: 'in' }, decayEase: { fn: 'sine', dir: 'out' }, releaseEase: { fn: 'expo', dir: 'out' },
    };
    const g = graphWith(v2);
    expect(migrateGraphEnvelopes(g)).toBe(g);
  });

  it('is a no-op for a play node with no envelope shapes', () => {
    const g: TriggerGraph = {
      nodes: [makeNode('play', 'p1', 0, 0, { effectId: 'gen:radial-wash' })],
      edges: [],
    };
    expect(migrateGraphEnvelopes(g)).toBe(g);
  });

  it('is idempotent + alias-stable on the second pass (incl. retained-curve shapes)', () => {
    for (const shape of [legacyCurve0, legacyCurveHalf]) {
      const once = migrateGraphEnvelopes(graphWith(shape));
      expect(migrateGraphEnvelopes(once)).toBe(once); // second pass changes nothing → same ref
    }
  });
});

describe('migrateGraphsEnvelopes / normalizeGraphs', () => {
  it('migrates across a keyed map, keeping unchanged graphs by reference', () => {
    const changed = graphWith(legacyCurve0);
    const unchanged: TriggerGraph = { nodes: [makeNode('trigger', 'trigger')], edges: [] };
    const out = migrateGraphsEnvelopes({ a: changed, b: unchanged });
    expect(out.a).not.toBe(changed);
    expect(out.b).toBe(unchanged);
  });

  it('normalizeGraphs applies the envelope migration on load', () => {
    const { graphs } = normalizeGraphs({ 'kick:1': graphWith(legacyCurve0) }, {}, []);
    const adsr = graphs['kick:1']!.nodes.find((n) => n.id === 'p1')!.env.hue!.adsr!;
    expect(adsr.attackEase).toEqual({ fn: 'linear', dir: 'in' });
    expect(adsr.curve).toBeUndefined();
  });
});

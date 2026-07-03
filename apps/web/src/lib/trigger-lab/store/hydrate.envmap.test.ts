import { describe, expect, it } from 'vitest';
import { migrateGraphEnvMaps, migrateGraphsEnvMaps, normalizeGraphs, type SpecsFor } from './hydrate';
import { makeNode, type Envelope, type ParamSpec, type TriggerGraph } from '../sim';
import { voice } from '@ledrums/core';

/* S35 — legacy play-node EnvMap → S34 modulation graph. The hydrate-time migrator folds each
   play node's per-param `env` into an `envelope` SOURCE node + a `param:<key>` mapping edge and
   drops the legacy field. These tests pin the three acceptance criteria: migration PARITY (the
   S33 fixture — pre-env behaviour == post-migration mappings, sample-identical across the voice
   life), IDEMPOTENCE (a migrated graph is a no-op on re-run), and that OLD graphs load unchanged. */

const KEY = voice.ENVELOPE_NODE_KEY;

/** A one-play-node graph carrying a single legacy per-param env — an old persisted play node. */
function playGraph(param: string, env: Envelope, base: number): TriggerGraph {
  return {
    nodes: [
      makeNode('trigger', 'trigger'),
      makeNode('play', 'p1', 100, 40, { effectId: 'fx', params: { [param]: base }, env: { [param]: env } }),
    ],
    edges: [{ id: 'e0', from: 'trigger', to: 'p1' }],
  };
}

/** Resolve the migrated play node's param value at a life `phase` — the EXACT engine path:
    `resolveNodeModulations` (no specs, ranges baked on the edge) → `applyModulations`. */
function migratedValue(spec: ParamSpec, base: number, env: Envelope, phase: number): number {
  const migrated = migrateGraphEnvMaps(playGraph(spec.key, env, base), () => [spec]);
  const p1 = migrated.nodes.find((n) => n.id === 'p1')!;
  const mappings = voice.resolveNodeModulations(migrated, p1);
  const out: Record<string, number> = { [spec.key]: base };
  voice.applyModulations({ [spec.key]: base }, out, mappings, [spec], { phase, timeMs: 0, bpm: 120 });
  return typeof out[spec.key] === 'number' ? out[spec.key]! : base;
}

describe('S35 EnvMap migration — parity with the legacy env sweep (S33 fixture)', () => {
  for (const c of voice.MODULATION_PARITY_CASES) {
    it(`sample-identical across the voice life: ${c.label}`, () => {
      for (const phase of voice.PARITY_PHASES) {
        const legacy = voice.legacyEnvValue(c.spec, c.base, c.env, phase);
        // Parity holds to floating-point precision (the model additionally range-clamps — a no-op
        // within range, a ~1 ULP snap at an exact endpoint), matching S33's 12-digit bound.
        expect(migratedValue(c.spec, c.base, c.env, phase)).toBeCloseTo(legacy, 12);
      }
    });
  }
});

describe('S35 EnvMap migration — graph shape', () => {
  const spec: ParamSpec = { key: 'speed', label: 'Speed', kind: 'number', min: 0, max: 4, default: 1 };
  const env: Envelope = { kind: 'decay', amount: 0.75, points: [{ t: 0, v: 1 }, { t: 1, v: 0 }] };
  const specsFor: SpecsFor = () => [spec];

  it('folds one env[key] into one envelope node + one param edge, exposes the row, clears play env', () => {
    const out = migrateGraphEnvMaps(playGraph('speed', env, 1), specsFor);
    const p1 = out.nodes.find((n) => n.id === 'p1')!;
    const sources = out.nodes.filter((n) => n.kind === 'envelope');
    expect(sources).toHaveLength(1);
    expect(sources[0]!.env[KEY]).toEqual(env); // shape carried verbatim
    expect(p1.env).toEqual({}); // legacy field dropped
    expect(p1.modInputs).toEqual([{ param: 'speed' }]); // param exposed as a target row

    const edges = out.edges.filter((e) => e.to === 'p1' && e.toPort === 'param:speed');
    expect(edges).toHaveLength(1);
    // The edge IS the mapping — equivalent to `envelopeToMapping` (amount from the env, spec range).
    expect(edges[0]).toMatchObject({ from: sources[0]!.id, amount: 0.75, invert: false, rangeMin: 0, rangeMax: 4 });
  });

  it('drops an env on an unknown / non-number param (inert in the legacy sweep — no node created)', () => {
    const boolSpec: ParamSpec = { key: 'tempoSync', label: 'Tempo', kind: 'bool', default: false };
    const unknown = migrateGraphEnvMaps(playGraph('nope', env, 1), () => []); // no spec for 'nope'
    const nonNumber = migrateGraphEnvMaps(playGraph('tempoSync', env, 1), () => [boolSpec]);
    for (const out of [unknown, nonNumber]) {
      expect(out.nodes.some((n) => n.kind === 'envelope')).toBe(false);
      expect(out.nodes.find((n) => n.id === 'p1')!.env).toEqual({}); // still cleared, just not wired
    }
  });

  it('leaves envelope source + modifier node env untouched (only play nodes migrate)', () => {
    const graph: TriggerGraph = {
      nodes: [
        makeNode('envelope', 'src', 0, 0, { env: { [KEY]: env } }),
        makeNode('modifier', 'm', 0, 0, { modifierId: 'trail', env: { decayMs: env } }),
      ],
      edges: [],
    };
    const out = migrateGraphEnvMaps(graph, specsFor);
    expect(out).toBe(graph); // no play node with legacy env → same reference
  });
});

describe('S35 EnvMap migration — idempotent + alias-stable', () => {
  const spec: ParamSpec = { key: 'brightness', label: 'Brightness', kind: 'number', min: 0, max: 1, default: 1 };
  const env: Envelope = { kind: 'decay', amount: 1, points: [{ t: 0, v: 1 }, { t: 1, v: 0 }] };
  const specsFor: SpecsFor = () => [spec];

  it('migrating a migrated graph is a no-op (same reference, no new nodes/edges)', () => {
    const once = migrateGraphEnvMaps(playGraph('brightness', env, 1), specsFor);
    const twice = migrateGraphEnvMaps(once, specsFor);
    expect(twice).toBe(once); // second pass finds no legacy env → same ref
    expect(once.nodes.filter((n) => n.kind === 'envelope')).toHaveLength(1);
  });

  it('across a keyed map: only graphs with legacy env are rebuilt', () => {
    const changed = playGraph('brightness', env, 1);
    const clean: TriggerGraph = { nodes: [makeNode('trigger', 'trigger')], edges: [] };
    const out = migrateGraphsEnvMaps({ a: changed, b: clean }, specsFor);
    expect(out.a).not.toBe(changed);
    expect(out.b).toBe(clean);
  });

  it('an already-migrated graph loaded through normalizeGraphs is unchanged', () => {
    const first = normalizeGraphs({ 'kick:1': playGraph('brightness', env, 1) }, {}, [], specsFor).graphs;
    const second = normalizeGraphs(first, {}, [], specsFor).graphs;
    // No new envelope nodes appear on the second load (idempotent through the full hydrate pass).
    const count = (g: Record<string, TriggerGraph>) =>
      g['kick:1']!.nodes.filter((n) => n.kind === 'envelope').length;
    expect(count(second)).toBe(count(first));
    expect(count(first)).toBe(1);
  });
});

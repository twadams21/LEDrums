import { describe, expect, it } from 'vitest';
import { defaultEnvelope, makeNode, type TriggerGraph } from '../sim';
import { migrateGen3Graph, normalizeGraphs, sanitizeGraphIntegrity } from './hydrate';

const graph = (): TriggerGraph => ({
  nodes: [
    makeNode('trigger', 'trigger'),
    makeNode('play', 'p1', 100, 0, { effectId: 'gen:radial-wash' }),
    makeNode('play', 'p1', 200, 0, { effectId: 'gen:radial-wash' }),
  ],
  edges: [
    { id: 'e1', from: 'trigger', to: 'p1' },
    { id: 'e2', from: 'ghost', to: 'p1' },
    { id: 'e3', from: 'trigger', to: 'ghost' },
    { id: 'e1', from: 'trigger', to: 'p1', fromPort: 'band-0' },
    { id: 'e4', from: 'trigger', to: 'trigger' },
    { id: 'e5', from: 'trigger', to: 'p1' },
  ],
});

describe('sanitizeGraphIntegrity', () => {
  it('drops duplicate node ids, dangling edges, duplicate edge ids, self-edges, and duplicate connections', () => {
    const clean = sanitizeGraphIntegrity(graph());

    expect(clean.version).toBe(3);
    expect(clean.nodes.map((n) => n.id)).toEqual(['trigger', 'p1', 'output']);
    expect(clean.nodes.find((n) => n.id === 'p1')?.kind).toBe('effect');
    expect(clean.edges).toEqual([
      { id: 'e1', from: 'trigger', to: 'p1' },
      expect.objectContaining({ from: 'p1', to: 'output' }),
    ]);
  });

  it('delegates valid legacy graphs through core Gen3 normalization', () => {
    const valid: TriggerGraph = {
      nodes: [makeNode('trigger', 'trigger'), makeNode('play', 'p1', 100, 0, { effectId: 'gen:radial-wash' })],
      edges: [{ id: 'e1', from: 'trigger', to: 'p1' }],
    };

    const clean = sanitizeGraphIntegrity(valid);
    expect(clean.version).toBe(3);
    expect(clean.nodes.find((n) => n.id === 'p1')?.kind).toBe('effect');
    expect(clean.edges).toContainEqual(expect.objectContaining({ from: 'p1', to: 'output' }));
  });

  it('runs inside the full normalizeGraphs load/adopt path', () => {
    const { graphs } = normalizeGraphs({ 'kick:0': graph() }, {}, [], () => [], () => undefined);

    expect(graphs['kick:0']!.nodes.map((n) => n.id)).toEqual(['trigger', 'p1', 'output']);
    expect(graphs['kick:0']!.edges).toEqual([
      { id: 'e1', from: 'trigger', to: 'p1' },
      expect.objectContaining({ from: 'p1', to: 'output' }),
    ]);
  });
});

describe('migrateGen3Graph', () => {
  it('migrates legacy play/output nodes into effect/scope plus one terminal Output anchor', () => {
    const legacy: TriggerGraph = {
      nodes: [
        makeNode('trigger', 'trigger', 0, 0),
        makeNode('play', 'p1', 200, 0, { effectId: 'gen:radial-wash' }),
        makeNode('output', 'legacy-output', 420, 0, { scope: 'drum', targetId: 'snare' }),
      ],
      edges: [
        { id: 'e1', from: 'trigger', to: 'p1' },
        { id: 'e2', from: 'p1', to: 'legacy-output' },
      ],
    };

    const migrated = migrateGen3Graph(legacy);

    expect(migrated.version).toBe(3);
    expect(migrated.nodes.filter((n) => n.kind === 'trigger')).toHaveLength(1);
    expect(migrated.nodes.filter((n) => n.kind === 'output')).toHaveLength(1);
    expect(migrated.nodes.find((n) => n.id === 'p1')?.kind).toBe('effect');
    expect(migrated.nodes.find((n) => n.id === 'legacy-output')?.kind).toBe('scope');
    expect(migrated.edges).toEqual(
      expect.arrayContaining([
        { id: 'e1', from: 'trigger', to: 'p1' },
        { id: 'e2', from: 'p1', to: 'legacy-output' },
        expect.objectContaining({ from: 'legacy-output', to: 'output' }),
      ]),
    );
  });

  it('wires unconnected legacy render leaves to the new Output anchor', () => {
    const migrated = migrateGen3Graph({
      nodes: [makeNode('trigger', 'trigger'), makeNode('play', 'p1', 200, 0, { effectId: 'gen:radial-wash' })],
      edges: [{ id: 'e1', from: 'trigger', to: 'p1' }],
    });

    expect(migrated.edges).toContainEqual(expect.objectContaining({ from: 'p1', to: 'output' }));
  });

  it('repairs duplicate Gen3 outputs and dangling edges through the full normalize path', () => {
    const { graphs } = normalizeGraphs(
      {
        g: {
          version: 3,
          nodes: [
            makeNode('trigger', 'trigger'),
            makeNode('effect', 'p1', 200, 0, { effectId: 'gen:radial-wash' }),
            makeNode('output', 'output', 400, 0),
            makeNode('output', 'extra-output', 500, 0),
          ],
          edges: [
            { id: 'e1', from: 'trigger', to: 'p1' },
            { id: 'e2', from: 'p1', to: 'extra-output' },
            { id: 'e3', from: 'ghost', to: 'output' },
          ],
        },
      },
      {},
      [],
      () => [],
      () => undefined,
    );

    const g = graphs.g!;
    expect(g.nodes.filter((n) => n.kind === 'output')).toHaveLength(1);
    expect(g.nodes.some((n) => n.kind === 'play')).toBe(false);
    expect(g.edges.every((e) => g.nodes.some((n) => n.id === e.from) && g.nodes.some((n) => n.id === e.to))).toBe(true);
    expect(g.edges).not.toContainEqual(expect.objectContaining({ from: 'p1', to: 'output' }));
  });

  it('is idempotent for already migrated Gen3 graphs', () => {
    const once = migrateGen3Graph({
      nodes: [makeNode('trigger', 'trigger'), makeNode('play', 'p1', 200, 0, { effectId: 'gen:radial-wash' })],
      edges: [{ id: 'e1', from: 'trigger', to: 'p1' }],
    });
    expect(migrateGen3Graph(once)).toEqual(once);
  });

  it('preserves Gen3 version and terminal Output through the full normalize path', () => {
    const { graphs } = normalizeGraphs(
      {
        'kick:0': {
          version: 3,
          nodes: [
            makeNode('trigger', 'trigger'),
            makeNode('effect', 'p1', 200, 0, { effectId: 'gen:radial-wash', env: { brightness: defaultEnvelope('decay') } }),
            makeNode('output', 'output', 400, 0),
          ],
          edges: [{ id: 'e1', from: 'trigger', to: 'p1' }, { id: 'e2', from: 'p1', to: 'output' }],
        },
      },
      {},
      [{ drumId: 'kick', drumLabel: 'Kick', zone: 0, zoneLabel: 'Center', tree: { id: 'p', kind: 'play', mode: 'oneshot', scope: 'kit', effectId: 'gen:radial-wash', presetId: '', params: {}, env: {} } }],
      () => [],
      () => undefined,
    );

    const g = graphs['kick:0']!;
    expect(g.version).toBe(3);
    expect(g.nodes.find((n) => n.id === 'output')?.kind).toBe('output');
    expect(g.nodes.find((n) => n.kind === 'trigger')?.source).toEqual({ kind: 'drum', drumId: 'kick', zone: '0' });
  });
});

describe('normalizeGraphs — system-action summary (R02)', () => {
  const legacy = (): TriggerGraph => ({
    nodes: [makeNode('trigger', 'trigger'), makeNode('play', 'p1', 200, 0, { effectId: 'gen:radial-wash' })],
    edges: [{ id: 'e1', from: 'trigger', to: 'p1' }],
  });

  it('reports one migration + one auto-wire for a single legacy graph', () => {
    const { actions } = normalizeGraphs({ 'kick:0': legacy() }, {}, [], () => [], () => undefined);
    expect(actions).toEqual({ migratedGraphs: 1, autoWiredNodes: 1 });
  });

  it('batches the summary across several legacy graphs (one summary, not per-graph)', () => {
    const { actions } = normalizeGraphs(
      { 'kick:0': legacy(), 'snare:0': legacy(), 'tom:0': legacy() },
      {},
      [],
      () => [],
      () => undefined,
    );
    expect(actions).toEqual({ migratedGraphs: 3, autoWiredNodes: 3 });
  });

  it('reports no system actions for an already-Gen3, fully-wired graph', () => {
    const gen3: TriggerGraph = {
      version: 3,
      nodes: [
        makeNode('trigger', 'trigger'),
        makeNode('effect', 'p1', 200, 0, { effectId: 'gen:radial-wash' }),
        makeNode('output', 'output', 400, 0),
      ],
      edges: [{ id: 'e1', from: 'trigger', to: 'p1' }, { id: 'e2', from: 'p1', to: 'output' }],
    };
    const { actions } = normalizeGraphs({ g: gen3 }, {}, [], () => [], () => undefined);
    expect(actions).toEqual({ migratedGraphs: 0, autoWiredNodes: 0 });
  });
});

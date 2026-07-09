import type { GraphEdge, GraphNode, TriggerGraph } from './types';
import { detectEmptyScopes } from './scope-lint';
import { detectUnreachable } from './reachability-lint';

export type RenderPlanIssueCode =
  | 'missing-trigger'
  | 'missing-output'
  | 'flow-cycle'
  | 'empty-scope'
  | 'no-path-to-output'
  | 'dead-branch';

export interface RenderPlanIssue {
  code: RenderPlanIssueCode;
  message: string;
  nodeId?: string;
}

export interface RenderPlanChild {
  edge: GraphEdge;
  node: GraphNode;
}

export interface RenderPlan {
  graph: TriggerGraph;
  nodesById: Map<string, GraphNode>;
  triggerId: string | null;
  flowChildrenById: Map<string, RenderPlanChild[]>;
  issues: RenderPlanIssue[];
  fatal: boolean;
}

export function isFlowEdge(edge: Pick<GraphEdge, 'toPort'>): boolean {
  return edge.toPort == null || edge.toPort === 'in';
}

export function compileRenderPlan(graph: TriggerGraph): RenderPlan {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node] as const));
  const flowChildrenById = new Map<string, RenderPlanChild[]>();
  const incomingFlowEdgesById = new Map<string, GraphEdge[]>();
  const issues: RenderPlanIssue[] = [];

  for (const node of graph.nodes) {
    flowChildrenById.set(node.id, []);
    incomingFlowEdgesById.set(node.id, []);
  }

  for (const edge of graph.edges) {
    if (!isFlowEdge(edge)) continue;
    const from = nodesById.get(edge.from);
    const to = nodesById.get(edge.to);
    if (!from || !to) continue;
    flowChildrenById.get(from.id)?.push({ edge, node: to });
    incomingFlowEdgesById.get(to.id)?.push(edge);
  }

  for (const children of flowChildrenById.values()) {
    children.sort((a, b) => a.node.y - b.node.y || a.node.id.localeCompare(b.node.id));
  }
  for (const edges of incomingFlowEdgesById.values()) {
    edges.sort((a, b) => {
      const ay = nodesById.get(a.from)?.y ?? 0;
      const by = nodesById.get(b.from)?.y ?? 0;
      return ay - by || a.id.localeCompare(b.id);
    });
  }

  const triggerId = graph.nodes.find((node) => node.kind === 'trigger')?.id ?? null;
  const outputId = graph.nodes.find((node) => node.kind === 'output')?.id ?? null;
  if (!triggerId) issues.push({ code: 'missing-trigger', message: 'Gen3 render plan requires a trigger source.' });
  if (!outputId) issues.push({ code: 'missing-output', message: 'Gen3 render plan requires a terminal output collector.' });
  issues.push(...detectFlowCycles(graph.nodes, flowChildrenById));
  // Empty-scope is a per-branch warning, not a fatal — other branches still render; a dead
  // scope branch just contributes nothing. Kept out of the `fatal` set below on purpose.
  issues.push(...detectEmptyScopes(nodesById, flowChildrenById));
  // Reachability warnings (R07): a producer with no path to Output, or a branch that reaches
  // Output with no producer to render. Non-fatal like empty-scope — other branches still render.
  // Purely structural (kinds + edges), so unlike empty-scope these can't go param-stale in the cache.
  issues.push(...detectUnreachable(nodesById, flowChildrenById, incomingFlowEdgesById, outputId));

  return {
    graph,
    nodesById,
    triggerId,
    flowChildrenById,
    issues,
    fatal: issues.some((issue) => issue.code === 'missing-trigger' || issue.code === 'missing-output' || issue.code === 'flow-cycle'),
  };
}

/**
 * Structure signature over exactly what {@link compileRenderPlan} reads to build a plan:
 * each node's `id`/`kind`/`y` and each edge's `id`/`from`/`to`/`toPort`. Two graphs with
 * equal signatures compile to structurally identical plans.
 *
 * Deliberately EXCLUDES params (effectId, mode, mixBlendMode, thresholds, …): compile never
 * reads them, and eval reads them off the live node objects the plan references. Under the
 * store's in-place mutation an edit mutates those node objects without replacing the graph, so
 * a cached plan keeps reading current params — a param edit needn't invalidate the plan, only a
 * structural edit does. That in-place mutation is also why object-identity alone can't gate reuse
 * (same object, changed structure); the signature closes that gap. Keep this in lockstep with the
 * fields {@link compileRenderPlan} actually reads.
 *
 * One sanctioned exception: the `empty-scope` lint (scope-lint.ts) reads scope/target PARAMS,
 * so a cached plan's `issues` can be stale for that code after a param-only edit. Safe today
 * because `empty-scope` is non-fatal (never gates eval) and every lint UI surface compiles
 * uncached/reactively — do not consume `issues` through {@link RenderPlanCache} for UI. The
 * `no-path-to-output`/`dead-branch` reachability lints (reachability-lint.ts) read structure
 * ONLY (kinds + flow edges), so they are fully covered by this signature and never go stale.
 */
export function renderPlanSignature(graph: TriggerGraph): string {
  const parts: string[] = [`v:${graph.version ?? ''}`, `n:${graph.nodes.length}`, `e:${graph.edges.length}`];
  for (const node of graph.nodes) parts.push(`${node.id}~${node.kind}~${node.y}`);
  for (const edge of graph.edges) parts.push(`${edge.id}>${edge.from}>${edge.to}>${edge.toPort ?? ''}`);
  return parts.join('|');
}

interface CacheEntry {
  signature: string;
  plan: RenderPlan;
}

/**
 * Caches compiled render plans across trigger hits so fast rolls don't recompile the graph per
 * hit. Keyed by graph object identity (a {@link WeakMap}, so per-graph — a multi-pad kit doesn't
 * thrash a single slot, and dropped graphs are collected) AND guarded by the structure signature,
 * so an in-place structural edit invalidates while a param-only edit reuses. Determinism is
 * preserved: a hit returns the very plan a fresh compile would have produced.
 *
 * Engine-owned/injected state (like `mixMemberSnapshots`), never a module-level global, so core
 * eval stays pure and deterministic given (time, inputs, model).
 */
export interface RenderPlanCache {
  /** Return the compiled plan for `graph`, reusing the cached one when its structure signature
      (and graph identity) is unchanged; otherwise compile, store, and return. */
  compile(graph: TriggerGraph): RenderPlan;
  /** Full compiles performed so far (cache misses). For tests/telemetry — reuse leaves it flat. */
  readonly compileCount: number;
  /** Drop all cached plans (e.g. on `setShow`, when authored content is replaced wholesale). */
  reset(): void;
}

export function createRenderPlanCache(): RenderPlanCache {
  let byGraph = new WeakMap<TriggerGraph, CacheEntry>();
  let compileCount = 0;
  return {
    get compileCount() {
      return compileCount;
    },
    compile(graph: TriggerGraph): RenderPlan {
      const signature = renderPlanSignature(graph);
      const cached = byGraph.get(graph);
      if (cached && cached.signature === signature) return cached.plan;
      const plan = compileRenderPlan(graph);
      byGraph.set(graph, { signature, plan });
      compileCount++;
      return plan;
    },
    reset(): void {
      byGraph = new WeakMap<TriggerGraph, CacheEntry>();
    },
  };
}

function detectFlowCycles(nodes: GraphNode[], flowChildrenById: Map<string, RenderPlanChild[]>): RenderPlanIssue[] {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycles: RenderPlanIssue[] = [];

  const visit = (node: GraphNode, path: string[]): void => {
    if (visited.has(node.id)) return;
    if (visiting.has(node.id)) {
      cycles.push({
        code: 'flow-cycle',
        message: `Flow cycle rejected: ${[...path.slice(path.indexOf(node.id)), node.id].join(' -> ')}.`,
        nodeId: node.id,
      });
      return;
    }
    visiting.add(node.id);
    for (const child of flowChildrenById.get(node.id) ?? []) visit(child.node, [...path, child.node.id]);
    visiting.delete(node.id);
    visited.add(node.id);
  };

  for (const node of nodes) visit(node, [node.id]);
  return cycles;
}

import type { GraphEdge, GraphNode, NodeKind, TriggerGraph } from './types';
import { detectEmptyScopes } from './scope-lint';

export type RenderPlanNodeCategory =
  | 'trigger-source'
  | 'route-control'
  | 'layer-producer'
  | 'layer-transform'
  | 'collector'
  | 'modulation-source';

export type RenderPlanIssueCode = 'missing-trigger' | 'missing-output' | 'flow-cycle' | 'empty-scope';

export interface RenderPlanIssue {
  code: RenderPlanIssueCode;
  message: string;
  nodeId?: string;
}

export interface RenderPlanNode {
  node: GraphNode;
  category: RenderPlanNodeCategory;
}

export interface RenderPlanChild {
  edge: GraphEdge;
  node: GraphNode;
}

export interface RenderPlan {
  graph: TriggerGraph;
  nodesById: Map<string, GraphNode>;
  planNodesById: Map<string, RenderPlanNode>;
  triggerId: string | null;
  outputId: string | null;
  flowChildrenById: Map<string, RenderPlanChild[]>;
  incomingFlowEdgesById: Map<string, GraphEdge[]>;
  issues: RenderPlanIssue[];
  fatal: boolean;
}

export function nodeCategory(kind: NodeKind): RenderPlanNodeCategory {
  switch (kind) {
    case 'trigger':
      return 'trigger-source';
    case 'all':
    case 'random':
    case 'sequence':
    case 'switch':
    case 'chance':
    case 'toggle':
    case 'delay':
      return 'route-control';
    case 'effect':
    case 'play':
      return 'layer-producer';
    case 'scope':
    case 'modifier':
      return 'layer-transform';
    case 'mix':
    case 'output':
      return 'collector';
    case 'envelope':
    case 'lfo':
    case 'cc':
    case 'note':
    case 'osc':
    case 'randomMod':
      return 'modulation-source';
  }
}

export function isFlowEdge(edge: Pick<GraphEdge, 'toPort'>): boolean {
  return edge.toPort == null || edge.toPort === 'in';
}

export function compileRenderPlan(graph: TriggerGraph): RenderPlan {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node] as const));
  const planNodesById = new Map(graph.nodes.map((node) => [node.id, { node, category: nodeCategory(node.kind) }] as const));
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

  return {
    graph,
    nodesById,
    planNodesById,
    triggerId,
    outputId,
    flowChildrenById,
    incomingFlowEdgesById,
    issues,
    fatal: issues.some((issue) => issue.code === 'missing-trigger' || issue.code === 'missing-output' || issue.code === 'flow-cycle'),
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

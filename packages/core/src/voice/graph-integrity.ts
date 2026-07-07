import type { GraphEdge, GraphNode, TriggerGraph } from './types';

export type TriggerGraphIssueCode =
  | 'missing-trigger'
  | 'missing-output'
  | 'duplicate-output'
  | 'duplicate-node-id'
  | 'duplicate-edge-id'
  | 'dangling-edge'
  | 'self-edge'
  | 'persisted-play-in-gen3'
  | 'duplicate-connection';

export interface TriggerGraphIssue {
  code: TriggerGraphIssueCode;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface TriggerGraphIntegrityResult {
  graph: TriggerGraph;
  issues: TriggerGraphIssue[];
}

const OUTPUT_ANCHOR_ID = 'output';
const NODE_W = 220;
const H_GAP = 90;

function anchorNode(kind: 'trigger' | 'output', x: number, y: number): GraphNode {
  return {
    id: kind,
    kind,
    x,
    y,
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
    mixBlendMode: 'normal',
    delayMode: 'time',
    ms: 250,
    division: '1/8',
  };
}

function isFlowEdge(edge: GraphEdge): boolean {
  return edge.toPort == null || edge.toPort === 'in';
}

function isRenderLeafCandidate(node: GraphNode): boolean {
  return node.kind === 'play' || node.kind === 'effect' || node.kind === 'modifier' || node.kind === 'scope';
}

function edgeIdFor(existing: Set<string>, base: string): string {
  if (!existing.has(base)) return base;
  let i = 2;
  while (existing.has(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

function connectionKey(edge: GraphEdge): string {
  return `${edge.from}:${edge.fromPort ?? ''}>${edge.to}:${edge.toPort ?? ''}`;
}

function issue(code: TriggerGraphIssueCode, message: string, partial: Partial<TriggerGraphIssue> = {}): TriggerGraphIssue {
  return { code, message, ...partial };
}

export function normalizeTriggerGraphToGen3(graph: TriggerGraph): TriggerGraphIntegrityResult {
  const issues: TriggerGraphIssue[] = [];
  const legacy = graph.version !== 3;
  const sourceNodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const sourceEdges = Array.isArray(graph.edges) ? graph.edges : [];
  const remap = new Map<string, string>();

  const firstTrigger = sourceNodes.find((n) => n.kind === 'trigger');
  if (!firstTrigger) issues.push(issue('missing-trigger', 'Graph is missing a trigger anchor.'));
  const trigger = firstTrigger ?? anchorNode('trigger', 0, 0);

  const legacyOutputs = legacy ? sourceNodes.filter((n) => n.kind === 'output') : [];
  const canonicalOutputs = legacy ? [] : sourceNodes.filter((n) => n.kind === 'output');
  if (!legacy && canonicalOutputs.length === 0) issues.push(issue('missing-output', 'Gen3 graph is missing a terminal output anchor.'));
  if (!legacy && canonicalOutputs.length > 1) {
    for (const extra of canonicalOutputs.slice(1)) {
      issues.push(issue('duplicate-output', 'Gen3 graph has more than one terminal output anchor.', { nodeId: extra.id }));
    }
  }

  const nodes: GraphNode[] = [];
  const seenNodes = new Set<string>();
  const addNode = (node: GraphNode): void => {
    if (!node.id || seenNodes.has(node.id)) {
      issues.push(issue('duplicate-node-id', 'Duplicate or empty node id removed.', { nodeId: node.id }));
      return;
    }
    seenNodes.add(node.id);
    nodes.push(node);
  };

  addNode(trigger);
  for (const node of sourceNodes) {
    if (node.kind === 'trigger') continue;
    if (legacy && node.kind === 'output') {
      const id = node.id === OUTPUT_ANCHOR_ID ? `scope:${OUTPUT_ANCHOR_ID}` : node.id;
      if (id !== node.id) remap.set(node.id, id);
      addNode({ ...node, id, kind: 'scope' });
      continue;
    }
    if (!legacy && node.kind === 'output') continue;
    if (!legacy && node.kind === 'play') {
      issues.push(issue('persisted-play-in-gen3', 'Gen3 graph contained legacy play node; rewritten to effect.', { nodeId: node.id }));
    }
    addNode(node.kind === 'play' ? { ...node, kind: 'effect' } : node);
  }

  const anchorSource = legacy ? legacyOutputs[0] : canonicalOutputs[0];
  const maxX = nodes.reduce((m, n) => Math.max(m, n.x), trigger.x);
  addNode({
    ...anchorNode('output', Math.max(maxX + NODE_W + H_GAP, 420), anchorSource?.y ?? trigger.y),
    id: OUTPUT_ANCHOR_ID,
  });

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edgeIds = new Set<string>();
  const connectionKeys = new Set<string>();
  const edges: GraphEdge[] = [];
  const firstOutputId = canonicalOutputs[0]?.id;
  const addEdge = (edge: GraphEdge): void => {
    if (!edge.id || edgeIds.has(edge.id)) {
      issues.push(issue('duplicate-edge-id', 'Duplicate or empty edge id removed.', { edgeId: edge.id }));
      return;
    }
    if (edge.from === edge.to) {
      issues.push(issue('self-edge', 'Self edge removed.', { edgeId: edge.id, nodeId: edge.from }));
      return;
    }
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      issues.push(issue('dangling-edge', 'Dangling edge removed.', { edgeId: edge.id }));
      return;
    }
    const key = connectionKey(edge);
    if (connectionKeys.has(key)) {
      issues.push(issue('duplicate-connection', 'Duplicate connection removed.', { edgeId: edge.id }));
      return;
    }
    edgeIds.add(edge.id);
    connectionKeys.add(key);
    edges.push(edge);
  };

  for (const edge of sourceEdges) {
    const from = remap.get(edge.from) ?? edge.from;
    const to = remap.get(edge.to) ?? edge.to;
    const next = !legacy && firstOutputId && to === firstOutputId && firstOutputId !== OUTPUT_ANCHOR_ID
      ? { ...edge, from, to: OUTPUT_ANCHOR_ID }
      : { ...edge, from, to };
    addEdge(next);
  }

  const hasOutgoingFlow = new Set(edges.filter(isFlowEdge).map((e) => e.from));
  const leaves = nodes.filter((n) => n.id !== OUTPUT_ANCHOR_ID && isRenderLeafCandidate(n) && !hasOutgoingFlow.has(n.id));
  for (const leaf of leaves) {
    addEdge({ id: edgeIdFor(edgeIds, `e-${leaf.id}-output`), from: leaf.id, to: OUTPUT_ANCHOR_ID });
  }

  return { graph: { ...graph, version: 3, nodes, edges }, issues };
}

export function validateTriggerGraphIntegrity(graph: TriggerGraph): TriggerGraphIssue[] {
  return normalizeTriggerGraphToGen3(graph).issues;
}

export function assertTriggerGraphIntegrity(graph: TriggerGraph): void {
  const issues = validateTriggerGraphIntegrity(graph);
  if (issues.length) {
    throw new Error(`Invalid trigger graph: ${issues.map((i) => i.code).join(', ')}`);
  }
}

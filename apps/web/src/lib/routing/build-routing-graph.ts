import type { Edge, Node } from '@xyflow/svelte';
import type { Project } from '@ledrums/core';

type RoutingNode = Node<{ label: string; kind: string; detail: string }>;
type RoutingEdge = Edge & { reconnectable?: boolean };

const DEFAULT_POSITIONS: Record<string, { x: number; y: number }> = {
  'ableton-osc': { x: 0, y: 20 },
  'sensory-osc': { x: 0, y: 180 },
  'hoop-combine': { x: 520, y: 120 },
  'controller-output': { x: 760, y: 120 },
  controller: { x: 1000, y: 120 },
};

export function buildRoutingGraph(
  project: Project,
  savedPositions: Record<string, { x: number; y: number }> = {},
): { nodes: RoutingNode[]; edges: RoutingEdge[] } {
  const nodes: RoutingNode[] = [
    node('ableton-osc', 'input', 'Ableton OSC Input', 'OSC port 9000', savedPositions),
    node(
      'sensory-osc',
      'input',
      'Sensory Percussion Input',
      `${project.inputMap.oscMap.length} trigger outputs`,
      savedPositions,
    ),
  ];

  for (const [index, drum] of project.kit.drums.entries()) {
    nodes.push(
      node(
        `drum-${drum.id}`,
        'default',
        drum.label,
        `${drum.hoopCount ?? 4} hoop outputs`,
        savedPositions,
        { x: 260, y: 40 + index * 120 },
      ),
    );
  }

  nodes.push(
    node('hoop-combine', 'default', 'Hoop-Combine', '2 hoop inputs -> 1 output', savedPositions),
    node(
      'controller-output',
      'default',
      'Controller-Output',
      '2 data inputs, expanded mode',
      savedPositions,
    ),
    node(
      'controller',
      'output',
      'Controller',
      `${project.kit.outputs.length || 4} physical outputs`,
      savedPositions,
    ),
  );

  const edges: RoutingEdge[] = [];
  for (const drum of project.kit.drums) {
    edges.push(edge(`sensory-drum-${drum.id}`, 'sensory-osc', `drum-${drum.id}`, 'trigger'));
    edges.push(edge(`drum-combine-${drum.id}`, `drum-${drum.id}`, 'hoop-combine', 'hoops'));
  }
  edges.push(
    edge('ableton-controller-output', 'ableton-osc', 'controller-output', 'automation'),
    edge('combine-controller-output', 'hoop-combine', 'controller-output', 'data'),
    edge('controller-output-controller', 'controller-output', 'controller', '4 outputs'),
  );

  return { nodes, edges };
}

function edge(id: string, source: string, target: string, label: string): RoutingEdge {
  return { id, source, target, label, type: 'smoothstep', reconnectable: true };
}

function node(
  id: string,
  type: RoutingNode['type'],
  label: string,
  detail: string,
  savedPositions: Record<string, { x: number; y: number }>,
  fallback?: { x: number; y: number },
): RoutingNode {
  return {
    id,
    type,
    data: { label, kind: type ?? 'default', detail },
    position: savedPositions[id] ?? DEFAULT_POSITIONS[id] ?? fallback ?? { x: 0, y: 0 },
  };
}

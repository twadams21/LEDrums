import type { Edge, Node } from '@xyflow/svelte';
import type { Project } from '@ledrums/core';

type RoutingNode = Node<{ label: string; kind: string; detail: string }>;

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
): { nodes: RoutingNode[]; edges: Edge[] } {
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

  const edges: Edge[] = [];
  for (const drum of project.kit.drums) {
    edges.push({
      id: `sensory-drum-${drum.id}`,
      source: 'sensory-osc',
      target: `drum-${drum.id}`,
      label: 'trigger',
    });
    edges.push({
      id: `drum-combine-${drum.id}`,
      source: `drum-${drum.id}`,
      target: 'hoop-combine',
      label: 'hoops',
    });
  }
  edges.push(
    { id: 'ableton-controller-output', source: 'ableton-osc', target: 'controller-output', label: 'automation' },
    { id: 'combine-controller-output', source: 'hoop-combine', target: 'controller-output', label: 'data' },
    { id: 'controller-output-controller', source: 'controller-output', target: 'controller', label: '4 outputs' },
  );

  return { nodes, edges };
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

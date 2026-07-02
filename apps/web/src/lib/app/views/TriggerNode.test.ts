// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import type { NodeProps } from '@xyflow/svelte';
import type { TriggerLab } from '../../trigger-lab/store.svelte';
import { makeNode, type NodeKind, type TriggerGraph } from '../../trigger-lab/sim';
import { TRIGGER_STORE_KEY } from './trigger-context';
import TriggerNode from './TriggerNode.svelte';

/* Incident 09 acceptance: a NodeCard whose id is missing from the store must render a VISIBLE
   "stale node" placeholder (dashed warn card, id surfaced) rather than a blank card — a blank
   card told us nothing for a day. Only the placeholder branch is exercised here: it renders no
   <Handle>, so the component mounts without a <SvelteFlow> provider. */

/** A store stub exposing only what TriggerNode reads on the placeholder path. */
function storeWith(graph: TriggerGraph | null): TriggerLab {
  return { selectedGraph: graph } as unknown as TriggerLab;
}

/** Full NodeProps with sane defaults (no cast needed — every required field is concrete). */
function nodeProps(id: string, kind: NodeKind = 'random'): NodeProps {
  return {
    id,
    type: 'trigger',
    data: { kind },
    dragging: false,
    zIndex: 0,
    selectable: true,
    deletable: false,
    selected: false,
    draggable: true,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
  };
}

function renderNode(id: string, graph: TriggerGraph | null) {
  return render(TriggerNode, {
    props: nodeProps(id),
    context: new Map<symbol, unknown>([[TRIGGER_STORE_KEY, storeWith(graph)]]),
  });
}

describe('TriggerNode — blank-proof stale placeholder (incident 09)', () => {
  it('renders a visible "Stale node" placeholder (with the id) when the store has no node for this id', () => {
    const { container, getByText } = renderNode('ghost-42', {
      nodes: [makeNode('trigger', 'trigger')],
      edges: [],
    });

    expect(getByText('Stale node')).toBeTruthy(); // NOT a blank card
    expect(getByText('ghost-42')).toBeTruthy(); // the id is surfaced for diagnosis
    expect(container.querySelector('.card.stale')).not.toBeNull(); // warn placeholder styling
  });

  it('shows the placeholder even when OTHER nodes exist but not this id (cross-graph desync)', () => {
    const graph: TriggerGraph = {
      nodes: [makeNode('trigger', 'trigger'), makeNode('random', 'other')],
      edges: [],
    };
    const { getByText } = renderNode('missing', graph);
    expect(getByText('Stale node')).toBeTruthy();
  });

  it('shows the placeholder when there is no selected graph at all', () => {
    const { getByText } = renderNode('x', null);
    expect(getByText('Stale node')).toBeTruthy();
  });
});

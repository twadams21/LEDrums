// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import type { GraphNode } from '../../../trigger-lab/sim';
import type { TriggerLab } from '../../../trigger-lab/store.svelte';
import OutputNodeInspector from './OutputNodeInspector.svelte';

const outputNode = (overrides: Partial<GraphNode> = {}): GraphNode =>
  ({ id: 'output', kind: 'output', x: 0, y: 0, scope: 'kit', ...overrides }) as GraphNode;

// The output inspector reads kitDrumInfos + the scope/target mutators, and `selectedGraph`
// (to compile the empty-scope lint). A null graph → no lint row.
const stubStore = (selectedGraph: TriggerLab['selectedGraph'] = null): TriggerLab =>
  ({ kitDrumInfos: [], setScope() {}, setTargetId() {}, selectedGraph }) as unknown as TriggerLab;

// A minimal graph where the sole effect (scoped `kick`) feeds an Output scoped `snare` — the
// render-plan compiler flags the Output empty-scope (R06).
const emptyScopeGraph = (): TriggerLab['selectedGraph'] =>
  ({
    version: 3,
    nodes: [
      { id: 'trigger', kind: 'trigger', x: 0, y: 0, scope: 'kit' },
      { id: 'fx', kind: 'effect', x: 0, y: 0, scope: 'drum', targetId: 'kick', effectId: 'plasma' },
      { id: 'output', kind: 'output', x: 0, y: 0, scope: 'drum', targetId: 'snare' },
    ],
    edges: [{ id: 'fx-out', from: 'fx', to: 'output' }],
  }) as unknown as TriggerLab['selectedGraph'];

describe('OutputNodeInspector', () => {
  it('renders the protected-anchor header instead of a kind selector', () => {
    const { container } = render(OutputNodeInspector, { props: { store: stubStore(), node: outputNode() } });
    // header treatment present…
    expect(container.querySelector('.anchorhead')).not.toBeNull();
    expect(container.querySelector('.anchorhead h3')?.textContent).toBe('Output');
    // …and no node-type kind selector (the empty-option control R27 removes)
    expect(container.querySelector('[aria-label="Node type"]')).toBeNull();
  });

  it('shows only the Scope field at kit scope (no Target picker)', () => {
    const { getByLabelText, queryByLabelText } = render(OutputNodeInspector, {
      props: { store: stubStore(), node: outputNode({ scope: 'kit' } as Partial<GraphNode>) },
    });
    expect(getByLabelText('Output scope')).not.toBeNull();
    expect(queryByLabelText('Output target')).toBeNull();
  });

  it('shows the empty-scope row with actionable copy when the Output can never light', () => {
    const { container } = render(OutputNodeInspector, {
      props: {
        store: stubStore(emptyScopeGraph()),
        node: outputNode({ scope: 'drum', targetId: 'snare' } as Partial<GraphNode>),
      },
    });
    const row = container.querySelector('.empty-scope');
    expect(row).not.toBeNull();
    expect(row?.querySelector('.es-problem')?.textContent).toBeTruthy();
    // The copy names the next step, not just the fault.
    expect(row?.querySelector('.es-action')?.textContent).toMatch(/widen|scope/i);
  });

  it('omits the empty-scope row when the Output scope resolves', () => {
    // kit Output collects the `kick` effect just fine — no empty-scope finding.
    const graph = {
      version: 3,
      nodes: [
        { id: 'trigger', kind: 'trigger', x: 0, y: 0, scope: 'kit' },
        { id: 'fx', kind: 'effect', x: 0, y: 0, scope: 'drum', targetId: 'kick', effectId: 'plasma' },
        { id: 'output', kind: 'output', x: 0, y: 0, scope: 'kit' },
      ],
      edges: [{ id: 'fx-out', from: 'fx', to: 'output' }],
    } as unknown as TriggerLab['selectedGraph'];
    const { container } = render(OutputNodeInspector, {
      props: { store: stubStore(graph), node: outputNode({ scope: 'kit' } as Partial<GraphNode>) },
    });
    expect(container.querySelector('.empty-scope')).toBeNull();
  });
});

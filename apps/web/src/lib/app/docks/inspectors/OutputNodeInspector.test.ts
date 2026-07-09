// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import type { GraphNode } from '../../../trigger-lab/sim';
import type { TriggerLab } from '../../../trigger-lab/store.svelte';
import OutputNodeInspector from './OutputNodeInspector.svelte';

const outputNode = (overrides: Partial<GraphNode> = {}): GraphNode =>
  ({ id: 'output', kind: 'output', x: 0, y: 0, scope: 'kit', ...overrides }) as GraphNode;

// The output inspector only reads kitDrumInfos + the scope/target mutators from the store.
const stubStore = (): TriggerLab => ({ kitDrumInfos: [], setScope() {}, setTargetId() {} }) as unknown as TriggerLab;

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
});

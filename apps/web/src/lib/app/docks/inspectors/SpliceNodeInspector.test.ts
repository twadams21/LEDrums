// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import type { GraphNode } from '../../../trigger-lab/sim';
import type { TriggerLab } from '../../../trigger-lab/store.svelte';
import { makeNode } from '../../../trigger-lab/sim';
import SpliceNodeInspector from './SpliceNodeInspector.svelte';

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

const spliceNode = (overrides: Partial<GraphNode> = {}): GraphNode =>
  makeNode('splice', 'splice', 0, 0, {
    spliceChase: 'step',
    splicePartition: 'hoop',
    spliceWaitMode: 'fade',
    spliceOffsetMode: 'time',
    spliceColorOffsetMode: 'time',
    ...overrides,
  });

const stubStore = (): TriggerLab =>
  ({
    effects: [],
    buses: [{ id: 'base', name: 'Base', polyphony: 'mono' }],
    kitDrumInfos: [],
    busOf: () => 'base',
    setScope: vi.fn(),
    setTargetId: vi.fn(),
    setSpliceCount: vi.fn(),
    setSpliceSetting: vi.fn(),
    setBus: vi.fn(),
    setMode: vi.fn(),
    addSplice: vi.fn(),
    setSpliceAt: vi.fn(),
    removeSplice: vi.fn(),
  }) as unknown as TriggerLab;

const renderInspector = (overrides: Partial<GraphNode> = {}) =>
  render(SpliceNodeInspector, { props: { store: stubStore(), node: spliceNode(overrides) } });

describe('SpliceNodeInspector movement language', () => {
  it('uses the movement headings and accessible chase names for a hoop partition', () => {
    const { container, getByLabelText, getAllByText } = renderInspector();

    expect(getAllByText('MOVE THROUGH')).toHaveLength(2);
    expect(container.textContent).toContain('MOVE THROUGH MODE');
    expect(container.textContent).toContain('HOOP CHASE');
    expect(container.textContent).toContain('DRUM CHASE');
    expect(container.textContent).toContain('COLOUR CHASE');
    expect(container.textContent).not.toMatch(/offset|Before its turn|Direction/);

    expect(getByLabelText('Splice move through')).toBeTruthy();
    expect(getByLabelText('Splice move through mode')).toBeTruthy();
    expect(getByLabelText('Hoop chase mode')).toBeTruthy();
    expect(getByLabelText('Hoop chase milliseconds')).toBeTruthy();
    expect(getByLabelText('Drum chase mode')).toBeTruthy();
    expect(getByLabelText('Colour chase mode')).toBeTruthy();
  });

  it('names the primary axis DRUM CHASE and hides the secondary drum chase for drum cuts', () => {
    const { container, getByLabelText, queryByLabelText } = renderInspector({ splicePartition: 'drum' });

    expect(container.textContent).toContain('DRUM CHASE');
    expect(container.textContent).not.toContain('HOOP CHASE');
    expect(getByLabelText('Drum chase mode')).toBeTruthy();
    expect(queryByLabelText('Hoop chase mode')).toBeNull();
  });
});

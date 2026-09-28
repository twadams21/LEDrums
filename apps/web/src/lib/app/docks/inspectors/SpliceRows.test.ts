// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createEvent, fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { GraphNode } from '../../../trigger-lab/sim';
import type { TriggerLab } from '../../../trigger-lab/store.svelte';
import { makeNode } from '../../../trigger-lab/sim';
import SpliceRows from './SpliceRows.svelte';

/* The grip on each Splice / Slice row: drag it, or ↑ / ↓ on it, to reorder. The move itself is
   pinned in store.splice-order.test.ts; here, that the gestures ask for the right move. */

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});

const COLOURS = ['#ff0000', '#00ff00', '#0000ff'];
const node = (count = 3): GraphNode =>
  makeNode('splice', 's', 0, 0, { splices: COLOURS.slice(0, count).map((color) => ({ color })), spliceCount: count });
const stub = () =>
  ({ effects: [], moveSplice: vi.fn(), setSpliceAt: vi.fn(), addSplice: vi.fn(), removeSplice: vi.fn(), setSpliceSetting: vi.fn() }) as unknown as TriggerLab;

describe('SpliceRows — reordering', () => {
  it('↑ / ↓ on a grip moves that row one place, and focus follows it', async () => {
    const store = stub();
    const { getByLabelText } = render(SpliceRows, { props: { store, node: node() } });
    const second = getByLabelText(/Move splice 2/);
    await fireEvent.keyDown(second, { key: 'ArrowDown' });
    expect(store.moveSplice).toHaveBeenCalledWith(expect.anything(), 1, 3);
    await tick();
    expect(document.activeElement?.getAttribute('data-grip')).toBe('2');
    await fireEvent.keyDown(getByLabelText(/Move splice 1/), { key: 'ArrowUp' });
    expect(store.moveSplice).toHaveBeenCalledTimes(1); // the first row can't go higher
  });

  it('dropping a dragged row asks for the gap under the pointer', async () => {
    const store = stub();
    const { getByLabelText, container } = render(SpliceRows, { props: { store, node: node() } });
    const items = container.querySelectorAll('ul.rows > li');
    items.forEach((item, i) => {
      item.getBoundingClientRect = () => ({ top: i * 100, height: 80, bottom: i * 100 + 80, left: 0, right: 200, width: 200, x: 0, y: i * 100, toJSON() {} }) as DOMRect;
    });
    const data = new Map<string, string>();
    const dataTransfer = { setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? '', setDragImage() {}, effectAllowed: '', dropEffect: '' };
    await fireEvent.dragStart(getByLabelText(/Move splice 3/), { dataTransfer });
    const list = container.querySelector('ul.rows')!;
    // jsdom has no DragEvent, so the pointer position has to be put on the event by hand.
    const at = (type: 'dragOver' | 'drop', clientY: number) => {
      const event = createEvent[type](list, { dataTransfer });
      Object.defineProperty(event, 'clientY', { value: clientY });
      return fireEvent(list, event);
    };
    await at('dragOver', 10); // above the first row's middle
    await at('drop', 10);
    expect(store.moveSplice).toHaveBeenCalledWith(expect.anything(), 2, 0);
  });

  it('a lone row has no grip — there is nothing to reorder', () => {
    const { queryByLabelText } = render(SpliceRows, { props: { store: stub(), node: node(1) } });
    expect(queryByLabelText(/Move splice 1/)).toBeNull();
  });

  it('names the grip for a Slice too', () => {
    const { getByLabelText } = render(SpliceRows, { props: { store: stub(), node: node(), noun: 'Slice' } });
    expect(getByLabelText(/Move slice 2/)).toBeTruthy();
  });
});

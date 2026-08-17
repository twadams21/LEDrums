// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import AddNodePopover from './AddNodePopover.svelte';
import { ADD_NODE_TYPES } from './add-node-taxonomy';
import type { NodeKind } from '../../trigger-lab/sim';

function mount(at = { x: 40, y: 60 }, bounds = { w: 1000, h: 700 }) {
  const onAdd = vi.fn<(kind: NodeKind) => void>();
  const onClose = vi.fn();
  const view = render(AddNodePopover, { props: { at, bounds, onAdd, onClose } });
  return { onAdd, onClose, popover: screen.getByRole('group', { name: 'Add node palette' }), ...view };
}

/** The declared footprint the placement math uses: 264 wide, header + one row per type. */
const W = 264;
const H = 48 + ADD_NODE_TYPES.length * 32;

describe('AddNodePopover', () => {
  it('paints at the invoke point', () => {
    const { popover } = mount();
    expect(popover.style.left).toBe('40px');
    expect(popover.style.top).toBe('60px');
  });

  it('flips back from an invoke point near the far edges', () => {
    const { popover } = mount({ x: 900, y: 650 }, { w: 1000, h: 700 });
    expect(popover.style.left).toBe(`${900 - W}px`);
    expect(popover.style.top).toBe(`${650 - H}px`);
  });

  it('lists every node type as its own one-click row', () => {
    mount();
    for (const t of ADD_NODE_TYPES) {
      expect(screen.getByTitle(`Add ${t.label}`)).toBeTruthy();
    }
    expect(screen.queryByLabelText('Search nodes')).toBeNull();
  });

  it('adds on the first click and then dismisses itself', async () => {
    const { onAdd, onClose } = mount();
    await fireEvent.click(screen.getByTitle('Add Switch'));
    expect(onAdd).toHaveBeenCalledWith('switch');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('adds the family default for Modulate', async () => {
    const { onAdd } = mount();
    await fireEvent.click(screen.getByTitle('Add Modulate'));
    expect(onAdd).toHaveBeenCalledWith('envelope');
  });

  it('adds nothing for a read-only viewer', async () => {
    const onAdd = vi.fn();
    render(AddNodePopover, { props: { at: { x: 0, y: 0 }, bounds: { w: 900, h: 700 }, disabled: true, onAdd, onClose: vi.fn() } });
    await fireEvent.click(screen.getByTitle('Add Mix'));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('lands focus on the first row, then walks the list with the arrow keys', async () => {
    mount();
    await new Promise((r) => setTimeout(r, 0)); // the mount effect focuses row 0 on the next tick
    const first = screen.getByTitle('Add Effect');
    expect(document.activeElement).toBe(first);
    await fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByTitle('Add All'));
  });

  it('closes on Escape', async () => {
    const { onClose } = mount();
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves Escape alone while a modal dialog covers it', async () => {
    const { onClose } = mount();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.append(dialog);
    await fireEvent.keyDown(window, { key: 'Escape' });
    dialog.remove();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('says it is wiring, lists only what it was given, and drops drag-to-place (F8)', () => {
    const types = ADD_NODE_TYPES.filter((t) => t.kind === 'effect' || t.kind === 'modifier');
    render(AddNodePopover, {
      props: { at: { x: 0, y: 0 }, bounds: { w: 900, h: 700 }, types, wiring: true, onAdd: vi.fn(), onClose: vi.fn() },
    });

    expect(screen.getByText('Add & wire')).toBeTruthy();
    expect(screen.getByTitle('Add Effect')).toBeTruthy();
    expect(screen.queryByTitle('Add Mix')).toBeNull(); // filtered out by the pending wire
    // a drag would place a node the wire never reaches, so the rows stop being drag sources
    expect(screen.getByTitle('Add Effect').getAttribute('draggable')).toBe('false');
  });

  it('closes on an outside press but not on one inside itself', async () => {
    const { onClose, popover } = mount();
    await fireEvent.pointerDown(popover);
    expect(onClose).not.toHaveBeenCalled();
    await fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

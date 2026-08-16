// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import Circle from '@lucide/svelte/icons/circle';
import AddNodePopover from './AddNodePopover.svelte';
import type { AddGroup } from './AddPalette.svelte';

const groups: AddGroup[] = [
  { key: 'route', label: 'Route', icon: Circle, items: [{ id: 'switch', name: 'Switch', icon: Circle, hint: 'branch logic' }] },
];

function mount(at = { x: 40, y: 60 }, bounds = { w: 1000, h: 700 }) {
  const onAdd = vi.fn<(id: string, groupKey: string) => void>();
  const onClose = vi.fn();
  const view = render(AddNodePopover, { props: { at, bounds, groups, onAdd, onClose } });
  return { onAdd, onClose, popover: screen.getByRole('group', { name: 'Add node palette' }), ...view };
}

describe('AddNodePopover', () => {
  it('paints at the invoke point', () => {
    const { popover } = mount();
    expect(popover.style.left).toBe('40px');
    expect(popover.style.top).toBe('60px');
  });

  it('flips back from an invoke point near the far edges', () => {
    const { popover } = mount({ x: 900, y: 650 }, { w: 1000, h: 700 });
    expect(popover.style.left).toBe('600px'); // 900 − 300 wide
    // the canvas is tall enough (700 − 16 > 400) that the box keeps its full height.
    expect(popover.style.top).toBe('250px'); // 650 − 400 tall
  });

  it('closes on Escape', async () => {
    const { onClose } = mount();
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape raised from its own search field — nothing there to revert', async () => {
    const { onClose } = mount();
    await fireEvent.keyDown(screen.getByLabelText('Search nodes'), { key: 'Escape' });
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

  it('closes on an outside press but not on one inside itself', async () => {
    const { onClose, popover } = mount();
    await fireEvent.pointerDown(popover);
    expect(onClose).not.toHaveBeenCalled();
    await fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('adds through the palette and then dismisses itself', async () => {
    const { onAdd, onClose } = mount();
    await fireEvent.click(screen.getByRole('button', { name: /Route/ }));
    await fireEvent.click(screen.getByTitle('Add Switch'));
    expect(onAdd).toHaveBeenCalledWith('switch', 'route');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import Circle from '@lucide/svelte/icons/circle';
import AddPalette, { type AddGroup } from './AddPalette.svelte';
import { ADD_NODE_DRAG_TYPE, decodeAddDragPayload } from './add-pane';

const groups: AddGroup[] = [
  { key: 'effect', label: 'Effect', items: [{ id: 'waves', name: 'Waves', icon: Circle, hint: 'canvas texture' }] },
  { key: 'route', label: 'Route', items: [{ id: 'switch', name: 'Switch', icon: Circle, hint: 'branch logic' }] },
  { key: 'modulate', label: 'Modulate', items: [{ id: 'lfo', name: 'LFO', icon: Circle, hint: 'continuous wave' }] },
  { key: 'modify', label: 'Modify', items: [{ id: 'slice', name: 'Slice', icon: Circle, hint: 'pixel bands' }] },
];

function mount() {
  const onAdd = vi.fn<(id: string, groupKey: string) => void>();
  const view = render(AddPalette, { props: { groups, onAdd } });
  return { onAdd, ...view };
}

describe('AddPalette', () => {
  it('starts Stage 2 empty with a category prompt', () => {
    mount();
    expect(screen.getByText('Select a node category.')).toBeTruthy();
    expect(screen.queryByTitle('Add Waves')).toBeNull();
  });

  it('uses a temporary Stage 1 selection and resets on remount', async () => {
    const first = mount();
    await fireEvent.click(screen.getByRole('button', { name: /Effect/ }));
    expect(screen.getByTitle('Add Waves')).toBeTruthy();

    first.unmount();
    mount();
    expect(screen.getByText('Select a node category.')).toBeTruthy();
    expect(screen.queryByTitle('Add Waves')).toBeNull();
  });

  it('clicks a Stage 2 preview to add with its category key', async () => {
    const { onAdd } = mount();
    await fireEvent.click(screen.getByRole('button', { name: /Route/ }));
    await fireEvent.click(screen.getByTitle('Add Switch'));
    expect(onAdd).toHaveBeenCalledWith('switch', 'route');
  });

  it('starts a drag with a placement payload', async () => {
    mount();
    await fireEvent.click(screen.getByRole('button', { name: /Modify/ }));
    const preview = screen.getByTitle('Add Slice');
    const written = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: '',
      setData: vi.fn((type: string, value: string) => written.set(type, value)),
    };

    await fireEvent.dragStart(preview, { dataTransfer });

    expect(dataTransfer.setData).toHaveBeenCalledWith(ADD_NODE_DRAG_TYPE, expect.any(String));
    expect(decodeAddDragPayload(written.get(ADD_NODE_DRAG_TYPE) ?? '')).toEqual({
      id: 'slice',
      groupKey: 'modify',
    });
  });
});

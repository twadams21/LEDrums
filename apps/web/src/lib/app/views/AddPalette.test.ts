// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import Circle from '@lucide/svelte/icons/circle';
import AddPalette, { type AddGroup } from './AddPalette.svelte';
import { ADD_NODE_DRAG_TYPE, decodeAddDragPayload } from './add-pane';

const groups: AddGroup[] = [
  { key: 'effect', label: 'Effect', icon: Circle, tint: 'var(--role-content)', items: [{ id: 'waves', name: 'Waves', icon: Circle, hint: 'canvas texture' }] },
  { key: 'route', label: 'Route', items: [{ id: 'switch', name: 'Switch', icon: Circle, hint: 'branch logic' }] },
  { key: 'modulate', label: 'Modulate', items: [{ id: 'lfo', name: 'LFO', icon: Circle, hint: 'continuous wave' }] },
  { key: 'modify', label: 'Modify', items: [{ id: 'slice', name: 'Slice', icon: Circle, hint: 'pixel bands' }] },
  { key: 'future', label: 'Future', items: [{ id: 'mix', name: 'Mix', icon: Circle, disabled: true, disabledReason: 'later' }] },
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

  it('renders a node icon chip on a category tile that carries one', () => {
    mount();
    const tile = screen.getByRole('button', { name: /Effect/ });
    // The chip is an aria-hidden tinted glyph (NodeIconChip) — assert its svg is present.
    expect(tile.querySelector('svg')).toBeTruthy();
    // A category without a group icon (Route) shows no chip.
    const bare = screen.getByRole('button', { name: /Route/ });
    expect(bare.querySelector('svg')).toBeNull();
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

  it('filters across every category from the search field, not just the open one', async () => {
    mount();
    // Browse: no category open, so no previews are visible yet.
    expect(screen.queryByTitle('Add Switch')).toBeNull();
    const search = screen.getByLabelText('Search nodes');
    await fireEvent.input(search, { target: { value: 's' } });
    // "s" matches Waves, Switch, Slice across three different categories.
    expect(screen.getByTitle('Add Waves')).toBeTruthy();
    expect(screen.getByTitle('Add Switch')).toBeTruthy();
    expect(screen.getByTitle('Add Slice')).toBeTruthy();
    // Category tiles are hidden while a query is active.
    expect(screen.queryByRole('button', { name: /Effect/ })).toBeNull();
  });

  it('groups active-query results by category', async () => {
    mount();
    const search = screen.getByLabelText('Search nodes');
    await fireEvent.input(search, { target: { value: 's' } });
    expect(screen.getByRole('region', { name: 'Effect nodes' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Route nodes' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Modify nodes' })).toBeTruthy();
  });

  it('adds from a search result with the item\'s own category key', async () => {
    const { onAdd } = mount();
    const search = screen.getByLabelText('Search nodes');
    await fireEvent.input(search, { target: { value: 'switch' } });
    await fireEvent.click(screen.getByTitle('Add Switch'));
    expect(onAdd).toHaveBeenCalledWith('switch', 'route');
  });

  it('shows an empty message when nothing matches', async () => {
    mount();
    const search = screen.getByLabelText('Search nodes');
    await fireEvent.input(search, { target: { value: 'zzzz' } });
    expect(screen.getByText(/No nodes match/)).toBeTruthy();
  });

  it('restores the category browse when the query is cleared', async () => {
    mount();
    const search = screen.getByLabelText('Search nodes');
    await fireEvent.input(search, { target: { value: 'switch' } });
    expect(screen.queryByRole('button', { name: /Effect/ })).toBeNull();
    await fireEvent.input(search, { target: { value: '' } });
    // Category tiles + the Stage 2 prompt are back.
    expect(screen.getByRole('button', { name: /Effect/ })).toBeTruthy();
    expect(screen.getByText('Select a node category.')).toBeTruthy();
  });

  it('keeps unavailable previews visible but inert', async () => {
    const { onAdd } = mount();
    await fireEvent.click(screen.getByRole('button', { name: /Future/ }));
    const preview = screen.getByTitle('later');
    await fireEvent.click(preview);
    expect(onAdd).not.toHaveBeenCalled();
    expect(preview.hasAttribute('disabled')).toBe(true);
  });
});

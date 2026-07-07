import { describe, expect, it } from 'vitest';
import Circle from '@lucide/svelte/icons/circle';
import {
  addCategories,
  addDragPayload,
  decodeAddDragPayload,
  encodeAddDragPayload,
  selectedAddItems,
} from './add-pane';
import type { AddGroup } from './AddPalette.svelte';

const groups: AddGroup[] = [
  { key: 'effect', label: 'Effect', items: [{ id: 'waves', name: 'Waves', icon: Circle }] },
  {
    key: 'route',
    label: 'Route',
    items: [
      { id: 'switch', name: 'Switch', icon: Circle },
      { id: 'delay', name: 'Delay', icon: Circle },
    ],
  },
];

describe('add pane helpers', () => {
  it('derives compact Stage 1 categories from groups', () => {
    expect(addCategories(groups)).toEqual([
      { key: 'effect', label: 'Effect', count: 1 },
      { key: 'route', label: 'Route', count: 2 },
    ]);
  });

  it('keeps Stage 2 empty until a category is selected', () => {
    expect(selectedAddItems(groups, null)).toEqual([]);
    expect(selectedAddItems(groups, 'route').map((i) => i.id)).toEqual(['switch', 'delay']);
  });

  it('round-trips the drag placement payload', () => {
    expect(addDragPayload('switch', 'route')).toEqual({ id: 'switch', groupKey: 'route' });
    expect(decodeAddDragPayload(encodeAddDragPayload('switch', 'route'))).toEqual({
      id: 'switch',
      groupKey: 'route',
    });
    expect(decodeAddDragPayload('{')).toBeNull();
  });
});

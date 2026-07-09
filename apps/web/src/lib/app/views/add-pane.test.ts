import { describe, expect, it } from 'vitest';
import Circle from '@lucide/svelte/icons/circle';
import {
  addCategories,
  addDragPayload,
  decodeAddDragPayload,
  encodeAddDragPayload,
  filterAddGroups,
  selectedAddItems,
} from './add-pane';
import type { AddGroup } from './AddPalette.svelte';

const groups: AddGroup[] = [
  { key: 'effect', label: 'Effect', items: [{ id: 'waves', name: 'Waves', icon: Circle, hint: 'ripple texture' }] },
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

  it('carries a group icon and tint onto its category (node visual language)', () => {
    const withChip = [{ key: 'effect', label: 'Effect', icon: Circle, tint: 'var(--role-content)', items: groups[0]!.items }];
    const [cat] = addCategories(withChip);
    expect(cat?.icon).toBe(Circle);
    expect(cat?.tint).toBe('var(--role-content)');
  });

  it('keeps Stage 2 empty until a category is selected', () => {
    expect(selectedAddItems(groups, null)).toEqual([]);
    expect(selectedAddItems(groups, 'route').map((i) => i.id)).toEqual(['switch', 'delay']);
  });

  it('filters across every category, grouped and in order', () => {
    // "a" matches Waves, Delay (name) — both groups survive, empties dropped.
    const result = filterAddGroups(groups, 'a');
    expect(result.map((g) => g.key)).toEqual(['effect', 'route']);
    expect(result.flatMap((g) => g.items.map((i) => i.id))).toEqual(['waves', 'delay']);
  });

  it('matches on hint text, not just name', () => {
    const result = filterAddGroups(groups, 'ripple');
    expect(result.map((g) => g.key)).toEqual(['effect']);
    expect(result[0]?.items.map((i) => i.id)).toEqual(['waves']);
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(filterAddGroups(groups, '  SWITCH ').flatMap((g) => g.items.map((i) => i.id))).toEqual([
      'switch',
    ]);
  });

  it('returns [] for a blank query so the caller falls back to browse', () => {
    expect(filterAddGroups(groups, '')).toEqual([]);
    expect(filterAddGroups(groups, '   ')).toEqual([]);
  });

  it('returns [] when nothing matches', () => {
    expect(filterAddGroups(groups, 'zzz')).toEqual([]);
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

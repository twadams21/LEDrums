import type { AddGroup, AddItem } from './AddPalette.svelte';

export type AddCategory = {
  key: string;
  label: string;
  count: number;
};

export type AddDragPayload = {
  id: string;
  groupKey: string;
};

export const ADD_NODE_DRAG_TYPE = 'application/x-ledrums-add-node';

export function addCategories(groups: readonly AddGroup[]): AddCategory[] {
  return groups.map((g) => ({ key: g.key, label: g.label, count: g.items.length }));
}

export function selectedAddItems(groups: readonly AddGroup[], selectedKey: string | null): readonly AddItem[] {
  return groups.find((g) => g.key === selectedKey)?.items ?? [];
}

function itemMatchesQuery(item: AddItem, needle: string): boolean {
  return (
    item.name.toLowerCase().includes(needle) ||
    (item.hint?.toLowerCase().includes(needle) ?? false)
  );
}

/**
 * Filter the whole node vocabulary by a search query. Returns groups (in their
 * original order) carrying only the items whose name or hint matches, with
 * empty groups dropped — so an active query renders a flat list still grouped
 * by category. A blank query returns [] (the caller falls back to browse).
 */
export function filterAddGroups(groups: readonly AddGroup[], query: string): AddGroup[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const out: AddGroup[] = [];
  for (const g of groups) {
    const items = g.items.filter((it) => itemMatchesQuery(it, needle));
    if (items.length > 0) out.push({ ...g, items });
  }
  return out;
}

export function addDragPayload(id: string, groupKey: string): AddDragPayload {
  return { id, groupKey };
}

export function encodeAddDragPayload(id: string, groupKey: string): string {
  return JSON.stringify(addDragPayload(id, groupKey));
}

export function decodeAddDragPayload(text: string): AddDragPayload | null {
  try {
    const raw: unknown = JSON.parse(text);
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Partial<AddDragPayload>;
    return typeof r.id === 'string' && typeof r.groupKey === 'string'
      ? { id: r.id, groupKey: r.groupKey }
      : null;
  } catch {
    return null;
  }
}

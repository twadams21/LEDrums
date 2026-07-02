/**
 * Palette grouping — the registry projected into category buckets for the graph palette's
 * "add a modifier" section (S32). Purely derived from {@link listModifiers}, so every modifier
 * a slice registers appears automatically, in a stable category order, with no hardcoded id
 * list. Empty categories are dropped. UI-facing labels live here (core owns the category
 * vocabulary); the web palette renders these groups + a category filter over them.
 */
import type { ModifierCategory, ModifierDef } from './types';
import { listModifiers } from './registry';

/** Stable display order for category grouping / filter chips. */
export const MODIFIER_CATEGORY_ORDER: readonly ModifierCategory[] = ['temporal', 'spatial', 'texture', 'color'];

/** Human label per category (chip + group header). */
export const MODIFIER_CATEGORY_LABEL: Record<ModifierCategory, string> = {
  temporal: 'Temporal',
  spatial: 'Spatial',
  texture: 'Texture',
  color: 'Color',
};

export interface ModifierCategoryGroup {
  category: ModifierCategory;
  label: string;
  modifiers: ModifierDef[];
}

/**
 * Every registered modifier grouped by category, in {@link MODIFIER_CATEGORY_ORDER}. Dynamic
 * over the registry — a newly-registered modifier shows up with no edit here. Categories with
 * no modifiers are omitted so the palette never renders an empty group.
 */
export function listModifiersByCategory(): ModifierCategoryGroup[] {
  const all = listModifiers();
  const groups: ModifierCategoryGroup[] = [];
  for (const category of MODIFIER_CATEGORY_ORDER) {
    const modifiers = all.filter((m) => m.category === category);
    if (modifiers.length) groups.push({ category, label: MODIFIER_CATEGORY_LABEL[category], modifiers });
  }
  return groups;
}

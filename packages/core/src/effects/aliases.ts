/*
 * Effect alias map (D1, locked decision 1: retired effects are hidden-but-aliased
 * FOREVER, never hard-deleted). A show that references a retired effect id keeps
 * working: the consult points (show hydrate + `setShow`, in both the sim and the
 * show-builder) rewrite every play node's `effectId` through this map before the
 * engine resolves it. Aliased (old) ids never appear in the gallery.
 *
 * U1 builds the mechanism + wires the consult points; U3 populates the map as it
 * retires/merges effects. An empty map is the correct U1 state — `resolveEffectAlias`
 * is an identity function until U3 fills it in.
 *
 * Pure core module: no Node/DOM/IO.
 */

/** `Record<oldId, newId>`. Chains are resolved transitively by {@link resolveEffectAlias}. */
export const EFFECT_ALIASES: Readonly<Record<string, string>> = {
  // Populated by U3 as effects are retired/merged, e.g.
  //   'chase': 'chase-bands',
};

/**
 * Resolve an effect id through the alias map, following chains (A→B→C) to the final
 * target. Cycle-guarded (returns the last id reached if a cycle is ever authored).
 * Unknown / unaliased ids pass through unchanged, so this is safe to call on every id.
 */
export function resolveEffectAlias(id: string): string {
  let current = id;
  const seen = new Set<string>();
  while (Object.prototype.hasOwnProperty.call(EFFECT_ALIASES, current)) {
    if (seen.has(current)) break; // defensive: never loop on a mis-authored cycle
    seen.add(current);
    current = EFFECT_ALIASES[current]!;
  }
  return current;
}

/** True if `id` is a retired alias (should be hidden from the gallery). */
export function isAliasedEffectId(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(EFFECT_ALIASES, id);
}

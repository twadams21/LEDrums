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

/**
 * `Record<oldId, newId>`. Chains are resolved transitively by {@link resolveEffectAlias}.
 *
 * NOTE ON NAMESPACE: the consult points (web hydrate + `buildShow`) rewrite the `effectId`
 * a graph node carries, and those ids are the LAB's `EffectDef` ids — generator-backed
 * effects are `gen:<coreId>`, the retired hand-rolled pattern effects are their bare lab
 * ids (`swirl`, `whole`, …). So every key/value below is a lab effect id, NOT a bare core
 * generator id. (U3 retires the whole pattern path onto generators; the pattern effects'
 * lab ids therefore alias to `gen:<target>`.)
 */
export const EFFECT_ALIASES: Readonly<Record<string, string>> = {
  // --- Retired generators (kept in the registry but `deprecated`, hidden from the gallery) --
  'gen:chase': 'gen:chase-bands', // old beat-indexed arpeggiator → emission-based bands
  'gen:burst': 'gen:radial-wash', // merge: burst's per-hit pop = a short-life radial-wash preset
  'gen:colour-melody': 'gen:whole-drum', // merge: note→hue folds into whole-drum's `noteHue`

  // --- Retired hand-rolled pattern effects → their generator equivalents (D2) ------------
  swirl: 'gen:helix',
  aurora: 'gen:perlin-clouds',
  drift: 'gen:temp-sweep',
  chase: 'gen:chase-bands',
  whole: 'gen:whole-drum', // pattern 'flash'
  sparkle: 'gen:pixel-accum',
  rip: 'gen:ripple-3d', // pattern 'ripple'
  wash: 'gen:radial-wash', // pattern 'radial'
  strobe: 'gen:strobe',
  haze: 'gen:lava-lamp',
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

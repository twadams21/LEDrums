/*
 * Param families — the pure grouping behind the effect inspector's progressive disclosure
 * (S4, option 4).
 *
 * The rule that makes this safe: a family decides only WHERE a param is rendered, never HOW.
 * Every param is still rendered under its own declared key, with its own declared control,
 * range and unit — we never assume `hue`, never rename `lifeBeats` to `decayMs`, and never
 * synthesise a param an effect did not declare. Key normalisation in core is S7's job; this
 * module is deliberately the UI-side workaround that degrades correctly without it.
 *
 * The hard invariant, asserted in `param-families.test.ts` across the whole registry:
 *
 *     common ∪ specific === the declared param set, exactly, with no duplicates.
 *
 * Pure module: no Svelte, no DOM, no store access.
 */

/**
 * The only two fields grouping reads. Deliberately structural so this works unchanged on
 * BOTH param-spec shapes in the tree — core's `ParamSpec` (`type`) and the web-side mapped
 * `ParamSpec` (`kind`) the inspector actually renders — and so the completeness assertion
 * can be run against either.
 */
export interface ParamLike {
  key: string;
  label: string;
}

/** The four recurrent concepts that earn a slot in the always-visible common section. */
export type ParamFamily = 'colour' | 'life' | 'speed' | 'level';

/** Display order of the common section. Colour first (it is what you reach for), then the
    time family, then motion, then the level trims. */
export const FAMILY_ORDER: readonly ParamFamily[] = ['colour', 'life', 'speed', 'level'];

export const FAMILY_LABEL: Readonly<Record<ParamFamily, string>> = {
  colour: 'Colour',
  life: 'Time',
  speed: 'Motion',
  level: 'Level',
};

/*
 * Family membership is matched on the DECLARED key, by pattern where a concept is spelled
 * several ways across the 45 generators and by exact key where it is not. Patterns are
 * deliberately tight: a key that matches nothing falls through to the effect-specific fold,
 * which is always a safe home. Over-matching is the only way this can mislead, so anything
 * genuinely ambiguous (`palette`, `amp`, `duckDepth`, `recoverMs`, `delayMs`) is left out on
 * purpose and lands in the fold.
 */

/** Any hue spelling: hue, baseHue, hueSpread, hueSpan, hueOffset, hueDrift, hueShift,
    hueRange, hueJitter, warmHue, coolHue, flashHue, tipHue, hogHue, haloHue, noteHue. */
const COLOUR_PATTERN = /hue/i;
const COLOUR_KEYS = new Set(['saturation', 'brightness']);

/** The decay/life family, in all four spellings the library actually uses (plus sidechain's
    `baseDecayMs`, which is the same concept with a scope prefix). */
const LIFE_PATTERN = /^(base)?(decay|life)(ms|beats)?$/i;

/** Shared "how fast" gesture — `speed`, `fallSpeed`, `rate`. Units diverge (°/s, mm/ms,
    rev/beat), which is exactly why each one keeps its own declared control and unit. */
const SPEED_PATTERN = /^(\w*[Ss]peed|rate)$/;

/** Output trim that is not brightness. */
const LEVEL_KEYS = new Set(['level', 'gain', 'intensity']);

/** The family a declared key belongs to, or `null` for an effect-specific param. */
export function familyOf(key: string): ParamFamily | null {
  if (COLOUR_KEYS.has(key) || COLOUR_PATTERN.test(key)) return 'colour';
  if (LIFE_PATTERN.test(key)) return 'life';
  if (SPEED_PATTERN.test(key)) return 'speed';
  if (LEVEL_KEYS.has(key)) return 'level';
  return null;
}

export interface FamilyGroup<T extends ParamLike = ParamLike> {
  family: ParamFamily;
  label: string;
  /** Declared specs, in the order the generator declared them. */
  params: T[];
}

export interface ParamGrouping<T extends ParamLike = ParamLike> {
  /** Non-empty families only, in `FAMILY_ORDER`. */
  common: FamilyGroup<T>[];
  /** Everything that matched no family, in declaration order. */
  specific: T[];
  /** `common` flattened — convenient for counts and the completeness assertion. */
  commonParams: T[];
}

/**
 * Split a generator's declared `paramSpec` into the common section and the effect-specific
 * fold. Total and order-preserving: every input spec appears exactly once in the output.
 */
export function groupParams<T extends ParamLike>(spec: readonly T[]): ParamGrouping<T> {
  const byFamily = new Map<ParamFamily, T[]>();
  const specific: T[] = [];

  for (const p of spec) {
    const family = familyOf(p.key);
    if (family === null) {
      specific.push(p);
      continue;
    }
    const bucket = byFamily.get(family);
    if (bucket) bucket.push(p);
    else byFamily.set(family, [p]);
  }

  const common: FamilyGroup<T>[] = [];
  for (const family of FAMILY_ORDER) {
    const params = byFamily.get(family);
    if (params?.length) common.push({ family, label: FAMILY_LABEL[family], params });
  }

  return { common, specific, commonParams: common.flatMap((g) => g.params) };
}

/** Filter-box match — label OR declared key, case-insensitive substring. An empty query
    matches everything, so the filter never hides a param you did not ask it to. */
export function matchesParamFilter(p: ParamLike, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return p.label.toLowerCase().includes(q) || p.key.toLowerCase().includes(q);
}

/** `groupParams` with the filter applied to both sections. Families that filter down to
    nothing are dropped; the fold is kept even when empty so its count reads `0`. */
export function groupParamsFiltered<T extends ParamLike>(spec: readonly T[], query: string): ParamGrouping<T> {
  const q = query.trim();
  if (!q) return groupParams(spec);
  return groupParams(spec.filter((p) => matchesParamFilter(p, q)));
}

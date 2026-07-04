/*
 * Controlled effect vocabulary — the ONE source of truth for effect tags and the
 * user-facing collections derived from them. Tags are DATA the gallery filters on;
 * nothing in the render path may branch on them. The collection derivation here is
 * the SAME taxonomy the typed play nodes (D3) consume, so the gallery's grouping and
 * the play-node types can never drift.
 *
 * Pure core module: no Node/DOM/IO. Unit-tested.
 */

/** The controlled tag vocabulary (D1). Effects tag themselves from this set only. */
export const EFFECT_TAGS = [
  // Reactivity — how the effect responds to input
  'hit', // per-hit emission / hit-driven
  'ambient', // free-running, always-on
  'meter', // level-driven (volume / velocity mapped to a readout)
  'beat-synced', // animates against transport beat
  // Space — where it lives in the 3D kit
  '3d', // world-space aware
  'per-drum', // scoped to the struck drum
  'kit-wide', // spans the whole kit
  'hoop-aware', // reads hoop structure (levels / index)
  'airspace', // uses the gaps between the drums
  // Look — what it reads as
  'band', // moving stripe / bands
  'wave', // travelling wavefront / ripple
  'particle', // discrete moving points
  'texture', // continuous 2D field wrapped on geometry
  'wash', // smooth full-surface colour
  'strobe', // hard on/off flashing
  'sparkle', // scattered twinkle
  // Engine — how it's built
  'emission', // emission-based multiplicity (layers per hit)
  'canvas', // canvas-scene backed (D4)
  'lens', // coordinate-transform lens preset (D5)
  'stateful', // carries per-clip mutable state
  'seeded', // deterministic RNG from a per-trigger seed
] as const;

export type EffectTag = (typeof EFFECT_TAGS)[number];

const TAG_SET: ReadonlySet<string> = new Set(EFFECT_TAGS);

/** True if `tag` is a member of the controlled vocabulary. */
export function isEffectTag(tag: string): tag is EffectTag {
  return TAG_SET.has(tag);
}

/**
 * The user-facing collections. Exactly the taxonomy the typed play nodes (D3) use —
 * a `PlayType` and a `Collection` are the same seven buckets under two names.
 */
export type PlayType = 'hits' | 'waves' | 'particles' | 'textures' | 'ambient' | 'meters' | 'canvas';

export interface Collection {
  type: PlayType;
  /** Gallery tab / palette label. */
  label: string;
  /** One-line shelf blurb. */
  blurb: string;
}

/** Display order for the gallery collection rail + the typed-play palette. */
export const COLLECTIONS: readonly Collection[] = [
  { type: 'hits', label: 'Hits', blurb: 'Per-strike events on the drum you play.' },
  { type: 'waves', label: 'Waves & Ripples', blurb: 'Wavefronts and bands travelling across the kit.' },
  { type: 'particles', label: 'Particles & Air', blurb: 'Discrete points moving through the kit and the air around it.' },
  { type: 'textures', label: 'Textures', blurb: 'Continuous 2D fields wrapped onto the drum surfaces.' },
  { type: 'ambient', label: 'Ambient & Base', blurb: 'Always-on backdrops and slow washes.' },
  { type: 'meters', label: 'Meters & Utility', blurb: 'Level readouts and mix-shaping utilities.' },
  { type: 'canvas', label: 'Canvas', blurb: 'Authored 2D scenes sampled through the kit geometry.' },
];

const COLLECTION_BY_TYPE = new Map(COLLECTIONS.map((c) => [c.type, c] as const));

export function collectionMeta(type: PlayType): Collection {
  return COLLECTION_BY_TYPE.get(type)!;
}

/**
 * Priority-ordered tag → collection rules. `collectionOf` walks this list in order and
 * returns the FIRST rule whose tag the effect carries (specific looks beat general ones),
 * so an effect belongs to exactly one collection regardless of the order it lists its tags.
 */
const COLLECTION_RULES: readonly { tag: EffectTag; type: PlayType }[] = [
  { tag: 'canvas', type: 'canvas' },
  { tag: 'meter', type: 'meters' },
  { tag: 'particle', type: 'particles' },
  { tag: 'texture', type: 'textures' },
  { tag: 'wave', type: 'waves' },
  { tag: 'band', type: 'hits' },
  { tag: 'hit', type: 'hits' },
  { tag: 'strobe', type: 'hits' },
  { tag: 'sparkle', type: 'particles' },
  { tag: 'wash', type: 'ambient' },
  { tag: 'ambient', type: 'ambient' },
];

/** The collection an effect belongs to, derived from its tags (total — falls back to
    `ambient` for an untagged effect so the mapping is never undefined). */
export function collectionOf(tags: readonly string[] | undefined): PlayType {
  if (tags && tags.length) {
    for (const rule of COLLECTION_RULES) {
      if (tags.includes(rule.tag)) return rule.type;
    }
  }
  return 'ambient';
}

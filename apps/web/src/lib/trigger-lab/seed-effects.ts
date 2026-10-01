/* The effect-chains seed: the content a fresh v3 show starts from (spec S05 §1). PURE (no runes /
   DOM), the v3 twin of `store/seed.ts`. The demo section is agent-chosen, per the slice
   suggestion:
     - Kick, zone 0: a Solid › Simple hit;
     - Snare, zone 0: a Wave › Radial hit through a Strobe modifier;
     - Kit, Always: a Gradient › Rainbow bed at low opacity.
   Every Effect is built through core's `effectChain.parseEffect`, so the seed carries the
   schema's defaults and can never drift out of the authored model. Ids are fixed (like the v2
   seed's `set-1` / `intro`): a seed is one show's content, and ids only need to be unique within
   a section. */

import { effectChain } from '@ledrums/core';
import type { AuthoredStateV3, EffectSection } from './persistence';

export const SEED_SONG_ID = 'set-1';
export const SEED_SECTION_ID = 'intro';
export const SEED_KICK_EFFECT_ID = 'fx-seed-kick';

/** The demo section, freshly built on every call (callers may mutate it). */
export function seedEffectSection(): EffectSection {
  const effects = [
    effectChain.parseEffect({
      id: SEED_KICK_EFFECT_ID,
      name: 'Kick hit',
      cell: { row: 'kick', column: { kind: 'zone', slot: 0 } },
      generator: { kind: 'solid', style: 'simple' },
    }),
    effectChain.parseEffect({
      id: 'fx-seed-snare',
      name: 'Snare ripple',
      cell: { row: 'snare', column: { kind: 'zone', slot: 0 } },
      generator: { kind: 'wave', style: 'radial' },
      modifiers: [{ uid: 'mod-seed-strobe', modifierId: 'strobe' }],
    }),
    effectChain.parseEffect({
      id: 'fx-seed-bed',
      name: 'Rainbow bed',
      cell: { row: effectChain.KIT_ROW, column: { kind: 'always' } },
      generator: { kind: 'gradient', style: 'rainbow' },
      opacity: 0.25,
    }),
  ];
  return { id: SEED_SECTION_ID, name: 'Intro', effects, master: [] };
}

/** A fresh v3 show's authored content: one song holding the demo section, the kick cell selected. */
export function seedAuthoredV3(): AuthoredStateV3 {
  return {
    songs: [{ id: SEED_SONG_ID, name: 'Set 1', sections: [seedEffectSection()] }],
    songRefs: [],
    canvasScenes: [],
    selectedCell: { row: 'kick', column: { kind: 'zone', slot: 0 } },
    selectedEffectId: SEED_KICK_EFFECT_ID,
    activeSongId: SEED_SONG_ID,
    activeSectionId: SEED_SECTION_ID,
    bpm: 120,
    velocity: 0.85,
    beatsPerBar: 4,
    paneSizes: {},
    patchLabels: {},
  };
}

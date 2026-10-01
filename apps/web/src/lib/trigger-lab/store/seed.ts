/* Blank-document seed — the clean-slate content a fresh/new show starts from, and the reset
   target when SWITCHING shows. PURE (no runes/DOM), like setlist.ts. */

import type { AuthoredStateV3 } from '../persistence';
import { SEED_SONG_ID, seedAuthoredV3, seedEffectSection } from '../seed-effects';

/** The seed song's sections, in order. The demo Effects land in the one `seedEffectSection` names. */
const SEED_SECTIONS: readonly { id: string; name: string }[] = [
  { id: 'intro', name: 'Intro' },
  { id: 'verse', name: 'Verse' },
  { id: 'chorus', name: 'Chorus' },
];

/**
 * A fresh v3 show's authored content: the effect-chains seed (`seed-effects.ts`) with the demo
 * Effects in the Intro section, followed by the other seed sections (Verse, Chorus) empty
 * (agent-chosen, S05 §1).
 */
export function seedDocumentV3(): AuthoredStateV3 {
  const seed = seedAuthoredV3();
  const demo = seedEffectSection();
  const sections = SEED_SECTIONS.map((s) => (s.id === demo.id ? demo : { id: s.id, name: s.name, effects: [], master: [] }));
  if (!sections.some((s) => s.id === demo.id)) sections.unshift(demo);
  return { ...seed, songs: seed.songs.map((song) => (song.id === SEED_SONG_ID ? { ...song, sections } : song)) };
}

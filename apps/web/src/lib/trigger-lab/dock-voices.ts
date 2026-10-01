// Layers dock voice source-selection (S17).
//
// The dock shows one chip per sounding voice. There are two possible sources, and exactly one is
// authoritative at any moment (the authority principle from doc 03 / S12):
//   - OFFLINE (link not open): the local Sim's core engine resolves + renders, so its voices are the
//     truth.
//   - CONNECTED (link open): the server engine is the sole resolver/renderer and streams its voices
//     back; the Sim no longer fires. The server's voices win.
//
// Both sources speak the same wire `VoiceStat` shape (the Sim's engine is the server's class). This
// module is the pure seam between them: it normalizes a `VoiceStat` into the `DockVoice` view model
// and picks the right source from the link state — no Svelte, no store, so it unit-tests directly.

import type { VoiceStat } from '@ledrums/protocol';
import type { voice } from '@ledrums/core';

/** The minimal per-voice shape the Layers dock draws — everything a chip needs and nothing the
 * source-of-truth (Sim vs server) leaks in. */
export interface DockVoice {
  /** Stable identity — the dock keys chips on it. */
  id: string;
  busId: string;
  effectId: string;
  mode: voice.PlayMode;
  /** Combined `level * deckGain`, 0..1 — the chip brightness. */
  level: number;
  /** Param hue for the chip colour (0 when the effect exposes none). */
  hue: number;
  /** True while the voice is fading out (release phase) — the chip dims. */
  releasing: boolean;
  /** Provenance label — the chip label / tooltip (`Effect: <name>` on the Effect path). */
  via: string;
}

/** Normalize a voice-stat into the dock view model. The engine already folds `level * deckGain`
 * and resolves the hue, so this is a straight adopt. */
export function voiceStatToDockVoice(v: VoiceStat): DockVoice {
  return {
    id: v.id,
    busId: v.busId,
    effectId: v.effectId,
    mode: v.mode,
    level: v.level,
    hue: v.hue,
    releasing: v.releasing,
    via: v.via,
  };
}

/** Pick the authoritative voice source for the dock: the server's voices when the engine link is
 * open, the offline Sim's otherwise. The unused source is ignored entirely. */
export function selectDockVoices(args: {
  /** `store.link === 'open'` — the same firing/authority gate the whole slice family uses. */
  connected: boolean;
  simVoices: readonly VoiceStat[];
  serverVoices: readonly VoiceStat[];
}): DockVoice[] {
  return (args.connected ? args.serverVoices : args.simVoices).map(voiceStatToDockVoice);
}

// Layers/Buses dock voice source (S17).
//
// The dock shows one chip per sounding voice. There is exactly ONE source of voices — the server
// engine, which is the sole resolver/renderer and streams its voice list back (the authority
// principle from doc 03 / S12; INIT-01 Decision 3 retired the browser-side sim that used to be
// the offline second source). With the link down there are no voices, and the dock shows an
// honest empty state rather than a stale list.
//
// This module is the pure seam: it normalizes a wire `VoiceStat` into the `DockVoice` view model
// and gates on the link state — no Svelte, no store, so it unit-tests directly.

import type { VoiceStat } from '@ledrums/protocol';
import type { voice } from '@ledrums/core';

/** The minimal per-voice shape the Layers/Buses dock draws — everything a chip needs and nothing
 * of the wire shape it came from. */
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
  /** Provenance label — the chip tooltip. */
  via: string;
}

/** Normalize a server-streamed voice-stat into the dock view model. The server already folds
 * `level * deckGain` and resolves the hue, so this is a straight adopt. */
export function serverVoiceToDockVoice(v: VoiceStat): DockVoice {
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

/** The dock's voice list: the engine's streamed voices while the link is open, and NOTHING while
 * it is closed — a disconnected editor has no voices, and showing the last ones it saw would be a
 * frozen lie. Kept as a named seam (rather than inlined in the store) so the authority rule stays
 * one testable line. */
export function selectDockVoices(args: {
  /** `store.link === 'open'` — the same firing/authority gate the whole slice family uses. */
  connected: boolean;
  serverVoices: readonly VoiceStat[];
}): DockVoice[] {
  return args.connected ? args.serverVoices.map(serverVoiceToDockVoice) : [];
}

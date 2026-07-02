// Layers/Buses dock voice source-selection (S17).
//
// The dock shows one chip per sounding voice. There are two possible sources, and exactly one is
// authoritative at any moment (the authority principle from doc 03 / S12):
//   - OFFLINE (link not open): the local sim resolves + renders, so its voices are the truth.
//   - CONNECTED (link open): the server engine is the sole resolver/renderer and streams its voices
//     back; the sim no longer fires, so its voice list is stale/empty. The server's voices win.
//
// This module is the pure seam between those sources: it normalizes both a sim `Voice` and a wire
// `VoiceStat` into one `DockVoice` view model and picks the right source from the link state — no
// Svelte, no store, so it unit-tests directly. The dock renders `DockVoice` and never has to know
// which side it came from, so the dock and the visualiser can no longer disagree.

import type { VoiceStat } from '@ledrums/protocol';
import type { voice } from '@ledrums/core';
import type { Voice } from './sim';

/** The minimal per-voice shape the Layers/Buses dock draws — everything a chip needs and nothing
 * the source-of-truth (sim vs server) leaks in. Both sources normalize into this. */
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

/** Normalize an offline sim voice into the dock view model (mirrors what the dock used to read off
 * `Voice` directly). */
export function simVoiceToDockVoice(v: Voice): DockVoice {
  return {
    id: v.id,
    busId: v.busId,
    effectId: v.effectId,
    mode: v.mode,
    level: v.level * v.deckGain,
    hue: typeof v.params.hue === 'number' ? v.params.hue : 0,
    releasing: v.phase === 'release',
    via: v.via,
  };
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

/** Pick the authoritative voice source for the dock: the server's voices when the engine link is
 * open, the local sim's voices otherwise. The unused source is ignored entirely — a connected dock
 * shows a server-spawned voice even while the sim holds none, and never shows a stale sim voice. */
export function selectDockVoices(args: {
  /** `store.link === 'open'` — the same firing/authority gate the whole slice family uses. */
  connected: boolean;
  simVoices: readonly Voice[];
  serverVoices: readonly VoiceStat[];
}): DockVoice[] {
  return args.connected
    ? args.serverVoices.map(serverVoiceToDockVoice)
    : args.simVoices.map(simVoiceToDockVoice);
}

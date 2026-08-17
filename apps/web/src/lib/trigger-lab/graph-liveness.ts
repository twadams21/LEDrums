// Which graphs are currently PLAYING — the "now playing" attribution behind the graph rail's
// sustained marker.
//
// The rail already ticks a 150ms marker on every fire (`store.graphFireAt`), which answers "what
// just got hit". This answers the other question: while lights are on the kit, which graph is
// holding them there. Voices carry that attribution as `pad` (the eval state prefix), so liveness
// is a pure fold over the authoritative voice list — no timers, no store state to keep in sync
// with the engine.
//
// Read it off `dockVoices` (the raw authoritative list), never `dockVoicesDisplay`: the display
// list is exponentially smoothed for meter rendering and decays late, so a mark driven from it
// would linger after the sound stopped.

import type { DockVoice } from './dock-voices';

/** The graph key a voice attributes to. Section-slot fires spawn under `${key}#${slotIndex}` so
 * two slots holding one graph keep independent eval state; every other path uses the bare key.
 * Graph keys never contain `#` (padKeys use `:`), so the first segment is always the key. */
export function graphKeyOfVoice(pad: string): string {
  const hash = pad.indexOf('#');
  return hash === -1 ? pad : pad.slice(0, hash);
}

/** Does this voice keep playing after the hit that spawned it? Only `loop` and `hold` do — a
 * `oneshot` is the transient the fire marker already covers, and marking it too would make the
 * sustained state flicker at the server's ~2Hz stats cadence. Releasing voices still count: they
 * are still putting light on the kit until they are gone. */
export function isSustained(v: DockVoice): boolean {
  return v.mode === 'loop' || v.mode === 'hold';
}

/** The set of graph keys with at least one sustained voice alive. Empty when nothing sustains —
 * including on a link drop, where the store clears `serverVoices` and the marks go out with the
 * engine that owned them. */
export function playingGraphKeys(voices: readonly DockVoice[]): Set<string> {
  const keys = new Set<string>();
  for (const v of voices) {
    if (!isSustained(v)) continue;
    const key = graphKeyOfVoice(v.pad);
    if (key) keys.add(key);
  }
  return keys;
}

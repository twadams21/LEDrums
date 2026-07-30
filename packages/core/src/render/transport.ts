import type { Transport } from '../model/project-schema';
import type { TransportState } from './render-context';

/** Advance the beat clock by dt and produce a full transport snapshot for effects. */
export function advanceTransport(
  config: Transport,
  prevBeat: number,
  timeMs: number,
  dtMs: number,
): { beat: number; state: TransportState } {
  const beat = config.playing ? prevBeat + (dtMs / 1000) * (config.bpm / 60) : prevBeat;
  const bar = Math.floor(beat / config.beatsPerBar);
  const beatInBar = beat - bar * config.beatsPerBar;
  return {
    beat,
    state: {
      timeMs,
      beat,
      bar,
      beatInBar,
      bpm: config.bpm,
      beatsPerBar: config.beatsPerBar,
      playing: config.playing,
    },
  };
}

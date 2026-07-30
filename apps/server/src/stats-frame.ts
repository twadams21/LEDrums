import type { ServerMessage } from '@ledrums/protocol';

/** The `stats` server message, fully typed off the wire schema. */
export type StatsMessage = Extract<ServerMessage, { t: 'stats' }>;

/** The additive voice extension carried alongside the legacy `stats` shape. */
export type VoiceStats = NonNullable<StatsMessage['voice']>;

/**
 * Stats broadcast cadence. Decision (docs/plans/2026-07-26-deep-review/11-decisions.md,
 * approved defaults): the stats fan-out drops from 100Hz to 30Hz — the drummer-visible
 * readouts (latency, fps, per-voice meters) still update faster than they can be read,
 * and the previous 10ms timer was broadcasting a JSON frame to every client 100x/second.
 */
export const STATS_INTERVAL_MS = 1000 / 30;

/** Structural view of the host the stats frame needs. */
export interface VoiceStatsSource {
  getStats(): {
    engine: { timeMs: number; beat: number } & VoiceStats;
    latencyMs: number;
    fps: number;
    output: StatsMessage['output'];
  };
  getModel(): { pixelCount: number };
}

/**
 * Build the periodic `stats` broadcast — pure in its inputs, so the adaptation policy
 * (which used to live inside main.ts's setInterval callback) is testable.
 *
 * The voice engine's stats are adapted onto the wire's `stats` shape (voiceCount →
 * activeTriggers, model pixel count → pixelCount, `bar` derived from the transport's
 * `beatsPerBar`), plus the additive `voice` extension. `tickCount` is not a concept the voice
 * engine reports, so it stays the literal 0 the wire has always carried.
 *
 * S12 deleted the second arm. There WAS a legacy branch here that passed a different host's stats
 * through verbatim and omitted the `voice` key — a second wire payload shape, reachable only
 * through the engine mode that no longer exists.
 */
export function buildStatsMessage(deps: { voiceHost: VoiceStatsSource; beatsPerBar: number }): StatsMessage {
  const { voiceHost, beatsPerBar } = deps;
  const s = voiceHost.getStats();
  return {
    t: 'stats',
    stats: {
      timeMs: s.engine.timeMs,
      beat: s.engine.beat,
      bar: Math.floor(s.engine.beat / beatsPerBar),
      activeTriggers: s.engine.voiceCount,
      tickCount: 0,
      pixelCount: voiceHost.getModel().pixelCount,
    },
    latencyMs: s.latencyMs,
    fps: s.fps,
    output: s.output,
    voice: { voiceCount: s.engine.voiceCount, busLevels: s.engine.busLevels, voices: s.engine.voices },
  };
}

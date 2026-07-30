import { describe, expect, it } from 'vitest';
import { serverMessageSchema } from '@ledrums/protocol';
import {
  buildStatsMessage,
  STATS_INTERVAL_MS,
  type StatsMessage,
  type VoiceStatsSource,
} from './stats-frame';

const OUTPUT: StatsMessage['output'] = {
  state: 'disabled',
  protocol: 'artnet',
  host: '127.0.0.1',
  packetsSent: 0,
  lastError: null,
  universeCount: 0,
};

function voiceHost(engine: Partial<{ timeMs: number; beat: number; voiceCount: number }> = {}): VoiceStatsSource {
  return {
    getStats: () => ({
      engine: {
        timeMs: 5000,
        beat: 7.9,
        voiceCount: 3,
        busLevels: { main: 0.5 },
        voices: [
          { id: 'v1', busId: 'main', effectId: 'swirl', mode: 'oneshot' as const, level: 0.5, hue: 200, releasing: false, via: 'kick' },
        ],
        ...engine,
      },
      latencyMs: 6,
      fps: 118,
      output: OUTPUT,
    }),
    getModel: () => ({ pixelCount: 548 }),
  };
}

describe('STATS_INTERVAL_MS', () => {
  it('is the approved 30Hz cadence', () => {
    expect(STATS_INTERVAL_MS).toBe(1000 / 30);
  });
});

describe('buildStatsMessage', () => {
  it('adapts voice engine stats onto the legacy stats shape', () => {
    const msg = buildStatsMessage({ voiceHost: voiceHost(), beatsPerBar: 4 });
    expect(msg.stats.timeMs).toBe(5000);
    expect(msg.stats.beat).toBe(7.9);
    // voiceCount is what the drummer reads as "active triggers".
    expect(msg.stats.activeTriggers).toBe(3);
    expect(msg.stats.pixelCount).toBe(548);
    expect(msg.latencyMs).toBe(6);
    expect(msg.fps).toBe(118);
    expect(msg.output).toEqual(OUTPUT);
  });

  it('computes bar by flooring beat / beatsPerBar', () => {
    // 7.9 / 4 = 1.975 → bar 1 (NOT 2): the bar only advances on a completed bar.
    expect(buildStatsMessage({ voiceHost: voiceHost(), beatsPerBar: 4 }).stats.bar).toBe(1);
    expect(buildStatsMessage({ voiceHost: voiceHost({ beat: 8 }), beatsPerBar: 4 }).stats.bar).toBe(2);
    expect(buildStatsMessage({ voiceHost: voiceHost({ beat: 0 }), beatsPerBar: 3 }).stats.bar).toBe(0);
  });

  it('keeps tickCount the literal 0 the wire has always carried', () => {
    expect(buildStatsMessage({ voiceHost: voiceHost(), beatsPerBar: 4 }).stats.tickCount).toBe(0);
  });

  it('carries the additive voice extension', () => {
    const msg = buildStatsMessage({ voiceHost: voiceHost(), beatsPerBar: 4 });
    expect(msg.voice).toEqual({
      voiceCount: 3,
      busLevels: { main: 0.5 },
      voices: [
        { id: 'v1', busId: 'main', effectId: 'swirl', mode: 'oneshot', level: 0.5, hue: 200, releasing: false, via: 'kick' },
      ],
    });
  });

  it('emits a valid wire message', () => {
    const msg = buildStatsMessage({ voiceHost: voiceHost(), beatsPerBar: 4 });
    expect(serverMessageSchema.safeParse(msg).success).toBe(true);
  });
});

/**
 * S12 deleted the legacy arm. There was a second describe here proving that arm's distinct wire
 * payload: the host's engine stats passed through verbatim, `bar` NOT recomputed from beatsPerBar,
 * and NO `voice` key — a shape only the retired engine mode could produce. It went with the runtime.
 */

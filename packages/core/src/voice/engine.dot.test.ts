/* Dot's Max alive across hits (Tim, 2026-10-03: "a set maximum amount of pulses before cycling back
   to the first pulse"; renamed from Max live → Max alive → Max alive, 2026-10-05): when a new hit would take the dots alive
   past Max alive, the engine cuts the oldest hits' voices — or fades them (Oldest = Fade). */
import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel } from '../geometry/pixel-model';
import type { TransportState } from '../engine/render-context';
import { parseEffect, type EffectCell } from '../effect-chain/types';
import { createVoiceBusEngine } from './engine';
import { emptyShow, type Show } from './types';

const KICK: EffectCell = { row: 'kick', column: { kind: 'zone', slot: 0 } };
const transport: TransportState = { timeMs: 0, beat: 0, bar: 0, beatInBar: 0, bpm: 120, beatsPerBar: 4, playing: true };

/** Hit the kick `hits` times, 50ms apart, with a long Dot Effect; how many voices are alive. */
function voicesAfter(hits: number, params: Record<string, number | string>, settleMs = 0): number {
  const engine = createVoiceBusEngine();
  engine.setModel(buildPixelModel(parseKit({
    global: { ledDensityPxPerM: 30, hoopCount: 2, defaultHoopSpacingMm: 50 },
    drums: [{ id: 'kick', diameterIn: 12, hoopSpacingMm: 50, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }],
  })));
  const effect = parseEffect({
    id: 'dots', cell: KICK, retrigger: 'overlap',
    generator: { kind: 'dot', style: 'dot', params },
    amp: { attackMs: 0, length: { ms: 5000 }, releaseMs: 0 },
  });
  const show: Show = { ...emptyShow(), songs: [{ id: 'song', name: 'Song', sections: [{ id: 's', name: 's', effects: [effect] }] }] };
  engine.setShow(show);
  let now = 0;
  const step = (ms: number) => {
    for (const end = now + ms; now < end; now += 10) engine.tick(now, 10, transport);
    engine.tick(now, 10, transport);
  };
  step(10);
  for (let i = 0; i < hits; i++) {
    engine.applyInput({ kind: 'noteOn', drumId: 'kick', zone: '0', velocity: 1, timeMs: now });
    step(50);
  }
  step(settleMs);
  return engine.stats().voices.length;
}

describe('Dot Max alive across hits', () => {
  it('with no cap, every hit stays alive', () => {
    expect(voicesAfter(5, { count: 2 })).toBe(5);
  });

  it('cuts the oldest hits so the dots alive stay within Max alive', () => {
    expect(voicesAfter(5, { count: 2, maxLive: 6 })).toBe(3);
    expect(voicesAfter(5, { count: 1, maxLive: 2 })).toBe(2);
  });

  it('a cap below the dots in one hit still keeps the newest hit', () => {
    expect(voicesAfter(4, { count: 4, maxLive: 2 })).toBe(1);
  });

  it('Oldest = Fade lets the oldest fade out over Fade time instead of cutting', () => {
    const fade = { count: 1, maxLive: 2, oldest: 'fade', oldestFade: 400 };
    // 4 hits 50ms apart: the two oldest are still fading out when the last lands…
    expect(voicesAfter(4, fade)).toBe(4);
    // …and gone once Fade time has passed.
    expect(voicesAfter(4, fade, 500)).toBe(2);
  });
});

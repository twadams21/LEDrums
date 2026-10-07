/* A Velocity Control on the Effect's Opacity, end to end (Tim, 2026-10-07): a softer hit lights the
   drum dimmer — through the real engine, input to frame. */
import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel } from '../geometry/pixel-model';
import type { TransportState } from '../engine/render-context';
import { EFFECT_DEVICE, parseEffect, type EffectCell } from '../effect-chain/types';
import { createVoiceBusEngine } from './engine';
import { emptyShow } from './types';

const KICK: EffectCell = { row: 'kick', column: { kind: 'zone', slot: 0 } };
const transport: TransportState = { timeMs: 0, beat: 0, bar: 0, beatInBar: 0, bpm: 120, beatsPerBar: 4, playing: true };

function brightnessAfterHit(velocity: number, mapped = true): number {
  const engine = createVoiceBusEngine();
  const m = buildPixelModel(parseKit({
    global: { ledDensityPxPerM: 30, hoopCount: 2, defaultHoopSpacingMm: 50 },
    drums: [{ id: 'kick', diameterIn: 12, hoopSpacingMm: 50, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }],
  }));
  engine.setModel(m);
  const effect = parseEffect({
    id: 'e', cell: KICK,
    generator: { kind: 'solid', style: 'solid', params: { color: '#ffffff' } },
    amp: { attackMs: 0, length: { ms: 2000 }, releaseMs: 0 },
    controls: mapped ? [{ uid: 'v', kind: 'velocity', mappings: [{ device: EFFECT_DEVICE, param: 'opacity', rangeMin: 0, rangeMax: 1 }] }] : [],
  });
  engine.setShow({ ...emptyShow(), songs: [{ id: 'song', name: 'Song', sections: [{ id: 's', name: 's', effects: [effect] }] }] });
  let now = 0;
  const step = (ms: number) => {
    for (const end = now + ms; now < end; now += 10) engine.tick(now, 10, transport);
  };
  step(10);
  engine.applyInput({ kind: 'noteOn', drumId: 'kick', zone: '0', velocity, timeMs: now });
  step(100);
  const f = engine.frame();
  let sum = 0;
  for (let i = 0; i < m.pixelCount; i++) sum += f[i * 4]!;
  return sum / m.pixelCount;
}

describe('Velocity → the Effect\'s Opacity, end to end', () => {
  it('a soft hit lights the drum dimmer than a hard one', () => {
    const hard = brightnessAfterHit(1);
    const soft = brightnessAfterHit(0.3);
    expect(hard).toBeGreaterThan(0.5);
    expect(soft).toBeLessThan(hard * 0.6);
    expect(soft).toBeGreaterThan(0);
  });

  it('without the Control, a soft hit is as bright as a hard one (velocity is opt-in)', () => {
    expect(brightnessAfterHit(0.3, false)).toBeCloseTo(brightnessAfterHit(1, false), 2);
  });
});

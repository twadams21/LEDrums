/* Loop (Tim, 2026-10-07: "in the trigger card, loop doesn't seem to be working"): the hit repeats —
   Attack, Sustain, Decay, then round again with fresh content — until the Effect is stopped. It
   used to hold the light up with a slow breathing glow, which never looked like a loop. */
import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel } from '../geometry/pixel-model';
import type { TransportState } from '../engine/render-context';
import { parseEffect } from '../effect-chain/types';
import { createVoiceBusEngine } from './engine';
import { emptyShow } from './types';

const transport: TransportState = { timeMs: 0, beat: 0, bar: 0, beatInBar: 0, bpm: 120, beatsPerBar: 4, playing: true };
const model = buildPixelModel(parseKit({
  global: { ledDensityPxPerM: 30, hoopCount: 2, defaultHoopSpacingMm: 50 },
  drums: [{ id: 'kick', diameterIn: 12, hoopSpacingMm: 50, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }],
}));

/** Hit once; the brightest channel at each sample time (ms after the hit). */
function levels(generator: Record<string, unknown>, amp: Record<string, unknown>, at: number[]): number[] {
  const engine = createVoiceBusEngine();
  engine.setModel(model);
  const effect = parseEffect({ id: 'e', cell: { row: 'kick', column: { kind: 'zone', slot: 0 } }, generator, amp });
  engine.setShow({ ...emptyShow(), songs: [{ id: 's', name: 's', sections: [{ id: 'x', name: 'x', effects: [effect] }] }] });
  engine.tick(0, 10, transport);
  engine.applyInput({ kind: 'noteOn', drumId: 'kick', zone: '0', velocity: 1, timeMs: 0 });
  const out: number[] = [];
  let now = 0;
  for (const t of at) {
    for (; now <= t; now += 10) engine.tick(now, 10, transport);
    const f = engine.frame();
    let peak = 0;
    for (let i = 0; i < model.pixelCount; i++) peak = Math.max(peak, f[i * 4]!, f[i * 4 + 1]!, f[i * 4 + 2]!);
    out.push(peak);
  }
  return out;
}

const SOLID = { kind: 'solid', style: 'solid', params: { color: '#ff0000' } };
const SHORT = { attackMs: 0, length: { ms: 100 }, releaseMs: 100 };

describe('Loop: the envelope repeats until stopped', () => {
  it('without Loop the hit lights once and is gone', () => {
    const [on, off, later] = levels(SOLID, SHORT, [50, 260, 450]);
    expect(on).toBeGreaterThan(0.9);
    expect(off).toBe(0);
    expect(later).toBe(0);
  });

  it('with Loop it comes back each cycle (attack + sustain + decay = 200 ms)', () => {
    const [on, dark, again, dark2, third] = levels(SOLID, { ...SHORT, loop: true }, [50, 195, 250, 395, 450]);
    expect(on).toBeGreaterThan(0.9);
    expect(dark).toBeLessThan(0.15);
    expect(again).toBeGreaterThan(0.9);
    expect(dark2).toBeLessThan(0.15);
    expect(third).toBeGreaterThan(0.9);
  });

  it('a Dot restarts its dots each cycle — fresh dots, not a held frame', () => {
    // Dots live 100 ms of a 300 ms cycle: lit, dark, lit again.
    const dot = { kind: 'dot', style: 'dot', params: { life: 100, speed: 0, fade: 0 } };
    const [first, gone, back] = levels(dot, { attackMs: 0, length: { ms: 300 }, releaseMs: 0, loop: true }, [50, 200, 350]);
    expect(first).toBeGreaterThan(0.5);
    expect(gone).toBe(0);
    expect(back).toBeGreaterThan(0.5);
  });
});

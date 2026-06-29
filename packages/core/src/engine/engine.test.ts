import { describe, expect, it } from 'vitest';
import { parseProject, type Project } from '../model/project-schema';
import { defaultProject } from '../model/defaults';
import { Engine, type InputEvent } from './engine';
import type { Framebuffer } from './framebuffer';

function litCount(fb: Framebuffer): number {
  let n = 0;
  for (let i = 0; i < fb.pixelCount; i++) {
    const j = i * 4;
    if (fb.rgba[j]! > 0.004 || fb.rgba[j + 1]! > 0.004 || fb.rgba[j + 2]! > 0.004) n++;
  }
  return n;
}

function velocityMeterProject(): Project {
  return parseProject({
    name: 'test',
    kit: {
      global: { ledDensityPxPerM: 40, hoopCount: 4, defaultHoopSpacingMm: 50, maxPixelsPerOutput: 100000 },
      drums: [{ id: 'd', diameterIn: 8, hoopSpacingMm: 50, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }],
    },
    composition: {
      layers: [
        {
          id: 'L',
          role: 'base',
          blendMode: 'normal',
          opacity: 1,
          activeClipId: 'c',
          clips: [
            {
              id: 'c',
              effectId: 'meter-eq',
              params: { level: 0, brightness: 1 },
              modulations: [{ source: { type: 'velocity', drum: 'd' }, param: 'level', min: 0, max: 1, curve: 'linear' }],
            },
          ],
        },
      ],
      transport: { bpm: 120, playing: true, beatsPerBar: 4 },
    },
    inputMap: { midiChannel: null, midiNotes: [{ note: 36, drumId: 'd' }], oscMap: [] },
  });
}

describe('Engine', () => {
  it('advances transport at the configured BPM (120 BPM -> 1 beat / 500ms)', () => {
    const e = new Engine(defaultProject());
    e.tick(500);
    expect(e.getStats().beat).toBeCloseTo(1, 3);
    e.tick(500);
    expect(e.getStats().beat).toBeCloseTo(2, 3);
    expect(e.getStats().bar).toBe(0);
  });

  it('routes a note-on through velocity modulation, then decays', () => {
    const e = new Engine(velocityMeterProject());
    e.applyEvent({ kind: 'noteOn', note: 36, velocity: 1, timeMs: 0 });
    e.tick(16);
    const afterHit = litCount(e.getFrame());
    for (let i = 0; i < 80; i++) e.tick(16);
    const later = litCount(e.getFrame());
    expect(afterHit).toBeGreaterThan(0);
    expect(later).toBeLessThan(afterHit);
  });

  it('is replay-deterministic: identical events + ticks -> identical frames', () => {
    const events: InputEvent[] = [
      { kind: 'noteOn', note: 36, velocity: 0.9, timeMs: 10 },
      { kind: 'noteOn', note: 38, velocity: 0.6, timeMs: 40 },
      { kind: 'osc', address: '/ledrums/volume', value: 0.8, timeMs: 70 },
    ];
    const run = () => {
      const e = new Engine(defaultProject());
      for (const ev of events) e.applyEvent(ev);
      for (let i = 0; i < 30; i++) e.tick(16);
      return Array.from(e.getFrame().rgba);
    };
    expect(run()).toEqual(run());
  });

  it('a mapped note-on activates its trigger clip', () => {
    const p = defaultProject();
    const e = new Engine(p);
    // note 38 -> snare, activates trigger layer's "chase" clip per default input map.
    e.setActiveClip('trigger', 'whole-drum');
    e.applyEvent({ kind: 'noteOn', note: 38, velocity: 1, timeMs: 0 });
    e.tick(16);
    expect(e.getProject().composition.layers.find((l) => l.id === 'trigger')!.activeClipId).toBe('chase');
  });

  it('setKitTransform({ hoopSpacingMm }) rebuilds geometry with the new hoop gap', () => {
    const e = new Engine(velocityMeterProject());
    // local.z of a hoop = hoopIndex * hoopSpacingMm (independent of origin/rotation).
    const zOf = (hoop: number): number => e.getModel().pixels.find((p) => p.hoopIndex === hoop)!.local.z;
    expect(zOf(1)).toBeCloseTo(50, 6); // initial spacing 50mm
    e.setKitTransform('d', { hoopSpacingMm: 120 });
    expect(zOf(1)).toBeCloseTo(120, 6); // rebuilt with the new gap
    expect(zOf(2)).toBeCloseTo(240, 6);
  });

  it('setKitTransform({ diameterIn }) rebuilds geometry with the new ring radius', () => {
    const e = new Engine(velocityMeterProject());
    // ring radius of any pixel = hypot(local.x, local.y) = diameterIn * 25.4 / 2 mm (angle/origin/rotation independent).
    const radiusOf = (): number => {
      const p = e.getModel().pixels[0]!;
      return Math.hypot(p.local.x, p.local.y);
    };
    expect(radiusOf()).toBeCloseTo((8 * 25.4) / 2, 6); // initial diameter 8in -> 101.6mm radius
    e.setKitTransform('d', { diameterIn: 16 });
    expect(radiusOf()).toBeCloseTo((16 * 25.4) / 2, 6); // rebuilt: doubled diameter -> doubled radius
  });

  it('renders the full default kit within frame budget', () => {
    const e = new Engine(defaultProject());
    // warm up
    for (let i = 0; i < 5; i++) e.tick(16);
    const start = performance.now();
    const N = 60;
    for (let i = 0; i < N; i++) e.tick(16);
    const perTick = (performance.now() - start) / N;
    expect(perTick).toBeLessThan(16);
  });
});

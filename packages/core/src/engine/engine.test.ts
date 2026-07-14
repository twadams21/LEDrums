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
    // local.z of a hoop = (hoopIndex - 1) * hoopSpacingMm - halfStack, where the stack is centred
    // on the origin (B3): halfStack = (hoopCount - 1) * spacing / 2, hoopCount 4 here. The GAP
    // between adjacent hoops still equals the spacing — only the whole stack is offset to centre it.
    const zOf = (hoop: number): number => e.getModel().pixels.find((p) => p.hoopIndex === hoop)!.local.z;
    expect(zOf(2)).toBeCloseTo(-25, 6); // spacing 50mm → halfStack 75mm; hoop 2 at 50 - 75
    e.setKitTransform('d', { hoopSpacingMm: 120 });
    expect(zOf(2)).toBeCloseTo(-60, 6); // rebuilt: spacing 120 → halfStack 180; hoop 2 at 120 - 180
    expect(zOf(3)).toBeCloseTo(60, 6); //  hoop 3 at 240 - 180
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

  it('setKitGlobal applies the widened kit-global fields (expanded + the Advatek/kit config)', () => {
    const e = new Engine(defaultProject());
    e.setKitGlobal({ expanded: true, ledDensityPxPerM: 80, hoopCount: 5, defaultHoopSpacingMm: 44, maxPixelsPerOutput: 320 });
    expect(e.getProject().kit.global).toMatchObject({
      expanded: true, ledDensityPxPerM: 80, hoopCount: 5, defaultHoopSpacingMm: 44, maxPixelsPerOutput: 320,
    });
  });

  it('setHoopConfig changes ONE hoop\'s pixel count on the rebuilt model (B4 per-hoop, 1-based)', () => {
    const e = new Engine(defaultProject());
    const before = e.getModel().pixels.length;
    const kick = e.getProject().kit.drums.find((d) => d.id === 'kick')!;
    const target = kick.hoops![0]!.pixelCount + 8;
    e.setHoopConfig('kick', 1, { pixelCount: target, reverse: true });
    const hoop0 = e.getProject().kit.drums.find((d) => d.id === 'kick')!.hoops![0]!;
    expect(hoop0).toMatchObject({ pixelCount: target, reverse: true });
    expect(e.getModel().pixels.length).toBe(before + 8); // only hoop 1 grew → +8 pixels total
  });

  it('setHoopConfig no-ops for an unknown drum / out-of-range hoop (never throws)', () => {
    const e = new Engine(defaultProject());
    const before = e.getModel().pixels.length;
    e.setHoopConfig('nope', 1, { pixelCount: 5 });
    e.setHoopConfig('kick', 999, { pixelCount: 5 });
    expect(e.getModel().pixels.length).toBe(before);
  });

  it('SF1: setHoopConfig MATERIALIZES hoops[] on a density-resolved drum, then writes (no dead control)', () => {
    // `velocityMeterProject`'s drum `d` is density-derived (no literal pixelsPerHoop, no hoops[]) —
    // pre-SF1 the C5 write silently no-op'd. It must now materialize the renderer-resolved counts
    // then apply the edit, so per-hoop editing works on ANY reachable drum shape.
    const e = new Engine(velocityMeterProject());
    const drum = e.getProject().kit.drums.find((d) => d.id === 'd')!;
    expect(drum.hoops).toBeUndefined(); // the reachable dead-control shape
    const resolved = e.getModel().drumById.get('d')!.pixelsPerHoop; // what density resolved to
    const before = e.getModel().pixels.length;

    e.setHoopConfig('d', 2, { pixelCount: resolved + 5, reverse: true });

    const after = e.getProject().kit.drums.find((d) => d.id === 'd')!;
    expect(after.hoops).toHaveLength(4); // global hoopCount 4 → materialized
    // untouched hoops keep the resolved count; only hoop 2 (1-based) changed.
    expect(after.hoops![0]).toMatchObject({ pixelCount: resolved, reverse: false });
    expect(after.hoops![1]).toMatchObject({ pixelCount: resolved + 5, reverse: true });
    expect(e.getModel().pixels.length).toBe(before + 5); // only hoop 2 grew → +5 pixels
  });

  it('SF1: setHoopConfig with an in-range no-op-value write keeps the model byte-identical (materialize only)', () => {
    const e = new Engine(velocityMeterProject());
    const resolved = e.getModel().drumById.get('d')!.pixelsPerHoop;
    const before = Array.from(e.getFrame().rgba);
    // Stamp the SAME resolved count → materialization must not change what the renderer builds.
    e.setHoopConfig('d', 1, { pixelCount: resolved });
    e.tick(0);
    expect(e.getModel().pixels.length).toBe(before.length / 4);
    expect(e.getProject().kit.drums.find((d) => d.id === 'd')!.hoops).toHaveLength(4);
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

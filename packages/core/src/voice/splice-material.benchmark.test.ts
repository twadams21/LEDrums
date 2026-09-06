import { expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel } from '../geometry/pixel-model';
import { Framebuffer } from '../engine/framebuffer';
import { createDefaultCompositor } from './compositor';
import { runtimeAction, runtimeBus, runtimeFrame, runtimeEffect } from './runtime-test-fixtures';
import type { MixInputDraft, PlayAction } from './eval-graph';
import type { SpliceConfig } from './types';
import { VoicePool } from './voice-pool';

// Opt in with LEDRUMS_HEALTH_BENCH=1; ordinary tests do not run timing workloads.
// The fixture is a five-drum, four-hoop kit: 5 × 4 × 115 = 2,300 pixels. Eight members
// render the sparse `chase` generator, so coverage scans see one lit hoop and three empty
// hoops per drum on each frame. This is a compositor measurement, not hardware latency.
it.runIf(process.env.LEDRUMS_HEALTH_BENCH === '1')('reports sparse splice material transport timing', () => {
  const model = buildPixelModel(parseKit({
    global: { ledDensityPxPerM: 30, hoopCount: 4, defaultHoopSpacingMm: 50 },
    drums: Array.from({ length: 5 }, (_, i) => ({
      id: `d${i}`,
      diameterIn: 12,
      hoopSpacingMm: 50,
      hoops: Array.from({ length: 4 }, () => ({ pixelCount: 115, reverse: false })),
      origin: { x: i * 300, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    })),
  }));
  expect(model.pixelCount).toBe(2300);

  const count = 8;
  const members: MixInputDraft[] = Array.from({ length: count }, (_, i) => ({
    effectId: `fx${i}`,
    mode: 'loop',
    scope: 'kit',
    busId: 'b',
    params: {},
    opacity: 1,
    originNodeId: 'splice-benchmark',
  }));
  const splice: SpliceConfig = {
    count,
    partition: 'hoop',
    jitter: 0.25,
    seed: 7,
    chase: 'smooth',
    chaseMs: 125,
    direction: 1,
    incrementPx: 3,
    offsetMs: 0,
    order: 'up',
    drumOffsetMs: 0,
    drumOrder: 'up',
    colorOffsetMs: 0,
    colorOrder: 'up',
    rotationDeg: 17,
    smudge: 0.35,
    motionMode: 'restart',
    waitMode: 'lit',
    envelope: { attackMs: 0, sustainMs: 5000, releaseMs: 100 },
    tint: 0,
    colors: Array.from({ length: count }, () => null),
    inputBySlot: Array.from({ length: count }, (_, i) => i),
  };
  const action: PlayAction = {
    ...runtimeAction({ effectId: 'fx0', mode: 'loop', scope: 'kit', params: {}, spliceInputs: members, splice }),
    attackMs: 0,
    sustainMs: 60000,
    releaseMs: 100,
  };
  const effectsById = new Map(members.map((member) => [member.effectId, runtimeEffect('chase')]));
  const pool = new VoicePool();
  const voice = pool.spawn(action, 'd0', 1, {
    effectsById,
    busById: new Map([['b', runtimeBus]]),
    latched: new Map(),
    timeMs: 0,
    bpm: 120,
  });
  expect(voice).not.toBeNull();
  voice!.level = 1;

  const compositor = createDefaultCompositor();
  const dst = new Framebuffer(model.pixelCount);
  const samples: number[] = [];
  for (let frame = 0; frame < 600; frame++) {
    const timeMs = frame * 16;
    const start = performance.now();
    compositor.render([voice!], model, runtimeFrame(timeMs), dst);
    if (frame >= 100) samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const result = {
    pixels: model.pixelCount,
    members: count,
    warmupFrames: 100,
    sampledFrames: samples.length,
    p50Ms: +samples[Math.floor(samples.length * 0.5)]!.toFixed(4),
    p95Ms: +samples[Math.floor(samples.length * 0.95)]!.toFixed(4),
  };
  console.log(JSON.stringify(result, null, 2));
  expect(samples).toHaveLength(500);
  expect(dst.rgba.every(Number.isFinite)).toBe(true);
  expect(dst.rgba.some((value) => value > 0)).toBe(true);
}, 60_000);

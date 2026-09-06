import { expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel } from '../geometry/pixel-model';
import { Framebuffer } from '../engine/framebuffer';
import { createDefaultCompositor } from './compositor';
import { createVoiceBusEngine } from './engine';
import type { TransportState } from '../engine/render-context';
import { runtimeAction, runtimeBus, runtimeFrame, runtimeEffect } from './runtime-test-fixtures';
import type { MixInputDraft, PlayAction } from './eval-graph';
import type { GraphNode, Show, SpliceConfig, TriggerGraph } from './types';
import { padKey } from './types';
import { VoicePool } from './voice-pool';

function graphNode(kind: GraphNode['kind'], id: string, over: Partial<GraphNode> = {}): GraphNode {
  return {
    id, kind, x: 0, y: 0, mode: 'loop', scope: 'kit', effectId: '', presetId: '', busId: '', params: {}, env: {},
    noRepeat: true, on: 'value', valueMode: 'gate', threshold: 0.5, invert: false, bands: [0.5], p: 0.5,
    delayMode: 'time', ms: 0, division: '1/8', ...over,
  };
}

function engineBenchmarkGraph(): TriggerGraph {
  return {
    version: 3,
    nodes: [
      graphNode('trigger', 'trigger'),
      graphNode('splice', 'splice', {
        spliceCount: 8,
        splicePartition: 'hoop',
        spliceOffsetMode: 'time', spliceOffsetMs: 40,
        spliceDrumOffsetMode: 'time', spliceDrumOffsetMs: 125,
        splices: Array.from({ length: 8 }, () => ({ effectId: 'fx' })),
      }),
      graphNode('output', 'output'),
    ],
    edges: [{ id: 'trigger-splice', from: 'trigger', to: 'splice' }, { id: 'splice-output', from: 'splice', to: 'output' }],
  };
}

// Opt in with LEDRUMS_HEALTH_BENCH=1; ordinary tests do not run timing workloads.
// The fixture is a five-drum, four-hoop kit: 5 × 4 × 115 = 2,300 pixels. Eight members
// render an absolute texture and a stateful particle generator at non-zero cascade offsets,
// so both ordinary and boundary/crossfade paths are exercised. This is a compositor
// measurement, not hardware latency.
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
    offsetMs: 40,
    order: 'up',
    drumOffsetMs: 125,
    drumOrder: 'up',
    colorOffsetMs: 20,
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
  const percentile = (samples: number[], fraction: number): number => {
    const sorted = [...samples].sort((a, b) => a - b);
    return +(sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0).toFixed(4);
  };
  for (const generatorId of ['plasma', 'confetti-burst'] as const) {
    const effectsById = new Map(members.map((member) => [member.effectId, runtimeEffect(generatorId)]));
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
    // Plasma intentionally has no authored life and therefore does not regenerate in product
    // rendering. Give this benchmark's absolute-texture probe a fixed material period so its
    // one-render boundary path is measured beside Confetti; this is not persisted/runtime data.
    if (generatorId === 'plasma') {
      for (const member of voice!.spliceInputs ?? []) member.materialCycleMs = 1200;
    }

    const compositor = createDefaultCompositor();
    const dst = new Framebuffer(model.pixelCount);
    const ordinary: number[] = [];
    const boundary: number[] = [];
    const cycleMs = 1200;
    let sawMaterial = false;
    for (let frame = 0; frame < 600; frame++) {
      const timeMs = frame * 16;
      const start = performance.now();
      compositor.render([voice!], model, runtimeFrame(timeMs), dst);
      sawMaterial ||= dst.rgba.some((value) => value > 0);
      if (frame >= 100) {
        const sample = performance.now() - start;
        const ageInCycle = timeMs % cycleMs;
        (ageInCycle < 100 ? boundary : ordinary).push(sample);
      }
    }
    const result = {
      generatorId,
      pixels: model.pixelCount,
      members: count,
      frameBudgetMs: 16.7,
      machine: `${process.platform}/${process.arch}`,
      node: process.version,
      warmupFrames: 100,
      sampledFrames: ordinary.length + boundary.length,
      sampleMethod: 'performance.now per compositor.render; p50/p95 nearest-rank; 16ms ticks',
      ordinary: { samples: ordinary.length, p50Ms: percentile(ordinary, 0.5), p95Ms: percentile(ordinary, 0.95) },
      boundaryCrossfade: { samples: boundary.length, p50Ms: percentile(boundary, 0.5), p95Ms: percentile(boundary, 0.95) },
    };
    console.log(JSON.stringify(result, null, 2));
    expect(ordinary.length + boundary.length).toBe(500);
    expect(ordinary.length).toBeGreaterThan(0);
    expect(boundary.length).toBeGreaterThan(0);
    expect(dst.rgba.every((value) => Number.isFinite(value))).toBe(true);
    expect(sawMaterial).toBe(true);
    if (generatorId === 'plasma') {
      expect(percentile(ordinary, 0.95)).toBeLessThanOrEqual(16.7);
      expect(percentile(boundary, 0.95)).toBeLessThanOrEqual(16.7);
    }
  }

  const engine = createVoiceBusEngine();
  const engineShow: Show = {
    buses: [runtimeBus],
    graphs: { [padKey('d0', '')]: engineBenchmarkGraph() },
    sections: [],
    effects: [runtimeEffect('confetti-burst')],
    presets: [],
  };
  engine.setModel(model);
  engine.setShow(engineShow);
  engine.applyInput({ kind: 'noteOn', drumId: 'd0', zone: '', velocity: 1, timeMs: 0 });
  const engineSamples: number[] = [];
  for (let frame = 0; frame < 600; frame++) {
    const timeMs = frame * 16;
    const transport: TransportState = {
      timeMs, beat: timeMs / 500, bar: Math.floor(timeMs / 2000), beatInBar: (timeMs / 500) % 4,
      bpm: 120, beatsPerBar: 4, playing: true,
    };
    const start = performance.now();
    engine.tick(timeMs, 16, transport);
    if (frame >= 100) engineSamples.push(performance.now() - start);
  }
  const engineResult = {
    generatorId: 'confetti-burst', pixels: model.pixelCount, members: count, warmupFrames: 100,
    sampledFrames: engineSamples.length, sampleMethod: 'performance.now per full RenderEngine.tick; p50/p95 nearest-rank; 16ms ticks',
    machine: `${process.platform}/${process.arch}`, node: process.version,
    p50Ms: percentile(engineSamples, 0.5), p95Ms: percentile(engineSamples, 0.95), frameBudgetMs: 16.7,
  };
  console.log(JSON.stringify({ fullEngineTick: engineResult }, null, 2));
  expect(engineSamples).toHaveLength(500);
  expect(engineResult.p95Ms).toBeLessThanOrEqual(16.7);
}, 60_000);

import { expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel } from '../geometry/pixel-model';
import { Framebuffer } from '../engine/framebuffer';
import { createDefaultCompositor } from './compositor';
import { createVoiceBusEngine } from './engine';
import type { EffectGenerator } from '../effects/types';
import type { RenderContext } from '../engine/render-context';
import { createGeneratorBridge } from './generator-bridge';
import { materialCycleMs } from '../effects/voice-life';
import type { ModSampleCtx } from './modulation';
import type { TransportState } from '../engine/render-context';
import { runtimeAction, runtimeBus, runtimeFrame, runtimeEffect, runtimeVoice } from './runtime-test-fixtures';
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
// render a no-life field control plus declared-life field/stateful effects at non-zero cascade
// offsets. This is an opt-in compositor measurement, not hardware latency or a CI SLA.
it('keeps generator rendering structurally bounded', () => {
  let renderCount = 0;
  let stateCreates = 0;
  const contexts: RenderContext[] = [];
  const params: object[] = [];
  const framebuffers: Framebuffer[] = [];
  const generator: EffectGenerator<{ renders: number }> = {
    id: 'test-structural-performance', name: 'Structural performance probe', category: 'texture',
    paramSpec: [{ key: 'life', label: 'Life', type: 'number', default: 100, min: 1, max: 1000 }],
    createState: () => { stateCreates++; return { renders: 0 }; },
    render(ctx, resolved, fb, state): void {
      renderCount++;
      contexts.push(ctx);
      params.push(resolved);
      framebuffers.push(fb);
      state.renders++;
      fb.set(0, ctx.timeMs / 100, 0, 0, 1);
    },
  };
  const bridge = createGeneratorBridge((id) => id === generator.id ? generator : undefined);
  const model = buildPixelModel(parseKit({
    global: { ledDensityPxPerM: 30, hoopCount: 1, defaultHoopSpacingMm: 50 },
    drums: [{ id: 'd0', diameterIn: 12, hoopSpacingMm: 50, hoops: [{ pixelCount: 8, reverse: false }],
      origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }],
  }));
  const voice = runtimeVoice({}, runtimeAction({ params: { life: 100 } }), generator.id);
  const dst = new Framebuffer(model.pixelCount);
  const ranges = [{ start: 0, end: model.pixelCount }];
  const renderCtx: ModSampleCtx = { phase: 0, timeMs: 0, bpm: 120 };
  for (const timeMs of [0, 50, 100, 150]) {
    const frame = runtimeFrame(timeMs, timeMs === 0 ? 0 : 50);
    bridge.beginFrame(model, timeMs, frame.dt, frame.transport);
    dst.clear();
    renderCtx.timeMs = timeMs;
    bridge.renderVoice(voice, model, timeMs, 1, ranges, dst, renderCtx);
  }

  // Structural gates are stable across machines: one generator call per frame and reused
  // synchronous carriers after warm-up. Timing is intentionally reported only below.
  expect(renderCount).toBe(4);
  expect(stateCreates).toBe(1);
  expect(new Set(contexts).size).toBe(1);
  expect(new Set(params).size).toBe(1);
  expect(new Set(framebuffers).size).toBe(1);
  expect((voice.genState as { renders: number }).renders).toBe(4);
}, 10_000);

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
  for (const generatorId of ['plasma', 'radial-wash', 'confetti-burst'] as const) {
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
    const compositor = createDefaultCompositor();
    const dst = new Framebuffer(model.pixelCount);
    const ordinary: number[] = [];
    const boundary: number[] = [];
    const cycleMs = materialCycleMs(generatorId, {}, 120);
    let sawMaterial = false;
    for (let frame = 0; frame < 600; frame++) {
      const timeMs = frame * 16;
      const start = performance.now();
      compositor.render([voice!], model, runtimeFrame(timeMs), dst);
      sawMaterial ||= dst.rgba.some((value) => value > 0);
      if (frame >= 100) {
        const sample = performance.now() - start;
        const ageInCycle = cycleMs > 0 ? timeMs % cycleMs : -1;
        (ageInCycle >= 0 && ageInCycle < 100 ? boundary : ordinary).push(sample);
      }
    }
    const result = {
      generatorId,
      role: cycleMs > 0 ? 'authored-regeneration' : 'no-regeneration-control',
      pixels: model.pixelCount,
      members: count,
      machine: `${process.platform}/${process.arch}`,
      node: process.version,
      warmupFrames: 100,
      sampledFrames: ordinary.length + boundary.length,
      sampleMethod: 'performance.now per compositor.render; p50/p95 nearest-rank; 16ms ticks',
      ordinary: { samples: ordinary.length, p50Ms: percentile(ordinary, 0.5), p95Ms: percentile(ordinary, 0.95) },
      boundaryCrossfade: cycleMs > 0
        ? { samples: boundary.length, p50Ms: percentile(boundary, 0.5), p95Ms: percentile(boundary, 0.95) }
        : null,
      regeneration: cycleMs > 0,
    };
    console.log(JSON.stringify(result, null, 2));
    expect(ordinary.length + boundary.length).toBe(500);
    expect(ordinary.length).toBeGreaterThan(0);
    expect(dst.rgba.every((value) => Number.isFinite(value))).toBe(true);
    expect(sawMaterial).toBe(true);
    if (cycleMs > 0) expect(boundary.length).toBeGreaterThan(0);
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
    p50Ms: percentile(engineSamples, 0.5), p95Ms: percentile(engineSamples, 0.95),
  };
  console.log(JSON.stringify({ fullEngineTick: engineResult }, null, 2));
  expect(engineSamples).toHaveLength(500);
}, 60_000);

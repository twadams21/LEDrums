/* U4 gates — byte-determinism at the COMPOSITOR SEAM per playType: a canvas voice
   (playType 'canvas', scene doc through the canvas:<sceneId> adapter) renders
   byte-identically across engine runs given (time, inputs, model), exactly the seam
   guarantee the hosted path has (mirrors voice/determinism.test.ts), and a mixed
   canvas+hosted show holds the same guarantee. Plus the 5ms per-effect perf budget on
   the real 548-pixel kit (structure mirrors the engine frame-budget bench). */
import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import { Framebuffer } from '../engine/framebuffer';
import type { RenderContext, TransportState } from '../engine/render-context';
import { defaultParams } from '../effects/types';
import { createVoiceBusEngine, type InputEvent } from '../voice/engine';
import { padKey, type Bus, type EffectDef, type GraphNode, type Show, type TriggerGraph } from '../voice/types';
import { registerCanvasScene } from './registry';
import { createCanvasSceneEffect } from './scene';
import type { CanvasScene } from './types';

function testModel(): PixelModel {
  return buildPixelModel(
    parseKit({
      global: { ledDensityPxPerM: 30, hoopCount: 2, defaultHoopSpacingMm: 50 },
      drums: [
        { id: 'kick', diameterIn: 12, hoopSpacingMm: 50, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
        { id: 'snare', diameterIn: 10, hoopSpacingMm: 50, origin: { x: 300, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
      ],
    }),
  );
}

const BUSES: Bus[] = [{ id: 'base', name: 'Base', polyphony: 'poly', crossfadeMs: 200 }];

const detScene: CanvasScene = {
  id: 'det-scene',
  name: 'Det Scene',
  elements: [
    { kind: 'checker', cols: 4, rows: 3, hueA: 10, hueB: 200, phase: 0 },
    { kind: 'stripes', angleDeg: 30, widthU: 0.3, duty: 0.4, speedUps: 0.5, hue: 120, sat: 1, softness: 0.4 },
    { kind: 'circle', cx: 0.5, cy: 0.5, r: 0.3, feather: 0.15, hue: 300, sat: 0.8 },
  ],
  sampler: { kind: 'footprint' },
  lenses: [{ kind: 'kaleido', sectors: 5, spinDeg: 10 }, { kind: 'swirl', amount: 1.2, radius: 0.6 }],
};
registerCanvasScene(detScene);

function effect(id: string, over: Partial<EffectDef> = {}): EffectDef {
  return {
    id,
    name: id,
    generatorId: 'breathing-kit',
    busId: 'base',
    scope: 'kit',
    params: [{ key: 'brightness', label: 'Brightness', kind: 'number', min: 0, max: 1, default: 1 }],
    attackMs: 10,
    sustainMs: 400,
    releaseMs: 200,
    ...over,
  };
}

function node(kind: GraphNode['kind'], id: string, over: Partial<GraphNode> = {}): GraphNode {
  return {
    id, kind, x: 0, y: 0, mode: 'oneshot', scope: 'kit', effectId: '', presetId: '', busId: '',
    params: {}, env: {}, noRepeat: true, on: 'value', valueMode: 'gate', threshold: 0.5,
    invert: false, bands: [0.5], p: 0.5, delayMode: 'time', ms: 0, division: '1/8',
    ...over,
  } as GraphNode;
}

function graphOf(plays: GraphNode[]): TriggerGraph {
  return {
    nodes: [node('trigger', 'trigger'), ...plays],
    edges: plays.map((p, i) => ({ id: `e${i}`, from: 'trigger', to: p.id })),
  };
}

function showOf(graph: TriggerGraph, effects: EffectDef[]): Show {
  return { buses: BUSES, graphs: { [padKey('kick', '')]: graph }, sections: [], effects, presets: [] };
}

function transport(now: number, bpm = 120): TransportState {
  const beat = (now / 60000) * bpm;
  return { timeMs: now, beat, bar: Math.floor(beat / 4), beatInBar: beat % 4, bpm, beatsPerBar: 4, playing: true };
}

const hit = (timeMs: number): InputEvent => ({ kind: 'noteOn', drumId: 'kick', zone: '', velocity: 1, timeMs });

function run(show: Show, script: Array<{ t: number; hit?: boolean }>): Float32Array[] {
  const e = createVoiceBusEngine();
  e.setModel(testModel());
  e.setShow(show);
  const frames: Float32Array[] = [];
  let last = 0;
  for (const step of script) {
    if (step.hit) e.applyInput(hit(step.t));
    e.tick(step.t, step.t - last, transport(step.t));
    last = step.t;
    frames.push(Float32Array.from(e.frame()));
  }
  return frames;
}

const script = Array.from({ length: 30 }, (_, i) => ({ t: (i + 1) * 16, hit: i === 0 || i === 8 }));
const bytes = (f: Float32Array): Buffer => Buffer.from(f.buffer, f.byteOffset, f.byteLength);

/** A canvas play node — the scene resolves through the SAME voice/bridge path. */
const canvasNode = (): GraphNode =>
  node('play', 'p1', { effectId: 'cfx', playType: 'canvas', canvasScene: 'det-scene' });
const canvasEffect = (): EffectDef => effect('cfx', { generatorId: undefined });

describe('byte-determinism at the compositor seam — canvas playType', () => {
  it('two engines fed identical (time, inputs, model) render byte-identical canvas frames', () => {
    const s = (): Show => showOf(graphOf([canvasNode()]), [canvasEffect()]);
    const a = run(s(), script);
    const b = run(s(), script);
    expect(a.some((f) => f.some((x) => x > 0))).toBe(true); // the scene actually lights pixels
    for (let i = 0; i < a.length; i++) expect(bytes(a[i]!).equals(bytes(b[i]!)), `frame ${i}`).toBe(true);
  });

  it('a mixed show (canvas voice + hosted generator voice) replays byte-identically', () => {
    const s = (): Show =>
      showOf(
        graphOf([canvasNode(), node('play', 'p2', { y: 100, effectId: 'hosted', playType: 'textures' })]),
        [canvasEffect(), effect('hosted', { generatorId: 'plasma' })],
      );
    const a = run(s(), script);
    const b = run(s(), script);
    expect(a.some((f) => f.some((x) => x > 0))).toBe(true);
    for (let i = 0; i < a.length; i++) expect(bytes(a[i]!).equals(bytes(b[i]!)), `frame ${i}`).toBe(true);
  });
});

// ---- perf: the 5ms per-effect budget on the real 548-pixel kit ------------------------

/** The rig's real pixel counts (kick 196, snare 108, tom1 108, tom2 136 = 548). */
function rigModel(): PixelModel {
  const drum = (id: string, perHoop: number, hoops: number, x: number) => ({
    id,
    diameterIn: 12,
    pixelsPerHoop: perHoop,
    hoopCount: hoops,
    hoopSpacingMm: 50,
    origin: { x, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
  });
  return buildPixelModel(
    parseKit({
      global: { ledDensityPxPerM: 40, hoopCount: 4, defaultHoopSpacingMm: 50, maxPixelsPerOutput: 100000 },
      drums: [drum('kick', 49, 4, 0), drum('snare', 27, 4, 500), drum('tom1', 27, 4, 1000), drum('tom2', 34, 4, 1500)],
    }),
  );
}

describe('perf — canvas render inside the 5ms effect budget (548px kit)', () => {
  it('a worst-case-ish scene (3 elements + 2-lens chain + hyper4d) stays under 5ms/frame', () => {
    const m = rigModel();
    expect(m.pixelCount).toBe(548);
    const heavy: CanvasScene = {
      ...detScene,
      id: 'perf-scene',
      lenses: [{ kind: 'kaleido', sectors: 6, spinDeg: 5 }, { kind: 'swirl', amount: 1, radius: 0.7 }, { kind: 'hyper4d', rotXW: 30, rotYW: 20, rotZW: 10, wSpeed: 1 }],
    };
    const gen = createCanvasSceneEffect(heavy);
    const fb = new Framebuffer(m.pixelCount);
    const state = gen.createState!(m);
    const params = defaultParams(gen.paramSpec);
    const ctx: RenderContext = {
      model: m,
      timeMs: 0,
      dt: 16,
      transport: { timeMs: 0, beat: 0, bar: 0, beatInBar: 0, bpm: 120, beatsPerBar: 4, playing: true },
      triggers: [],
    };
    // warm up (JIT), then measure — same structure as the engine frame-budget bench
    for (let i = 0; i < 10; i++) {
      ctx.timeMs = i * 16;
      fb.clear();
      gen.render(ctx, params, fb, state);
    }
    const N = 120;
    const start = performance.now();
    for (let i = 0; i < N; i++) {
      ctx.timeMs = 160 + i * 16;
      fb.clear();
      gen.render(ctx, params, fb, state);
    }
    const perFrame = (performance.now() - start) / N;
    // eslint-disable-next-line no-console
    console.info(`[canvas perf] ${perFrame.toFixed(3)} ms/frame on 548px (budget 5ms)`);
    expect(perFrame).toBeLessThan(5);
  });
});

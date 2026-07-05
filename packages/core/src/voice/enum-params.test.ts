import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import type { TransportState } from '../engine/render-context';
import { createVoiceBusEngine, type InputEvent } from './engine';
import { padKey, type Bus, type EffectDef, type GraphNode, type Show, type TriggerGraph } from './types';

/* S18 — engine golden: an enum param must reach the hosted generator and change the rendered
   frame. Proves the whole path end-to-end: play-node `params` → voice → generator bridge
   (overlays live keys) → gen.render (reads via pstr). radialWash `mode` and wipe3d `axis`/`mode`
   are the demo effects. Self-contained (mirrors compositor.test.ts fixtures) so the slice does
   not share a test file with the sibling colour slices. */

const BUSES: Bus[] = [{ id: 'base', name: 'Base', polyphony: 'poly', crossfadeMs: 200 }];

function testModel(): PixelModel {
  const kit = parseKit({
    global: { ledDensityPxPerM: 30, hoopCount: 2, defaultHoopSpacingMm: 50 },
    drums: [
      { id: 'kick', diameterIn: 12, hoopSpacingMm: 50, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
      { id: 'snare', diameterIn: 10, hoopSpacingMm: 50, origin: { x: 300, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
    ],
  });
  return buildPixelModel(kit);
}

function node(kind: GraphNode['kind'], id: string, over: Partial<GraphNode> = {}): GraphNode {
  return {
    id, kind, x: 0, y: 0, mode: 'oneshot', scope: 'kit', effectId: '', presetId: '', busId: '',
    params: {}, env: {}, noRepeat: true, on: 'value', valueMode: 'gate',
    threshold: 0.5, invert: false, bands: [0.5], p: 0.5, delayMode: 'time', ms: 0, division: '1/8', ...over,
  };
}

/** A generator-backed effect whose voice spec only carries brightness — the enum value is
    supplied on the play node's params, exercising the bridge overlay (not the voice spec). */
function genEffect(generatorId: string): EffectDef {
  return {
    id: 'fx', name: 'fx', generatorId, busId: 'base', scope: 'kit',
    params: [{ key: 'brightness', label: 'Brightness', kind: 'number', min: 0, max: 1, default: 1 }],
    attackMs: 10, sustainMs: 5000, releaseMs: 100,
  };
}

function transport(now: number, beat = 0): TransportState {
  return { timeMs: now, beat, bar: 0, beatInBar: beat, bpm: 120, beatsPerBar: 4, playing: true };
}

const hit = (timeMs = 0): InputEvent => ({ kind: 'noteOn', drumId: 'kick', zone: '', velocity: 1, timeMs });

/** Render one hit through a generator with the given play-node params, aged past attack. */
function renderWith(generatorId: string, params: Record<string, number | string>): Float32Array {
  const m = testModel();
  const e = createVoiceBusEngine();
  const graph: TriggerGraph = {
    nodes: [node('trigger', 'trigger'), node('play', 'p1', { effectId: 'fx', scope: 'kit', params: { brightness: 1, ...params } })],
    edges: [{ id: 'e0', from: 'trigger', to: 'p1' }],
  };
  const showDoc: Show = { buses: BUSES, graphs: { [padKey('kick', '')]: graph }, sections: [], effects: [genEffect(generatorId)], presets: [] };
  e.setModel(m);
  e.setShow(showDoc);
  e.applyInput(hit(0));
  e.tick(5, 5, transport(5)); // spawn (born at 5)
  e.tick(40, 35, transport(40, 0.25)); // age 35 > 10ms attack → full level
  return Float32Array.from(e.frame());
}

const anyLit = (f: Float32Array): boolean => f.some((v) => v > 1e-4);

function framesDiffer(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i]! - b[i]!) > 1e-6) return true;
  return false;
}

describe('enum params reach the engine and change output (S18 golden)', () => {
  it('radial-wash: mode out vs in changes the rendered frame', () => {
    const out = renderWith('radial-wash', { mode: 'out' });
    const inn = renderWith('radial-wash', { mode: 'in' });
    expect(anyLit(out)).toBe(true); // the baseline actually renders
    expect(framesDiffer(out, inn)).toBe(true);
  });

  it('wipe-3d: axis x vs y changes the rendered frame', () => {
    const x = renderWith('wipe-3d', { axis: 'x' });
    const y = renderWith('wipe-3d', { axis: 'y' });
    expect(anyLit(x)).toBe(true);
    expect(framesDiffer(x, y)).toBe(true);
  });

  it('wipe-3d: mode band vs wipe changes the rendered frame', () => {
    const band = renderWith('wipe-3d', { mode: 'band' });
    const wipe = renderWith('wipe-3d', { mode: 'wipe' });
    expect(anyLit(band)).toBe(true);
    expect(framesDiffer(band, wipe)).toBe(true);
  });
});

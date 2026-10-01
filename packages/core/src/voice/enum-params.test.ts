import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import type { TransportState } from '../engine/render-context';
import { createVoiceBusEngine, type InputEvent } from './engine';
import { effectShowOf, sectionOf, zoneEffect } from './effect-test-fixtures';

/* S18 — engine golden: an enum param must reach the hosted generator and change the rendered
   frame. Proves the whole path end-to-end: an Effect's Generator `params` → voice → generator
   bridge (overlays live keys) → gen.render (reads via pstr). radialWash `mode` and wipe3d
   `axis`/`mode` are the demo effects (the Wave Generator's Radial and Wipe Styles). */

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

function transport(now: number, beat = 0): TransportState {
  return { timeMs: now, beat, bar: 0, beatInBar: beat, bpm: 120, beatsPerBar: 4, playing: true };
}

const hit = (timeMs = 0): InputEvent => ({ kind: 'noteOn', drumId: 'kick', zone: '', velocity: 1, timeMs });

/** Render one hit through a Wave Style with the given Generator params, aged past attack. */
function renderWith(style: 'radial' | 'wipe', params: Record<string, number | string>): Float32Array {
  const m = testModel();
  const e = createVoiceBusEngine();
  const effect = zoneEffect('fx', { kind: 'wave', style, params: { brightness: 1, ...params } }, {
    amp: { attackMs: 10, length: { ms: 5010 }, releaseMs: 100 }, target: { kind: 'kit' },
  });
  const showDoc = effectShowOf(sectionOf('s', [effect]));
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
    const out = renderWith('radial', { mode: 'out' });
    const inn = renderWith('radial', { mode: 'in' });
    expect(anyLit(out)).toBe(true); // the baseline actually renders
    expect(framesDiffer(out, inn)).toBe(true);
  });

  it('wipe-3d: axis x vs y changes the rendered frame', () => {
    const x = renderWith('wipe', { axis: 'x' });
    const y = renderWith('wipe', { axis: 'y' });
    expect(anyLit(x)).toBe(true);
    expect(framesDiffer(x, y)).toBe(true);
  });

  it('wipe-3d: mode band vs wipe changes the rendered frame', () => {
    const band = renderWith('wipe', { mode: 'band' });
    const wipe = renderWith('wipe', { mode: 'wipe' });
    expect(anyLit(band)).toBe(true);
    expect(framesDiffer(band, wipe)).toBe(true);
  });
});

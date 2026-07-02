import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import { Framebuffer } from '../engine/framebuffer';
import type { RenderContext, TransportState, Trigger } from '../engine/render-context';
import { defaultParams, type EffectGenerator, type ResolvedParams } from './types';
import { listEffects } from './registry';
import { solidBase } from './impl/solid-base';
import { chase } from './impl/chase';
import { wholeDrum } from './impl/whole-drum';
import { wholeKit } from './impl/whole-kit';
import { followHoop } from './impl/follow-hoop';
import { radialWash, waveRadius } from './impl/radial-wash';
import { wipe3d } from './impl/wipe-3d';
import { meterEq } from './impl/meter-eq';
import { pixelAccum } from './impl/pixel-accum';
import { colourMelody } from './impl/colour-melody';
import { strobe } from './impl/strobe';
import { syncedHoops } from './impl/synced-hoops';
import { burst } from './impl/burst';
import { swing } from './impl/swing';
import { sidechain } from './impl/sidechain';
import { sacredHogs } from './impl/sacred-hogs';
import { collisions } from './impl/collisions';
// S21 — texture effects (colour batch 3)
import { plasma } from './impl/plasma';
import { fire } from './impl/fire';
import { ripplePond } from './impl/ripple-pond';
import { rainbowFlow } from './impl/rainbow-flow';
import { tunnel } from './impl/tunnel';
import { checkerPulse } from './impl/checker-pulse';
import { perlinClouds } from './impl/perlin-clouds';
import { lavaLamp } from './impl/lava-lamp';
import { interference } from './impl/interference';
import { caustics } from './impl/caustics';
import { spiral } from './impl/spiral';
import { gridGlow } from './impl/grid-glow';
import { waveCollapse } from './impl/wave-collapse';

function model(drums = 1, hoopCount = 4): PixelModel {
  const drumDefs = [];
  for (let i = 0; i < drums; i++) {
    drumDefs.push({
      id: `d${i}`,
      diameterIn: 8,
      hoopSpacingMm: 50,
      origin: { x: i * 600, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    });
  }
  return buildPixelModel(
    parseKit({
      global: { ledDensityPxPerM: 40, hoopCount, defaultHoopSpacingMm: 50, maxPixelsPerOutput: 100000 },
      drums: drumDefs,
    }),
  );
}

function transport(beat = 0, timeMs = 0): TransportState {
  return { timeMs, beat, bar: Math.floor(beat / 4), beatInBar: beat % 4, bpm: 120, beatsPerBar: 4, playing: true };
}

function ctx(m: PixelModel, opts: Partial<RenderContext> = {}): RenderContext {
  return {
    model: m,
    timeMs: opts.timeMs ?? 0,
    dt: opts.dt ?? 16,
    transport: opts.transport ?? transport(0, opts.timeMs ?? 0),
    triggers: opts.triggers ?? [],
  };
}

function trig(seq: number, drumId: string, note: number, velocity: number, ageMs: number): Trigger {
  return { seq, drumId, note, velocity, ageMs, timeMs: 0 };
}

function render<S>(effect: EffectGenerator<S>, m: PixelModel, c: RenderContext, params?: ResolvedParams, state?: S): Framebuffer {
  const fb = new Framebuffer(m.pixelCount);
  const p = { ...defaultParams(effect.paramSpec), ...params };
  const s = state ?? (effect.createState ? effect.createState(m) : (undefined as S));
  effect.render(c, p, fb, s);
  return fb;
}

function litCount(fb: Framebuffer): number {
  let n = 0;
  for (let i = 0; i < fb.pixelCount; i++) {
    const j = i * 4;
    if (fb.rgba[j]! > 0.004 || fb.rgba[j + 1]! > 0.004 || fb.rgba[j + 2]! > 0.004) n++;
  }
  return n;
}

describe('solid-base', () => {
  it('brightness 1 lights every pixel; brightness 0 is all black', () => {
    const m = model();
    expect(litCount(render(solidBase, m, ctx(m), { brightness: 1 }))).toBe(m.pixelCount);
    expect(litCount(render(solidBase, m, ctx(m), { brightness: 0 }))).toBe(0);
  });
});

describe('chase', () => {
  it('advances the lit hoop on beat subdivisions and lights one hoop group', () => {
    const m = model(1, 4);
    const at = (beat: number) => render(chase, m, ctx(m, { transport: transport(beat) }), { subdivision: 4 });
    const hoopOf = (fb: Framebuffer) =>
      new Set(m.pixels.filter((p) => fb.rgba[p.id * 4]! > 0.004 || fb.rgba[p.id * 4 + 2]! > 0.004 || fb.rgba[p.id * 4 + 1]! > 0.004).map((p) => p.hoopIndex));
    expect(hoopOf(at(0))).toEqual(new Set([0]));
    expect(hoopOf(at(0.25))).toEqual(new Set([1]));
    expect(hoopOf(at(0.5))).toEqual(new Set([2]));
    // wraps after the last hoop
    expect(hoopOf(at(1.0))).toEqual(new Set([0]));
  });
});

describe('whole-drum vs whole-kit', () => {
  it('whole-drum lights only the struck drum', () => {
    const m = model(2);
    const fb = render(wholeDrum, m, ctx(m, { triggers: [trig(1, 'd1', 38, 1, 0)] }));
    const d0 = m.drumById.get('d0')!;
    const d1 = m.drumById.get('d1')!;
    expect(fb.rgba[d1.pixelStart * 4 + 0]! + fb.rgba[d1.pixelStart * 4 + 1]! + fb.rgba[d1.pixelStart * 4 + 2]!).toBeGreaterThan(0);
    expect(fb.rgba[d0.pixelStart * 4 + 0]! + fb.rgba[d0.pixelStart * 4 + 1]! + fb.rgba[d0.pixelStart * 4 + 2]!).toBe(0);
  });

  it('whole-kit lights every pixel on any hit', () => {
    const m = model(2);
    const fb = render(wholeKit, m, ctx(m, { triggers: [trig(1, 'd0', 36, 1, 0)] }));
    expect(litCount(fb)).toBe(m.pixelCount);
  });
});

describe('follow-hoop', () => {
  it('lights hoop 0 immediately and hoop 1 only after the delay', () => {
    const m = model(1, 4);
    const params = { delayMs: 100, decayMs: 2000 };
    const now = render(followHoop, m, ctx(m, { triggers: [trig(1, 'd0', 36, 1, 0)] }), params);
    const later = render(followHoop, m, ctx(m, { triggers: [trig(1, 'd0', 36, 1, 100)] }), params);
    const hoopLit = (fb: Framebuffer, hoop: number) =>
      m.pixels.filter((p) => p.hoopIndex === hoop).some((p) => fb.rgba[p.id * 4 + 1]! > 0.004 || fb.rgba[p.id * 4]! > 0.004 || fb.rgba[p.id * 4 + 2]! > 0.004);
    expect(hoopLit(now, 0)).toBe(true);
    expect(hoopLit(now, 1)).toBe(false);
    expect(hoopLit(later, 1)).toBe(true);
  });
});

describe('radial-wash', () => {
  it('waveRadius grows for out, shrinks for in, and bounces', () => {
    expect(waveRadius('out', 0, 1, 1000)).toBe(0);
    expect(waveRadius('out', 100, 1, 1000)).toBeGreaterThan(waveRadius('out', 50, 1, 1000));
    expect(waveRadius('in', 100, 1, 1000)).toBeLessThan(waveRadius('in', 50, 1, 1000));
    // bounce: rises to reach then falls back
    expect(waveRadius('bounce', 500, 1, 1000)).toBeGreaterThan(waveRadius('bounce', 100, 1, 1000));
    expect(waveRadius('bounce', 1500, 1, 1000)).toBeLessThan(waveRadius('bounce', 1000, 1, 1000));
  });

  it('renders a band around the expanding radius without NaNs', () => {
    const m = model(1);
    const fb = render(radialWash, m, ctx(m, { triggers: [trig(1, 'd0', 36, 1, 200)] }), { width: 400 });
    expect(litCount(fb)).toBeGreaterThan(0);
  });
});

describe('wipe-3d', () => {
  it('wipe-mode coverage grows monotonically as the plane sweeps', () => {
    const m = model(2);
    const params = { mode: 'wipe', axis: 'x', speed: 1 };
    const early = litCount(render(wipe3d, m, ctx(m, { timeMs: 50 }), params));
    const mid = litCount(render(wipe3d, m, ctx(m, { timeMs: 400 }), params));
    expect(mid).toBeGreaterThanOrEqual(early);
  });
});

describe('meter-eq', () => {
  it('lights more hoops as level rises (0 none, 1 all)', () => {
    const m = model(1, 4);
    expect(litCount(render(meterEq, m, ctx(m), { level: 0 }))).toBe(0);
    const half = litCount(render(meterEq, m, ctx(m), { level: 0.5 }));
    const full = litCount(render(meterEq, m, ctx(m), { level: 1 }));
    expect(full).toBe(m.pixelCount);
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(full);
  });
});

describe('pixel-accum', () => {
  it('lights at most addPerHit pixels per hit and is seed-deterministic', () => {
    const m = model(1);
    const params = { addPerHit: 3, decayMs: 100000 };
    const s1 = pixelAccum.createState!(m);
    const s2 = pixelAccum.createState!(m);
    const triggers = [trig(1, 'd0', 36, 1, 0), trig(2, 'd0', 36, 1, 0)];
    const a = render(pixelAccum, m, ctx(m, { triggers }), params, s1);
    const b = render(pixelAccum, m, ctx(m, { triggers }), params, s2);
    expect(litCount(a)).toBeLessThanOrEqual(2 * 3);
    expect(litCount(a)).toBeGreaterThan(0);
    expect(Array.from(a.rgba)).toEqual(Array.from(b.rgba));
  });
});

describe('colour-melody', () => {
  it('maps each note to a hue, held, and repeatable', () => {
    const m = model(1);
    const hueOf = (note: number) => {
      const fb = render(colourMelody, m, ctx(m, { triggers: [trig(1, 'd0', note, 1, 0)] }));
      const j = m.pixels[0]!.id * 4;
      return [fb.rgba[j]!, fb.rgba[j + 1]!, fb.rgba[j + 2]!].join(',');
    };
    expect(hueOf(0)).not.toBe(hueOf(120));
    expect(hueOf(60)).toBe(hueOf(60));
  });
});

describe('strobe', () => {
  it('is fully on during the on-phase and dark during the off-phase', () => {
    const m = model(1);
    // rate 10 Hz -> half-period 50ms. t=0 on, t=60ms off.
    expect(litCount(render(strobe, m, ctx(m, { timeMs: 0 }), { rate: 10 }))).toBe(m.pixelCount);
    expect(litCount(render(strobe, m, ctx(m, { timeMs: 60 }), { rate: 10 }))).toBe(0);
  });
});

describe('synced-hoops', () => {
  it('renders the same color for the same hoopIndex across two drums', () => {
    const m = model(2, 4);
    const fb = render(syncedHoops, m, ctx(m, { transport: transport(1.3, 700) }));
    const d0 = m.drumById.get('d0')!;
    const d1 = m.drumById.get('d1')!;
    // First pixel of hoop 0 on each drum is the start pixel of that drum.
    const colorAt = (id: number) => [fb.rgba[id * 4]!, fb.rgba[id * 4 + 1]!, fb.rgba[id * 4 + 2]!].join(',');
    expect(colorAt(d0.pixelStart)).toBe(colorAt(d1.pixelStart));
    // Different hoop levels differ (the wave/hue varies up the drum).
    const hoop2Start = d0.pixelStart + 2 * d0.pixelsPerHoop;
    expect(colorAt(d0.pixelStart)).not.toBe(colorAt(hoop2Start));
  });
});

describe('burst', () => {
  it('lights the whole struck drum; harder hits stay lit longer', () => {
    const m = model(2);
    const params = { baseDecayMs: 200 };
    const d0 = m.drumById.get('d0')!;
    // Whole struck drum lit at age 0.
    const fresh = render(burst, m, ctx(m, { triggers: [trig(1, 'd0', 36, 1, 0)] }), params);
    let drumLit = 0;
    for (let p = d0.pixelStart; p < d0.pixelStart + d0.pixelCount; p++) {
      if (fresh.rgba[p * 4]! > 0.004 || fresh.rgba[p * 4 + 1]! > 0.004 || fresh.rgba[p * 4 + 2]! > 0.004) drumLit++;
    }
    expect(drumLit).toBe(d0.pixelCount);

    // At a fixed later age, the harder hit retains more brightness than a soft hit.
    const briOf = (vel: number) => {
      const fb = render(burst, m, ctx(m, { triggers: [trig(1, 'd0', 36, vel, 400)] }), params);
      const j = d0.pixelStart * 4;
      return Math.max(fb.rgba[j]!, fb.rgba[j + 1]!, fb.rgba[j + 2]!);
    };
    expect(briOf(1)).toBeGreaterThan(briOf(0.4));
  });
});

describe('swing', () => {
  it('accumulates energy with repeated hits and decays when idle', () => {
    const m = model(1);
    const params = { gain: 0.4, decayMs: 100000 };
    const d0 = m.drumById.get('d0')!;
    const briOf = (fb: Framebuffer) => {
      const j = d0.pixelStart * 4;
      return Math.max(fb.rgba[j]!, fb.rgba[j + 1]!, fb.rgba[j + 2]!);
    };
    const state = swing.createState!(m);
    const one = render(swing, m, ctx(m, { dt: 0, triggers: [trig(1, 'd0', 36, 1, 0)] }), params, state);
    const after1 = briOf(one);
    const two = render(swing, m, ctx(m, { dt: 0, triggers: [trig(2, 'd0', 36, 1, 0)] }), params, state);
    const after2 = briOf(two);
    expect(after1).toBeGreaterThan(0);
    expect(after2).toBeGreaterThan(after1);

    // With a fast decay and a long idle frame, energy falls.
    const decayState = swing.createState!(m);
    render(swing, m, ctx(m, { dt: 0, triggers: [trig(1, 'd0', 36, 1, 0)] }), { gain: 1, decayMs: 100 }, decayState);
    const faded = briOf(render(swing, m, ctx(m, { dt: 500, triggers: [] }), { gain: 1, decayMs: 100 }, decayState));
    expect(faded).toBeLessThan(after1);
  });
});

describe('sidechain', () => {
  it('dips brightness right after a trigger then recovers', () => {
    const m = model(1);
    const params = { brightness: 1, duckDepth: 0.8, recoverMs: 400 };
    const briOf = (fb: Framebuffer) => Math.max(fb.rgba[0]!, fb.rgba[1]!, fb.rgba[2]!);

    const state = sidechain.createState!(m);
    // Recovered baseline (no triggers, small dt).
    const baseline = briOf(render(sidechain, m, ctx(m, { dt: 16, triggers: [] }), params, state));
    // Trigger arrives -> ducks.
    const ducked = briOf(render(sidechain, m, ctx(m, { dt: 0, triggers: [trig(1, 'd0', 36, 1, 0)] }), params, state));
    expect(ducked).toBeLessThan(baseline);
    // Subsequent idle frames recover toward the baseline.
    const recovering = briOf(render(sidechain, m, ctx(m, { dt: 200, triggers: [] }), params, state));
    expect(recovering).toBeGreaterThan(ducked);
  });
});

describe('sacred-hogs', () => {
  it('lights pixels (halo + hogs) over time without NaNs', () => {
    const m = model(1, 4);
    const fb = render(sacredHogs, m, ctx(m, { timeMs: 500, dt: 16 }));
    expect(litCount(fb)).toBeGreaterThan(0);
    for (let i = 0; i < fb.rgba.length; i++) expect(Number.isFinite(fb.rgba[i]!)).toBe(true);
  });
});

describe('collisions', () => {
  it('lights circling nodes over time without NaNs', () => {
    const m = model(1, 4);
    const state = collisions.createState!(m);
    // Advance several frames so nodes move and may collide.
    let fb = new Framebuffer(m.pixelCount);
    for (let f = 0; f < 30; f++) {
      fb = render(collisions, m, ctx(m, { timeMs: f * 100, dt: 100 }), {}, state);
    }
    expect(litCount(fb)).toBeGreaterThan(0);
    for (let i = 0; i < fb.rgba.length; i++) expect(Number.isFinite(fb.rgba[i]!)).toBe(true);
  });
});

// S19 — Colour batch 1 (swatch + hit/trigger effects). Saturation is now exposed on
// chase, whole-drum, whole-kit, follow-hoop, burst, pixel-accum, synced-hoops, swing
// (colour-melody already had it). The contract: saturation 0 desaturates every lit pixel
// to achromatic white/grey (r===g===b), which the hardcoded `hsvToRgb(hue, 1, …)` could
// never produce. Each case uses a coloured hue so a leak would show as a chromatic pixel.
describe('S19 colour batch 1 — saturation 0 ⇒ white on lit pixels', () => {
  /** Every pixel with any light is achromatic (r===g===b within fp epsilon). */
  function scanLit(fb: Framebuffer): { lit: number; allWhite: boolean } {
    let lit = 0;
    let allWhite = true;
    for (let i = 0; i < fb.pixelCount; i++) {
      const j = i * 4;
      const r = fb.rgba[j]!;
      const g = fb.rgba[j + 1]!;
      const b = fb.rgba[j + 2]!;
      if (r > 0.004 || g > 0.004 || b > 0.004) {
        lit++;
        if (Math.abs(r - g) > 1e-6 || Math.abs(g - b) > 1e-6) allWhite = false;
      }
    }
    return { lit, allWhite };
  }

  const hit = (id: string) => trig(1, id, 38, 1, 0);
  const cases: Array<{ name: string; run: (m: PixelModel) => Framebuffer }> = [
    { name: 'chase', run: (m) => render(chase, m, ctx(m, { transport: transport(0) }), { hue: 120, saturation: 0 }) },
    { name: 'whole-drum', run: (m) => render(wholeDrum, m, ctx(m, { triggers: [hit('d0')] }), { hue: 120, saturation: 0 }) },
    { name: 'whole-kit', run: (m) => render(wholeKit, m, ctx(m, { triggers: [hit('d0')] }), { hue: 120, saturation: 0 }) },
    { name: 'follow-hoop', run: (m) => render(followHoop, m, ctx(m, { triggers: [hit('d0')] }), { hue: 120, saturation: 0, delayMs: 0, decayMs: 2000 }) },
    { name: 'burst', run: (m) => render(burst, m, ctx(m, { triggers: [hit('d0')] }), { hue: 120, saturation: 0 }) },
    { name: 'pixel-accum', run: (m) => render(pixelAccum, m, ctx(m, { triggers: [hit('d0')] }), { hue: 120, saturation: 0 }, pixelAccum.createState!(m)) },
    { name: 'synced-hoops', run: (m) => render(syncedHoops, m, ctx(m, { transport: transport(1.3, 700) }), { hue: 120, saturation: 0 }) },
    { name: 'swing', run: (m) => render(swing, m, ctx(m, { dt: 0, triggers: [hit('d0')] }), { hue: 120, saturation: 0 }, swing.createState!(m)) },
    { name: 'colour-melody', run: (m) => render(colourMelody, m, ctx(m, { triggers: [hit('d0')] }), { saturation: 0 }) },
  ];

  for (const c of cases) {
    it(`${c.name}: lights pixels and every lit pixel is white`, () => {
      const m = model(1, 4);
      const { lit, allWhite } = scanLit(c.run(m));
      expect(lit, `${c.name} lit nothing`).toBeGreaterThan(0);
      expect(allWhite, `${c.name} left a chromatic pixel`).toBe(true);
    });
  }

  it('saturation is a real knob: a coloured hue at sat 1 is NOT white', () => {
    const m = model(1, 4);
    const fb = render(chase, m, ctx(m, { transport: transport(0) }), { hue: 120, saturation: 1 });
    expect(scanLit(fb).allWhite).toBe(false);
  });
});

// S21 — Colour batch 3 (textures). Saturation is now exposed and threaded into every
// hsvToRgb on all thirteen texture effects. Same contract as S19: saturation 0 desaturates
// every lit pixel to achromatic white/grey (r===g===b), which the old hardcoded S-slots
// (1, 0.95, 0.9, or a computed sat) could never reach. tunnel and rainbow-flow are the two
// full-wheel "multi" effects — a single hue can't represent them, so they carry no bare
// `hue` param (hueOffset/hueRange instead), but saturation still desaturates them to grey.
describe('S21 colour batch 3 — saturation 0 ⇒ white on lit pixels (textures)', () => {
  /** Every pixel with any light is achromatic (r===g===b within fp epsilon). */
  function scanLit(fb: Framebuffer): { lit: number; allWhite: boolean } {
    let lit = 0;
    let allWhite = true;
    for (let i = 0; i < fb.pixelCount; i++) {
      const j = i * 4;
      const r = fb.rgba[j]!;
      const g = fb.rgba[j + 1]!;
      const b = fb.rgba[j + 2]!;
      if (r > 0.004 || g > 0.004 || b > 0.004) {
        lit++;
        if (Math.abs(r - g) > 1e-6 || Math.abs(g - b) > 1e-6) allWhite = false;
      }
    }
    return { lit, allWhite };
  }

  // Field textures read ctx.timeMs; wave-collapse is trigger-driven (a shell at `reach`).
  const cases: Array<{ name: string; run: (m: PixelModel) => Framebuffer }> = [
    { name: 'plasma', run: (m) => render(plasma, m, ctx(m, { timeMs: 250 }), { hue: 120, saturation: 0 }) },
    { name: 'fire', run: (m) => render(fire, m, ctx(m, { timeMs: 250 }), { hue: 30, saturation: 0 }) },
    { name: 'ripple-pond', run: (m) => render(ripplePond, m, ctx(m, { timeMs: 250 }), { hue: 120, saturation: 0 }) },
    { name: 'rainbow-flow', run: (m) => render(rainbowFlow, m, ctx(m, { timeMs: 250 }), { saturation: 0 }) },
    { name: 'tunnel', run: (m) => render(tunnel, m, ctx(m, { timeMs: 250 }), { hueOffset: 120, saturation: 0 }) },
    { name: 'checker-pulse', run: (m) => render(checkerPulse, m, ctx(m, { timeMs: 250 }), { hue: 120, saturation: 0 }) },
    { name: 'perlin-clouds', run: (m) => render(perlinClouds, m, ctx(m, { timeMs: 250 }), { hue: 120, saturation: 0 }) },
    { name: 'lava-lamp', run: (m) => render(lavaLamp, m, ctx(m, { timeMs: 250 }), { hue: 120, saturation: 0 }) },
    { name: 'interference', run: (m) => render(interference, m, ctx(m, { timeMs: 250 }), { hue: 120, saturation: 0 }) },
    { name: 'caustics', run: (m) => render(caustics, m, ctx(m, { timeMs: 250 }), { hue: 120, saturation: 0 }) },
    { name: 'spiral', run: (m) => render(spiral, m, ctx(m, { timeMs: 250 }), { hue: 120, saturation: 0 }) },
    { name: 'grid-glow', run: (m) => render(gridGlow, m, ctx(m, { timeMs: 250 }), { hue: 120, saturation: 0 }) },
    {
      name: 'wave-collapse',
      run: (m) =>
        render(waveCollapse, m, ctx(m, { triggers: [trig(1, 'd0', 38, 1, 0)] }), {
          hue: 120,
          saturation: 0,
          reach: 100,
          width: 800,
        }),
    },
  ];

  for (const c of cases) {
    it(`${c.name}: lights pixels and every lit pixel is white`, () => {
      const m = model(1, 4);
      const { lit, allWhite } = scanLit(c.run(m));
      expect(lit, `${c.name} lit nothing`).toBeGreaterThan(0);
      expect(allWhite, `${c.name} left a chromatic pixel`).toBe(true);
    });
  }

  it('saturation is a real knob: a coloured texture at sat 1 is NOT white', () => {
    const m = model(1, 4);
    const fb = render(plasma, m, ctx(m, { timeMs: 250 }), { hue: 120, saturation: 1 });
    expect(scanLit(fb).allWhite).toBe(false);
  });
});

describe('all effects', () => {
  it('never emit NaN or out-of-range channel values', () => {
    const m = model(2);
    const triggers = [trig(1, 'd0', 36, 0.8, 30), trig(2, 'd1', 38, 1, 120)];
    for (const e of listEffects()) {
      const fb = render(e, m, ctx(m, { timeMs: 250, transport: transport(2.3, 250), triggers }));
      for (let i = 0; i < fb.rgba.length; i++) {
        const v = fb.rgba[i]!;
        expect(Number.isFinite(v), e.id).toBe(true);
        expect(v >= 0 && v <= 1, `${e.id} channel ${i} = ${v}`).toBe(true);
      }
    }
  });
});

import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import {
  buildSliceLayout,
  forEachSliceContribution,
  resolveSlice,
  resolveSliceSpace,
  sliceDirection,
  sliceFeather,
  slicePhase,
} from './slice';
import { maxCascadeDelayMs } from './splice';
import type { SpliceNode, SpliceConfig } from './types';

/* Slice cuts the kit into parallel slabs through space. The geometry is the only new idea —
   everything else is a splice's — so these pin the geometry hard (which slab a pixel is in, how
   the slabs tilt, move, blend and respect a box) and pin only the JOINS to the shared splice
   machinery (the config it resolves to, the cascade length it reports). */

/** Two drums side by side along X — kick at x=0, snare 600mm to its right. */
function model(): PixelModel {
  return buildPixelModel(
    parseKit({
      global: { ledDensityPxPerM: 30, hoopCount: 2, defaultHoopSpacingMm: 50 },
      drums: [
        { id: 'kick', diameterIn: 12, pixelsPerHoop: 8, hoopSpacingMm: 50, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
        { id: 'snare', diameterIn: 12, pixelsPerHoop: 8, hoopSpacingMm: 50, origin: { x: 600, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
      ],
    }),
  );
}

function sliceNode(over: Partial<SpliceNode> = {}): SpliceNode {
  return {
    splices: [{ color: '#ff0000' }, { color: '#0000ff' }],
    spliceCount: 2,
    ...over,
  };
}

function config(over: Partial<SpliceNode> = {}): SpliceConfig {
  const resolved = resolveSlice(sliceNode(over), 120);
  if (!resolved) throw new Error('slice resolved to nothing');
  return resolved.config;
}

const allPixels = (m: PixelModel) => [{ start: 0, end: m.pixelCount }];

/** slot shown per pixel at `ageMs`, weight-1 pixels only (so smudged pixels do not muddy it). */
function slotsAt(m: PixelModel, cfg: SpliceConfig, ageMs = 0, velocity = 1): Map<number, number> {
  const layout = buildSliceLayout(m, allPixels(m), cfg);
  const out = new Map<number, number>();
  forEachSliceContribution(layout, cfg, { ageMs, motionMs: ageMs, pulseCycleMs: 0 }, velocity, (id, slot, w) => {
    if (w > 0.999) out.set(id, slot);
  });
  return out;
}

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('slice direction', () => {
  it('points straight along the chosen axis with no tilt', () => {
    const x = sliceDirection('x', 0, 0, 0);
    close(x.x, 1);
    close(x.y, 0);
    const y = sliceDirection('y', 0, 0, 0);
    close(y.y, 1);
    const z = sliceDirection('z', 0, 0, 0);
    close(z.z, 1);
  });

  it('tilts about each world axis independently', () => {
    // X tilted 90° about Z becomes Y — the slabs turn from vertical walls to horizontal floors.
    const zTilt = sliceDirection('x', 0, 0, 90);
    close(zTilt.x, 0);
    close(zTilt.y, 1);
    // Y tilted 90° about X becomes Z.
    const xTilt = sliceDirection('y', 90, 0, 0);
    close(xTilt.y, 0);
    close(xTilt.z, 1);
    // Z tilted 90° about Y becomes X.
    const yTilt = sliceDirection('z', 0, 90, 0);
    close(yTilt.x, 1);
    close(yTilt.z, 0);
  });

  it('is always a unit vector, whatever the tilt', () => {
    for (const [rx, ry, rz] of [[13, 47, 211], [90, 90, 90], [-30, 400, 5]]) {
      const d = sliceDirection('x', rx!, ry!, rz!);
      close(Math.hypot(d.x, d.y, d.z), 1);
    }
  });
});

describe('resolving a slice node', () => {
  it('rides the splice resolution and adds only its geometry', () => {
    const cfg = config({ spliceChase: 'smooth', spliceRateMode: 'time', spliceRateMs: 500 });
    expect(cfg.chase).toBe('smooth');
    expect(cfg.chaseMs).toBe(500);
    expect(cfg.count).toBe(2);
    expect(cfg.space).toBeDefined();
  });

  it('keeps DRUM CHASE live — a slice has no partition to switch it off', () => {
    // A splice zeroes the drum offset off the hoop partition; a slice must never inherit that.
    const cfg = config({ spliceDrumOffsetMode: 'time', spliceDrumOffsetMs: 250 });
    expect(cfg.drumOffsetMs).toBe(250);
  });

  it('defaults to X, fully velocity sensitive, no region, 10% stagger', () => {
    const space = resolveSliceSpace(sliceNode());
    close(space.direction.x, 1);
    expect(space.velocity).toBe(1);
    expect(space.region).toBeUndefined();
    close(space.incrementFrac, 0.1);
  });

  it('turns a centre + size into a box', () => {
    const space = resolveSliceSpace(sliceNode({ sliceRegion: { cx: 100, cy: 0, cz: 0, sx: 200, sy: 50, sz: 50 } }));
    expect(space.region).toEqual({ min: { x: 0, y: -25, z: -25 }, max: { x: 200, y: 25, z: 25 } });
  });

  it('reports a cascade long enough to reach the last slab, drum and colour', () => {
    const m = model();
    const cfg = config({
      spliceOffsetMode: 'time', spliceOffsetMs: 100,     // SLICE CHASE: 1 extra slab
      spliceDrumOffsetMode: 'time', spliceDrumOffsetMs: 300, // DRUM CHASE: 1 extra drum
      spliceColorOffsetMode: 'time', spliceColorOffsetMs: 50, // COLOUR CHASE: 1 extra colour
    });
    expect(maxCascadeDelayMs(m, cfg)).toBe(100 + 300 + 50);
  });
});

describe('slice layout', () => {
  it('places every pixel along the axis in [0, 1)', () => {
    const m = model();
    const layout = buildSliceLayout(m, allPixels(m), config());
    expect(layout.ids.length).toBe(m.pixelCount);
    for (const t of layout.t) {
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThan(1);
    }
  });

  it('cuts slabs that tile the span exactly', () => {
    const layout = buildSliceLayout(model(), allPixels(model()), config({ spliceCount: 5, spliceJitter: 0.8, splices: [{ color: '#fff' }] }));
    expect(layout.bands[0]!.start).toBe(0);
    expect(layout.bands.at(-1)!.end).toBe(1);
    for (let b = 1; b < layout.bands.length; b++) expect(layout.bands[b]!.start).toBe(layout.bands[b - 1]!.end);
  });

  it('keeps only the pixels inside a region box', () => {
    const m = model();
    // A box around the kick only (kick is at x=0, radius ~152mm; snare at x=600).
    const cfg = config({ sliceRegion: { cx: 0, cy: 0, cz: 0, sx: 400, sy: 400, sz: 400 } });
    const layout = buildSliceLayout(m, allPixels(m), cfg);
    const kick = m.drumById.get('kick')!;
    expect(layout.ids.length).toBe(kick.pixelCount);
    for (const id of layout.ids) expect(m.pixels[id]!.drumId).toBe('kick');
  });
});

describe('slabs through space', () => {
  it('two X slabs put the left drum in one slice and the right drum in the other', () => {
    const m = model();
    const slots = slotsAt(m, config());
    const kick = m.drumById.get('kick')!;
    const snare = m.drumById.get('snare')!;
    for (let id = kick.pixelStart; id < kick.pixelStart + kick.pixelCount; id++) expect(slots.get(id), `kick ${id}`).toBe(0);
    for (let id = snare.pixelStart; id < snare.pixelStart + snare.pixelCount; id++) expect(slots.get(id), `snare ${id}`).toBe(1);
  });

  it('tilting the slabs 90° changes which pixels share a slice', () => {
    // Along X the two drums are split; along Y (tilt X by 90° about Z) both drums are cut the
    // same way, so each drum now holds BOTH slots.
    const m = model();
    const slots = slotsAt(m, config({ sliceRotZ: 90 }));
    const kick = m.drumById.get('kick')!;
    const seen = new Set<number>();
    for (let id = kick.pixelStart; id < kick.pixelStart + kick.pixelCount; id++) {
      const s = slots.get(id);
      if (s !== undefined) seen.add(s);
    }
    expect(seen).toEqual(new Set([0, 1]));
  });
});

describe('moving the slabs', () => {
  it('a step chase swaps which slice each slab shows, one interval at a time', () => {
    const m = model();
    const cfg = config({ spliceChase: 'step', spliceRateMode: 'time', spliceRateMs: 100 });
    const kickPixel = m.drumById.get('kick')!.pixelStart;
    expect(slotsAt(m, cfg, 50).get(kickPixel)).toBe(0);
    expect(slotsAt(m, cfg, 150).get(kickPixel)).toBe(1);
  });

  it('a smooth phase covers one whole span per interval, stagger jumps its increment', () => {
    const smooth = config({ spliceChase: 'smooth', spliceRateMode: 'time', spliceRateMs: 1000 });
    close(slicePhase(500, smooth), 0.5);
    const stagger = config({ spliceChase: 'stagger', spliceRateMode: 'time', spliceRateMs: 100, sliceIncrementPct: 25 });
    close(slicePhase(150, stagger), 0.25); // one jump taken
    close(slicePhase(250, stagger), 0.5); // two
  });

  it('a half-span sweep moves the left drum into the other slice', () => {
    const m = model();
    const cfg = config({ spliceChase: 'smooth', spliceRateMode: 'time', spliceRateMs: 1000 });
    const kickPixel = m.drumById.get('kick')!.pixelStart;
    expect(slotsAt(m, cfg, 0).get(kickPixel)).toBe(0);
    expect(slotsAt(m, cfg, 500).get(kickPixel)).toBe(1);
  });

  it('MOVE THROUGH reverse runs the sweep the other way', () => {
    const fwd = config({ spliceChase: 'smooth', spliceRateMode: 'time', spliceRateMs: 1000 });
    const rev = config({ spliceChase: 'smooth', spliceRateMode: 'time', spliceRateMs: 1000, spliceDirection: -1 });
    close(slicePhase(250, rev), -slicePhase(250, fwd));
  });
});

describe('smudge and velocity', () => {
  it('a smudged pixel shows two slices whose weights sum to 1', () => {
    const m = model();
    const cfg = config({ spliceSmudge: 1, spliceCount: 4, splices: [{ color: '#f00' }, { color: '#0f0' }, { color: '#00f' }, { color: '#fff' }] });
    const layout = buildSliceLayout(m, allPixels(m), cfg);
    const total = new Map<number, number>();
    const parts = new Map<number, number>();
    forEachSliceContribution(layout, cfg, { ageMs: 0, motionMs: 0, pulseCycleMs: 0 }, 1, (id, _slot, w) => {
      total.set(id, (total.get(id) ?? 0) + w);
      parts.set(id, (parts.get(id) ?? 0) + 1);
    });
    expect([...parts.values()].some((n) => n === 2), 'some pixel sits in a crossfade').toBe(true);
    for (const w of total.values()) close(w, 1);
  });

  it('never crossfades wider than the narrowest slab', () => {
    const bands = [{ start: 0, end: 0.1 }, { start: 0.1, end: 1 }];
    expect(sliceFeather(1, bands)).toBeLessThanOrEqual(0.1);
  });

  it('a soft hit is a dimmer slice when velocity sensitive, the same slice when not', () => {
    const m = model();
    const weightAt = (cfg: SpliceConfig, velocity: number): number => {
      let w = 0;
      forEachSliceContribution(buildSliceLayout(m, allPixels(m), cfg), cfg, { ageMs: 0, motionMs: 0, pulseCycleMs: 0 }, velocity, (_id, _s, weight) => {
        w = Math.max(w, weight);
      });
      return w;
    };
    close(weightAt(config(), 0.25), 0.25); // fully sensitive: brightness follows velocity
    close(weightAt(config({ sliceVelocity: 0 }), 0.25), 1); // off: every hit full brightness
    close(weightAt(config({ sliceVelocity: 0.5 }), 0.25), 0.625); // halfway: 1 - s + s·v
  });
});

describe('MOVE THROUGH MODE and the chases', () => {
  it('SLICE CHASE with dark holds each slab black until its turn', () => {
    const m = model();
    const cfg = config({ spliceWaitMode: 'dark', spliceOffsetMode: 'time', spliceOffsetMs: 200 });
    const snare = m.drumById.get('snare')!.pixelStart;
    const kick = m.drumById.get('kick')!.pixelStart;
    const early = slotsAt(m, cfg, 100);
    expect(early.has(kick), 'first slab is lit').toBe(true);
    expect(early.has(snare), 'second slab is still dark').toBe(false);
    expect(slotsAt(m, cfg, 250).has(snare), 'its turn has come').toBe(true);
  });

  it('DRUM CHASE with dark lights drum after drum', () => {
    const m = model();
    // One slab covering everything, so only the drum axis can hold the snare back.
    const cfg = config({ spliceCount: 1, splices: [{ color: '#fff' }], spliceWaitMode: 'dark', spliceDrumOffsetMode: 'time', spliceDrumOffsetMs: 300 });
    const kick = m.drumById.get('kick')!.pixelStart;
    const snare = m.drumById.get('snare')!.pixelStart;
    expect(slotsAt(m, cfg, 100).has(kick)).toBe(true);
    expect(slotsAt(m, cfg, 100).has(snare)).toBe(false);
    expect(slotsAt(m, cfg, 350).has(snare)).toBe(true);
  });

  it('with lit, a chase changes nothing about what is showing', () => {
    // Lit is "everything on and still until its turn" — an offset alone must not black anything out.
    const m = model();
    const lit = slotsAt(m, config({ spliceOffsetMode: 'time', spliceOffsetMs: 500 }), 10);
    expect(lit.size).toBe(m.pixelCount);
  });

  it('is deterministic — the same inputs walk the same contributions', () => {
    const m = model();
    const cfg = config({ spliceChase: 'smooth', spliceRateMode: 'time', spliceRateMs: 700, spliceJitter: 0.6, spliceSmudge: 0.4 });
    const run = () => {
      const out: number[] = [];
      forEachSliceContribution(buildSliceLayout(m, allPixels(m), cfg), cfg, { ageMs: 333, motionMs: 333, pulseCycleMs: 0 }, 0.8, (id, slot, w) => {
        out.push(id, slot, w);
      });
      return out;
    };
    expect(run()).toEqual(run());
  });

  it('a layout reused across frames walks exactly as a fresh one — its per-drum scratch resets', () => {
    // The compositor caches one layout per config and walks it every frame, so the per-drum motion
    // scratch it carries must not leak one frame's phases into the next.
    const m = model();
    const cfg = config({ spliceChase: 'smooth', spliceRateMode: 'time', spliceRateMs: 700, spliceDrumOffsetMode: 'time', spliceDrumOffsetMs: 150 });
    const walk = (layout: ReturnType<typeof buildSliceLayout>, atMs: number) => {
      const out: number[] = [];
      forEachSliceContribution(layout, cfg, { ageMs: atMs, motionMs: atMs, pulseCycleMs: 0 }, 1, (id, slot, w) => {
        out.push(id, slot, w);
      });
      return out;
    };
    const reused = buildSliceLayout(m, allPixels(m), cfg);
    walk(reused, 900);
    expect(walk(reused, 333)).toEqual(walk(buildSliceLayout(m, allPixels(m), cfg), 333));
  });
});

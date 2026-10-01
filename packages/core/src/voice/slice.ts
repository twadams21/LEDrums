/**
 * Slice — the 3D sibling of {@link ./splice}. Where a splice cuts each hoop into bands AROUND
 * it, a slice cuts the kit into parallel slabs THROUGH space: pick an axis, tilt it, and every
 * pixel falls into a slab by where it sits in the room rather than where it sits on its hoop.
 *
 * Everything that is not geometry is Splice's, deliberately: the same config, colour/effect
 * members, envelope, motion modes, wait modes and cascade maths. A slice is a `SpliceConfig`
 * carrying a {@link SliceSpace}, so eval, the voice pool and the engine's cascade shaping all
 * run unchanged — only the compositor asks which geometry it is drawing.
 *
 * The one real difference is that a slice has no 1D order to carry material along. A hoop is
 * a strip of pixels, so a splice can slide its content round it; a slab is a region of space
 * with pixels scattered through it. So a slice REVEALS what an effect renders underneath it
 * rather than carrying it, and all motion is expressed as a phase along the slicing axis.
 *
 * Pure and deterministic: no IO, no wall clock, no `Math.random` — jitter comes from the same
 * seeded bands a splice uses.
 */
import type { PixelModel } from '../geometry/pixel-model';
import type { Vec3 } from '../math';
import type { PixelRange } from '../modifiers/types';
import type { SpliceNode, SliceAxis, SliceRegion, SliceSpace, SpliceConfig } from './types';
import type { ResolvedSplices } from './splice';
import { clamp01 } from '../math';
import {
  chaseStepOffset,
  colorCascadeDelayMs,
  computeSpliceBands,
  resolveSplices,
  sequenceRanks,
  spliceOrderIndex,
  unitEnvelopeLevel,
  unitFadeInLevel,
  unitMotionAge,
  wrapIndex,
} from './splice';

export const DEFAULT_SLICE_AXIS: SliceAxis = 'x';
/** Velocity sensitivity default: fully on. A drum light that ignores how hard it was hit is
    the exception, and this is the node that was asked for BECAUSE it should respond. */
export const DEFAULT_SLICE_VELOCITY = 1;
/** Stagger jump, as a percentage of the slicing span — mm would read differently on every kit. */
export const DEFAULT_SLICE_INCREMENT_PCT = 10;
export const MAX_SLICE_INCREMENT_PCT = 100;

/**
 * Resolution the fractional band boundaries are cut at. The splice band cutter works in whole
 * pixels; cutting a span of this many "units" and dividing back gives fractional boundaries
 * with EXACTLY the same seeded jitter, so a slice and a splice given one seed vary alike.
 */
const BAND_RESOLUTION = 100000;

const AXIS_UNIT: Record<SliceAxis, Vec3> = {
  x: { x: 1, y: 0, z: 0 },
  y: { x: 0, y: 1, z: 0 },
  z: { x: 0, y: 0, z: 1 },
};

const rad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * The unit vector the slabs are stacked along — the chosen axis, tilted by `rx`, `ry`, `rz`
 * degrees about the world X, Y and Z axes, in that order. The slab faces are perpendicular to it.
 *
 * Fixed X → Y → Z order so a given triple always means the same tilt; three independent dials
 * are what "rotate the slice angle on any axis" asks for, and a fixed order is what makes them
 * reproducible.
 */
export function sliceDirection(axis: SliceAxis, rx: number, ry: number, rz: number): Vec3 {
  let { x, y, z } = AXIS_UNIT[axis] ?? AXIS_UNIT.x;
  if (rx) {
    const c = Math.cos(rad(rx));
    const s = Math.sin(rad(rx));
    [y, z] = [y * c - z * s, y * s + z * c];
  }
  if (ry) {
    const c = Math.cos(rad(ry));
    const s = Math.sin(rad(ry));
    [x, z] = [x * c + z * s, -x * s + z * c];
  }
  if (rz) {
    const c = Math.cos(rad(rz));
    const s = Math.sin(rad(rz));
    [x, y] = [x * c - y * s, x * s + y * c];
  }
  const len = Math.hypot(x, y, z) || 1;
  return { x: x / len, y: y / len, z: z / len };
}

/** Wrap an angle into [0, 360) — 370° is 10°, and a negative tilt reads backwards. */
const wrapDeg = (deg: number): number => ((deg % 360) + 360) % 360;

/** A region's half-extents must be positive, or the box contains nothing and the node looks dead. */
const MIN_REGION_MM = 1;

/** Build the {@link SliceSpace} a slice node's fields describe. */
export function resolveSliceSpace(node: SpliceNode): SliceSpace {
  const axis = node.sliceAxis ?? DEFAULT_SLICE_AXIS;
  const rotation = {
    x: wrapDeg(node.sliceRotX ?? 0),
    y: wrapDeg(node.sliceRotY ?? 0),
    z: wrapDeg(node.sliceRotZ ?? 0),
  };
  const r = node.sliceRegion;
  const region: SliceRegion | undefined = r
    ? {
        min: {
          x: r.cx - Math.max(MIN_REGION_MM, r.sx) / 2,
          y: r.cy - Math.max(MIN_REGION_MM, r.sy) / 2,
          z: r.cz - Math.max(MIN_REGION_MM, r.sz) / 2,
        },
        max: {
          x: r.cx + Math.max(MIN_REGION_MM, r.sx) / 2,
          y: r.cy + Math.max(MIN_REGION_MM, r.sy) / 2,
          z: r.cz + Math.max(MIN_REGION_MM, r.sz) / 2,
        },
      }
    : undefined;
  const pct = Math.min(MAX_SLICE_INCREMENT_PCT, Math.max(0, node.sliceIncrementPct ?? DEFAULT_SLICE_INCREMENT_PCT));
  return {
    direction: sliceDirection(axis, rotation.x, rotation.y, rotation.z),
    region,
    velocity: clamp01(node.sliceVelocity ?? DEFAULT_SLICE_VELOCITY),
    incrementFrac: pct / 100,
  };
}

/**
 * Resolve a slice node: exactly a splice resolution — members, envelope, motion, chases — with
 * its geometry attached. Going THROUGH `resolveSplices` rather than beside it is what keeps the
 * two nodes from drifting: a fix to how a splice resolves its chase rate is a fix to both.
 *
 * DRUM CHASE is always live on a slice. A splice zeroes it off the hoop partition because there
 * the primary axis already IS the drum; a slice has no partition, so the drum axis is always its
 * own. A slice node never sets `splicePartition`, which leaves the splice default (`'hoop'`) in
 * place and the drum offset intact — asserted in the tests rather than assumed.
 */
export function resolveSlice(node: SpliceNode, bpm: number, beatsPerBar = 4): ResolvedSplices | null {
  const resolved = resolveSplices(node, bpm, beatsPerBar);
  if (!resolved) return null;
  return { ...resolved, config: { ...resolved.config, space: resolveSliceSpace(node) } };
}

/** Whether a world position sits inside a region box (inclusive — a pixel on the face counts). */
export function insideRegion(p: Vec3, region: SliceRegion): boolean {
  return (
    p.x >= region.min.x && p.x <= region.max.x &&
    p.y >= region.min.y && p.y <= region.max.y &&
    p.z >= region.min.z && p.z <= region.max.z
  );
}

const dot = (p: Vec3, d: Vec3): number => p.x * d.x + p.y * d.y + p.z * d.z;

/** One slab, as a fraction [start, end) of the slicing span. */
export interface SliceBand {
  start: number;
  end: number;
}

/**
 * Everything about a slice voice that does not move: which pixels are in it, where each sits
 * along the slicing axis, which drum each belongs to, and where the slabs are cut. Built once
 * per voice and cached — the per-frame work is then a band lookup per pixel.
 */
export interface SliceLayout {
  /** Frame-buffer ids of the in-scope pixels. */
  ids: Int32Array;
  /** Each pixel's position along the slicing axis, 0 (one end of the span) .. <1 (the other). */
  t: Float32Array;
  /** Each pixel's drum ordinal (0-based, in model order) — what DRUM CHASE staggers on. */
  drumOrdinal: Int16Array;
  drumCount: number;
  /** Drum ids in model order, indexed by {@link drumOrdinal} — what a dragged drum sequence ranks. */
  drumIds: string[];
  /** THROUGH KIT's dragged drum order as a rank per drum ordinal, or null to follow the pattern. */
  drumRank: number[] | null;
  bands: SliceBand[];
  /** Per-drum motion scratch, reused every frame: the walk runs per voice per frame, so it
      allocates nothing. `drumReady` is cleared at the start of each walk. */
  phaseByDrum: Float64Array;
  stepByDrum: Int32Array;
  delayByDrum: Float64Array;
  drumReady: Uint8Array;
}

/** Identity of a slice layout: everything {@link buildSliceLayout} reads, and nothing that moves. */
export function sliceLayoutKey(cfg: SpliceConfig, model: PixelModel, ranges: readonly PixelRange[]): string {
  const s = cfg.space!;
  const d = s.direction;
  let key = `slice|${cfg.count}|${cfg.jitter}|${cfg.seed}|${d.x.toFixed(6)},${d.y.toFixed(6)},${d.z.toFixed(6)}|${model.pixelCount}`;
  if (s.region) {
    const { min, max } = s.region;
    key += `|${min.x},${min.y},${min.z},${max.x},${max.y},${max.z}`;
  }
  if (cfg.drumSequence) key += `|d:${cfg.drumSequence.join(',')}`;
  for (const range of ranges) key += `|${range.start}-${range.end}`;
  return key;
}

/**
 * Lay out a slice voice. The span is the in-scope pixels' own extent along the axis for a kit
 * or drum slice — so the slabs fit exactly what can light — and the REGION's extent for a
 * space slice, so a box means a fixed piece of the room however many pixels happen to be in it.
 */
export function buildSliceLayout(model: PixelModel, ranges: readonly PixelRange[], cfg: SpliceConfig): SliceLayout {
  const space = cfg.space!;
  const d = space.direction;
  const ids: number[] = [];
  const along: number[] = [];
  const ordinals: number[] = [];
  const drumOrdinal = new Map<string, number>();
  model.drums.forEach((drum, i) => drumOrdinal.set(drum.drumId, i));

  for (const range of ranges) {
    for (let id = range.start; id < range.end; id++) {
      const p = model.pixels[id];
      if (!p) continue;
      if (space.region && !insideRegion(p.world, space.region)) continue;
      ids.push(id);
      along.push(dot(p.world, d));
      ordinals.push(drumOrdinal.get(p.drumId) ?? 0);
    }
  }

  let lo = Infinity;
  let hi = -Infinity;
  if (space.region) {
    // The box's own extent along the axis: its 8 corners bound it.
    const { min, max } = space.region;
    for (const x of [min.x, max.x]) {
      for (const y of [min.y, max.y]) {
        for (const z of [min.z, max.z]) {
          const v = dot({ x, y, z }, d);
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
    }
  } else {
    for (const v of along) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  const span = hi - lo;

  const t = new Float32Array(ids.length);
  for (let i = 0; i < ids.length; i++) {
    // A flat span (every pixel on one plane) puts everything in the first slab rather than
    // dividing by zero; `< 1` keeps the far face in the last slab, not wrapping to the first.
    const raw = span > 0 ? (along[i]! - lo) / span : 0;
    t[i] = raw >= 1 ? 1 - 1e-7 : raw < 0 ? 0 : raw;
  }

  const cut = computeSpliceBands(BAND_RESOLUTION, cfg.count, cfg.jitter, cfg.seed);
  const bands = cut.map((b) => ({ start: b.start / BAND_RESOLUTION, end: (b.start + b.width) / BAND_RESOLUTION }));

  const drumCount = Math.max(1, model.drums.length);
  const drumIds = Array.from(drumOrdinal.keys());
  return {
    ids: Int32Array.from(ids),
    t,
    drumOrdinal: Int16Array.from(ordinals),
    drumCount,
    drumIds,
    drumRank: cfg.drumSequence ? sequenceRanks(drumIds, cfg.drumSequence) : null,
    bands,
    phaseByDrum: new Float64Array(drumCount),
    stepByDrum: new Int32Array(drumCount),
    delayByDrum: new Float64Array(drumCount),
    drumReady: new Uint8Array(drumCount),
  };
}

/** The band a position falls in. Bands are few (≤ 64), so a linear scan beats a search here. */
function bandAt(bands: readonly SliceBand[], t: number): number {
  for (let b = 0; b < bands.length; b++) if (t < bands[b]!.end) return b;
  return bands.length - 1;
}

/**
 * The fractional width a smudge crossfades across — the slice counterpart of
 * {@link import('./splice').spliceFeatherPx}: a fraction of the average slab, clamped to the
 * narrowest one so a crossfade never spans two boundaries at once.
 */
export function sliceFeather(smudge: number, bands: readonly SliceBand[]): number {
  const amount = clamp01(smudge);
  if (amount <= 0 || bands.length === 0) return 0;
  let narrowest = Infinity;
  for (const b of bands) {
    const w = b.end - b.start;
    if (w > 0 && w < narrowest) narrowest = w;
  }
  if (!Number.isFinite(narrowest)) return 0;
  return Math.min(amount / bands.length, narrowest);
}

/**
 * The phase the slab pattern has travelled along the axis at `ageMs`, as a fraction of the span.
 * `'smooth'` covers one whole span per interval; `'stagger'` jumps a fixed fraction per interval
 * and holds between jumps. `'step'` does not move the geometry at all — it moves the CONTENT, which
 * {@link chaseStepOffset} covers — so it and `'off'` return 0.
 */
export function slicePhase(ageMs: number, cfg: SpliceConfig): number {
  if (!(cfg.chaseMs > 0) || !Number.isFinite(ageMs) || ageMs < 0) return 0;
  if (cfg.chase === 'smooth') return (ageMs / cfg.chaseMs) * cfg.direction;
  if (cfg.chase === 'stagger') return Math.floor(ageMs / cfg.chaseMs) * (cfg.space?.incrementFrac ?? 0) * cfg.direction;
  return 0;
}

/** The clocks a frame of a slice voice is drawn against — computed once by the compositor. */
export interface SliceClocks {
  /** The voice's own age: what cascade REVEALS count from. */
  ageMs: number;
  /** The motion clock the mode selects (age, engine time, or the latched accumulator). */
  motionMs: number;
  /** A repeating pulse's cycle length, or 0 for a single pulse. */
  pulseCycleMs: number;
}

/**
 * Walk every in-scope pixel's contributions for one frame: which slot it shows and at what
 * weight. A pixel inside a slab shows one slot at full weight; inside a smudge it shows two whose
 * weights sum to 1. The weight already carries the per-slab envelope (dark / fade / pulse) and the
 * hit's velocity, so the caller only samples, tints and accumulates — in whatever buffer format it
 * owns. That split is what lets the engine and the web preview share every line of the timing and
 * geometry instead of keeping two copies in step by hand.
 */
export function forEachSliceContribution(
  layout: SliceLayout,
  cfg: SpliceConfig,
  clocks: SliceClocks,
  velocity: number,
  visit: (pixelId: number, slot: number, weight: number) => void,
): void {
  const { bands } = layout;
  const count = bands.length;
  if (count === 0) return;
  const space = cfg.space;
  // Velocity scales the light, not the timing: a soft hit is a dimmer slice, never a slower one.
  const gain = space ? 1 - space.velocity + space.velocity * clamp01(velocity) : 1;
  if (gain <= 0) return;
  const half = sliceFeather(cfg.smudge, bands) / 2;

  // Per-drum motion is computed lazily and cached per frame: DRUM CHASE delays each drum's clock,
  // so every pixel of one drum shares a phase and a step offset.
  const { phaseByDrum, stepByDrum, delayByDrum, drumReady: ready, drumRank } = layout;
  ready.fill(0);

  const levelFor = (reveal: number): number => {
    if (cfg.waitMode !== 'lit' && reveal > 0 && clocks.ageMs < reveal) return 0;
    if (cfg.waitMode === 'pulse') {
      const own = clocks.pulseCycleMs > 0 ? (clocks.ageMs - reveal) % clocks.pulseCycleMs : clocks.ageMs - reveal;
      return unitEnvelopeLevel(own, cfg.envelope.attackMs, cfg.envelope.sustainMs, cfg.envelope.releaseMs, cfg.attackEase);
    }
    if (cfg.waitMode === 'fade') return unitFadeInLevel(clocks.ageMs - reveal, cfg.envelope.attackMs, cfg.attackEase);
    return 1;
  };

  const emit = (pixelId: number, band: number, drumDelay: number, step: number, weight: number): void => {
    if (weight <= 0) return;
    const slot = wrapIndex(band - step, count);
    // A slab's reveal: its drum's turn, then its own place in SLICE CHASE, then its colour's.
    const reveal =
      drumDelay +
      spliceOrderIndex(band, count, cfg.order, cfg.seed) * cfg.offsetMs +
      colorCascadeDelayMs(slot, cfg);
    const level = levelFor(reveal);
    if (level > 0) visit(pixelId, slot, weight * level * gain);
  };

  for (let i = 0; i < layout.ids.length; i++) {
    const drum = layout.drumOrdinal[i]!;
    if (!ready[drum]) {
      const rank = drumRank ? drumRank[drum] ?? drum : spliceOrderIndex(drum, layout.drumCount, cfg.drumOrder, cfg.seed);
      const delay = rank * cfg.drumOffsetMs;
      const age = unitMotionAge(clocks.motionMs, delay);
      delayByDrum[drum] = delay;
      phaseByDrum[drum] = slicePhase(age, cfg);
      stepByDrum[drum] = cfg.chase === 'step' ? chaseStepOffset(age, cfg.chaseMs, cfg.direction) : 0;
      ready[drum] = 1;
    }
    const phase = phaseByDrum[drum]!;
    // Moving forward carries the pattern UP the axis, so a pixel reads the slab that was below it.
    let t = layout.t[i]! - phase;
    t -= Math.floor(t);
    const band = bandAt(bands, t);
    const { start, end } = bands[band]!;
    const delay = delayByDrum[drum]!;
    const step = stepByDrum[drum]!;
    const id = layout.ids[i]!;

    if (half > 0 && t - start < half) {
      const own = 0.5 + 0.5 * ((t - start) / half);
      emit(id, band, delay, step, own);
      emit(id, wrapIndex(band - 1, count), delay, step, 1 - own);
    } else if (half > 0 && end - t < half) {
      const own = 0.5 + 0.5 * ((end - t) / half);
      emit(id, band, delay, step, own);
      emit(id, wrapIndex(band + 1, count), delay, step, 1 - own);
    } else {
      emit(id, band, delay, step, 1);
    }
  }
}

import { hexToHsv, hexToRgb, hsvToRgb, type Rgb } from '../../color/color';
import { clamp01, mulberry32, wrap, type Vec3 } from '../../math';
import { getHoopPixelRange, type PixelModel } from '../../geometry/pixel-model';
import { pnum, pstr, type EffectGenerator, type ResolvedParams } from '../types';

/*
 * Dot (Tim, 2026-10-03): small pulses — as little as one pixel — that travel in set directions
 * and speeds around a hoop, up a drum, across the kit or straight through 3D space, or sit still
 * and twinkle. Each dot has its own Lifespan; the Effect's brightness envelope is the master
 * over them all, so a dot ends at whichever comes first. "Max live" (dots alive across hits) is
 * enforced in two places: within a voice here, and across hits by the engine, which cuts the
 * oldest hits' voices (see {@link dotLiveVoices}).
 *
 * Voice timebase: motion integrates `ctx.dt` into per-voice state seeded from the voice's seed,
 * like Comet Trails, so every hit replays its own dots and nothing leaks between voices.
 */

type Through = 'hoop' | 'drum' | 'kit' | 'space';
type Bounce = 'wrap' | 'bounce' | 'random' | 'pingpong';

interface Dot {
  /** Spawn index — drives the alternate direction, the even spacing and the rainbow hue. */
  slot: number;
  /** Voice age at birth (ms). */
  bornMs: number;
  /** Index into `model.drums`. */
  drum: number;
  /** 0-based hoop. */
  hoop: number;
  /** Position around the ring, 0..1 (angle-mapped, so it carries across hoops of any size). */
  u: number;
  /** Travel around the ring: +1 / -1. */
  dir: number;
  /** Through a drum: the hoop step. Across the kit: the step through the drum order. */
  step: number;
  /** Pixels travelled toward the next lap (a lap moves it to the next hoop / drum). */
  lapPx: number;
  /** Pixels travelled in all (Ping-pong: the distance along its back-and-forth). */
  runPx: number;
  /** Where Ping-pong swings from: the start position, heading and (in space) point. */
  u0: number;
  dir0: number;
  p0: Vec3;
  v0: Vec3;
  /** Voice age of the next random turn (Random bounce on a hoop). */
  turnAtMs: number;
  /** Hue offset in degrees (Rainbow / Random colour). */
  hue: number;
  /** Through space: world position (mm) and unit heading. */
  p: Vec3;
  v: Vec3;
}

export interface DotState {
  dots: Dot[];
  /** Dots spawned so far this voice (the stream's cursor). */
  spawned: number;
  rng: () => number;
  /** Mean pixel spacing (mm) — turns px sizes and speeds into mm for Through space. */
  pitchMm: number;
  /** Nearest-neighbour tour of the drums (Across the kit, Nearest order). */
  tour: number[];
  /** Per-pixel scratch: the strongest dot coverage and its colour this frame. */
  cov: Float32Array;
  col: Float32Array;
}

const SEED = 0xd07d07;

/** Signed ring distance from `from` to `to` on a ring of `n` pixels, in [-n/2, n/2). */
function ringDelta(from: number, to: number, n: number): number {
  return wrap(to - from + n / 2, n) - n / 2;
}

function hoopCount(model: PixelModel, drum: number): number {
  return Math.max(1, model.drums[drum]?.hoopCount ?? 1);
}

function hoopSize(model: PixelModel, drum: number, hoop: number): number {
  return Math.max(1, model.drums[drum]?.hoopPixelCounts[hoop] ?? 1);
}

/** Greedy nearest-neighbour tour of the drums from the first, by effect origin. */
function nearestTour(model: PixelModel): number[] {
  const left = model.drums.map((_, i) => i);
  if (!left.length) return [];
  const tour = [left.shift()!];
  while (left.length) {
    const at = model.drums[tour[tour.length - 1]!]!.effectOriginWorld;
    let best = 0;
    let bestD = Infinity;
    left.forEach((i, k) => {
      const o = model.drums[i]!.effectOriginWorld;
      const d = (o.x - at.x) ** 2 + (o.y - at.y) ** 2 + (o.z - at.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    });
    tour.push(left.splice(best, 1)[0]!);
  }
  return tour;
}

function meanPitch(model: PixelModel): number {
  let sum = 0;
  let n = 0;
  for (const p of model.pixels) {
    if (p.segmentLengthMm > 0) {
      sum += p.segmentLengthMm;
      n++;
    }
  }
  return n ? sum / n : 16;
}

function randomUnit(rng: () => number): Vec3 {
  const z = rng() * 2 - 1;
  const a = rng() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return { x: r * Math.cos(a), y: r * Math.sin(a), z };
}

/** The ring pixel a dot sits nearest (for Through space's start point and heading). */
function ringPixel(model: PixelModel, drum: number, hoop: number, u: number): number | null {
  const info = model.drums[drum];
  if (!info) return null;
  const range = getHoopPixelRange(model, info.drumId, hoop + 1);
  if (!range || range.end <= range.start) return null;
  const n = range.end - range.start;
  return range.start + (Math.floor(wrap(u, 1) * n) % n);
}

/** Dots alive in one voice, after the velocity amount and the Max live cap. */
function voiceCount(params: ResolvedParams, velocity: number): number {
  const count = Math.max(1, Math.round(pnum(params, 'count', 1)));
  const vel = clamp01(pnum(params, 'velCount', 0));
  const scaled = Math.max(1, Math.round(count * (1 - vel + vel * clamp01(velocity))));
  const cap = Math.round(pnum(params, 'maxLive', 0));
  return cap > 0 ? Math.min(scaled, cap) : scaled;
}

/**
 * How many EARLIER voices of the same Effect may stay alive when a new hit fires, so the dots
 * alive across hits stay within Max live — or `undefined` when there is no cap. Counted at the
 * dots-per-hit before velocity, so the cap never lets a loud hit overshoot it.
 */
export function dotLiveVoices(params: ResolvedParams): number | undefined {
  const cap = Math.round(pnum(params, 'maxLive', 0));
  if (cap <= 0) return undefined;
  const perHit = Math.max(1, Math.round(pnum(params, 'count', 1)));
  return Math.max(0, Math.floor(cap / perHit) - 1);
}

function spawnDot(ctx: Parameters<EffectGenerator['render']>[0], params: ResolvedParams, state: DotState, slot: number, bornMs: number, count: number): Dot | null {
  const model = ctx.model;
  const drums = model.drums;
  if (!drums.length) return null;
  const rng = state.rng;
  const struckId = ctx.triggers[0]?.drumId ?? '';
  const struck = drums.findIndex((d) => d.drumId === struckId);
  const startDrum = Math.round(pnum(params, 'startDrum', 0));
  const chosen = startDrum >= 1 ? Math.min(drums.length, startDrum) - 1 : struck >= 0 ? struck : 0;
  const start = pstr(params, 'start', 'hit');
  const randomDrum = () => Math.floor(rng() * drums.length) % drums.length;

  let drum: number;
  let hoop: number;
  let u: number;
  if (start === 'random' || start === 'hit') {
    drum = start === 'hit' && struck >= 0 ? struck : randomDrum();
    hoop = Math.floor(rng() * hoopCount(model, drum)) % hoopCount(model, drum);
    // On a pixel, so a still one-pixel dot is exactly one pixel.
    const n = hoopSize(model, drum, hoop);
    u = (Math.floor(rng() * n) % n) / n;
  } else {
    drum = chosen;
    hoop = Math.min(hoopCount(model, drum), Math.max(1, Math.round(pnum(params, 'startHoop', 1)))) - 1;
    u = wrap(pnum(params, 'startAngle', 0) / 360 + (start === 'even' ? slot / Math.max(1, count) : 0), 1);
  }

  const direction = pstr(params, 'direction', 'forward');
  const sign = direction === 'reverse' ? -1
    : direction === 'random' ? (rng() < 0.5 ? -1 : 1)
    : direction === 'alternate' ? (slot % 2 ? -1 : 1)
    : 1;

  const colorMode = pstr(params, 'colorMode', 'single');
  const hue = colorMode === 'rainbow' ? (slot * 360) / Math.max(1, count) : colorMode === 'random' ? rng() * 360 : 0;

  const at = ringPixel(model, drum, hoop, u);
  const pixel = at === null ? null : model.pixels[at]!;
  const p = pixel ? { ...pixel.world } : { ...model.bounds.center };
  let v: Vec3;
  const t = pixel?.tangent;
  if (direction === 'random' || !t || t.x * t.x + t.y * t.y + t.z * t.z < 1e-9) v = randomUnit(rng);
  else v = { x: t.x * sign, y: t.y * sign, z: t.z * sign };

  return {
    slot, bornMs, drum, hoop, u, dir: sign, step: sign, lapPx: 0, runPx: 0,
    u0: u, dir0: sign, p0: { ...p }, v0: { ...v },
    turnAtMs: bornMs + 400 + rng() * 1200, hue, p, v,
  };
}

/** A dot's speed multiplier from Accel over its life: −1 slows to a stop, +1 ends 3× faster. */
function accelMult(accel: number, lifeFrac: number): number {
  const a = Math.max(-1, Math.min(1, accel));
  return a >= 0 ? 1 + 2 * a * lifeFrac : Math.max(0, 1 + a * lifeFrac);
}

/** The next drum across the kit, or the same drum when the kit has one. */
function nextKitDrum(model: PixelModel, state: DotState, dot: Dot, order: string, bounce: Bounce): number {
  const count = model.drums.length;
  if (count <= 1) return dot.drum;
  if (order === 'random' || bounce === 'random') {
    const pick = Math.floor(state.rng() * (count - 1)) % (count - 1);
    return pick >= dot.drum ? pick + 1 : pick;
  }
  const seq = order === 'nearest' ? state.tour : model.drums.map((_, i) => i);
  const at = Math.max(0, seq.indexOf(dot.drum));
  let next = at + dot.step;
  if (next < 0 || next >= count) {
    if (bounce === 'wrap') next = wrap(next, count);
    else {
      dot.step = -dot.step;
      next = at + dot.step;
    }
  }
  return seq[next]!;
}

/** One lap done through a drum: step to the next hoop, turning or wrapping at the ends. */
function nextHoop(model: PixelModel, state: DotState, dot: Dot, bounce: Bounce): number {
  const count = hoopCount(model, dot.drum);
  if (count <= 1) return 0;
  if (bounce === 'random') {
    const pick = Math.floor(state.rng() * (count - 1)) % (count - 1);
    return pick >= dot.hoop ? pick + 1 : pick;
  }
  let next = dot.hoop + dot.step;
  if (next < 0 || next >= count) {
    if (bounce === 'wrap') next = wrap(next, count);
    else {
      dot.step = -dot.step;
      next = dot.hoop + dot.step;
    }
  }
  return next;
}

/** Ping-pong: how far along its stretch a dot is after `run` px, and which way it is heading. */
function swing(run: number, span: number): { at: number; heading: number } {
  const m = wrap(run, 2 * span);
  return m < span ? { at: m, heading: 1 } : { at: 2 * span - m, heading: -1 };
}

function moveOnRings(model: PixelModel, state: DotState, dot: Dot, px: number, ageMs: number, through: Through, bounce: Bounce, span: number, order: string): void {
  if (px <= 0) return;
  const n = hoopSize(model, dot.drum, dot.hoop);
  if (bounce === 'pingpong') {
    // Back and forth over Span from where it started, staying on its hoop.
    dot.runPx += px;
    const { at, heading } = swing(dot.runPx, span);
    dot.dir = dot.dir0 * heading;
    dot.u = wrap(dot.u0 + (dot.dir0 * at) / n, 1);
    return;
  }
  if (bounce === 'random' && through === 'hoop' && ageMs >= dot.turnAtMs) {
    if (state.rng() < 0.5) dot.dir = -dot.dir;
    dot.turnAtMs = ageMs + 400 + state.rng() * 1200;
  }
  dot.u = wrap(dot.u + (dot.dir * px) / n, 1);
  // Every full lap moves the dot on to the next hoop / drum.
  if (through === 'hoop') return;
  dot.lapPx += px;
  while (dot.lapPx >= hoopSize(model, dot.drum, dot.hoop)) {
    dot.lapPx -= hoopSize(model, dot.drum, dot.hoop);
    if (through === 'drum') dot.hoop = nextHoop(model, state, dot, bounce);
    else {
      dot.drum = nextKitDrum(model, state, dot, order, bounce);
      dot.hoop = Math.min(dot.hoop, hoopCount(model, dot.drum) - 1);
    }
  }
}

function moveInSpace(model: PixelModel, state: DotState, dot: Dot, px: number, bounce: Bounce, span: number): void {
  if (px <= 0) return;
  const mm = px * state.pitchMm;
  if (bounce === 'pingpong') {
    dot.runPx += px;
    const { at, heading } = swing(dot.runPx, span);
    const { p0, v0 } = dot;
    const d = at * state.pitchMm;
    dot.p = { x: p0.x + v0.x * d, y: p0.y + v0.y * d, z: p0.z + v0.z * d };
    dot.v = { x: v0.x * heading, y: v0.y * heading, z: v0.z * heading };
    return;
  }
  const p = dot.p;
  p.x += dot.v.x * mm;
  p.y += dot.v.y * mm;
  p.z += dot.v.z * mm;
  const { min, max } = model.bounds;
  let hit = false;
  for (const axis of ['x', 'y', 'z'] as const) {
    const lo = min[axis];
    const hi = max[axis];
    if (hi - lo < 1e-6) continue;
    if (p[axis] >= lo && p[axis] <= hi) continue;
    hit = true;
    if (bounce === 'wrap') p[axis] = p[axis] < lo ? hi - (lo - p[axis]) : lo + (p[axis] - hi);
    else {
      p[axis] = p[axis] < lo ? lo + (lo - p[axis]) : hi - (p[axis] - hi);
      dot.v[axis] = -dot.v[axis];
    }
    p[axis] = Math.min(hi, Math.max(lo, p[axis]));
  }
  if (hit && bounce === 'random') {
    // A random new heading, kept pointing back into the kit.
    const c = model.bounds.center;
    const r = randomUnit(state.rng);
    const inward = (c.x - p.x) * r.x + (c.y - p.y) * r.y + (c.z - p.z) * r.z;
    dot.v = inward >= 0 ? r : { x: -r.x, y: -r.y, z: -r.z };
  }
}

/** Dots meeting head-on on the same hoop turn back (Bounce, on the rings). */
function collide(model: PixelModel, dots: readonly Dot[], gap: number): void {
  for (let i = 0; i < dots.length; i++) {
    const a = dots[i]!;
    for (let j = i + 1; j < dots.length; j++) {
      const b = dots[j]!;
      if (a.drum !== b.drum || a.hoop !== b.hoop || a.dir === b.dir) continue;
      const n = hoopSize(model, a.drum, a.hoop);
      const rel = ringDelta(a.u * n, b.u * n, n);
      if (Math.abs(rel) <= gap && a.dir * rel > 0) {
        a.dir = -a.dir;
        b.dir = -b.dir;
      }
    }
  }
}

function lerpRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

/** Write a coverage into the scratch, keeping the strongest dot's colour per pixel. */
function stamp(state: DotState, pixel: number, v: number, rgb: Rgb): void {
  if (v <= state.cov[pixel]!) return;
  state.cov[pixel] = v;
  const i = pixel * 3;
  state.col[i] = rgb.r;
  state.col[i + 1] = rgb.g;
  state.col[i + 2] = rgb.b;
}

function drawOnRings(model: PixelModel, state: DotState, dot: Dot, level: number, rgb: Rgb, length: number, height: number, form: string, trail: number): void {
  const info = model.drums[dot.drum];
  if (!info) return;
  const lo = -Math.floor((height - 1) / 2);
  const halfH = (height - 1) / 2;
  const half = length / 2;
  for (let off = lo; off < lo + height; off++) {
    const hoop = dot.hoop + off;
    if (hoop < 0 || hoop >= info.hoopCount) continue;
    const range = getHoopPixelRange(model, info.drumId, hoop + 1);
    if (!range || range.end <= range.start) continue;
    const n = range.end - range.start;
    const c = dot.u * n;
    // Half the length on this row: a Dot rounds its ends, a Diamond tapers, a Bar is square.
    const across = halfH > 0 ? Math.abs(off) / (halfH + 1) : 0;
    const rowHalf = form === 'diamond' ? half * (1 - across)
      : form === 'dot' ? half * Math.sqrt(Math.max(0, 1 - across * across))
      : half;
    const reach = rowHalf + trail + 1;
    const whole = 2 * reach + 1 >= n;
    const from = whole ? 0 : Math.floor(c - reach);
    const to = whole ? n - 1 : Math.ceil(c + reach);
    for (let j = from; j <= to; j++) {
      const idx = wrap(j, n);
      const d = whole ? ringDelta(c, idx, n) : j - c;
      let b: number;
      if (form === 'bar') {
        const first = Math.round(c - (length - 1) / 2);
        const k = whole ? wrap(idx - first, n) : j - first;
        b = k >= 0 && k < length ? 1 : 0;
      } else {
        b = clamp01(rowHalf + 0.5 - Math.abs(d));
      }
      if (trail > 0) {
        const behind = -dot.dir * d - rowHalf;
        if (behind > 0 && behind <= trail) {
          const f = 1 - behind / trail;
          b = Math.max(b, f * f * 0.8);
        }
      }
      if (b > 0) stamp(state, range.start + idx, b * level, rgb);
    }
  }
}

function drawInSpace(model: PixelModel, state: DotState, dot: Dot, level: number, rgb: Rgb, length: number, trail: number): void {
  const pitch = state.pitchMm;
  const radius = Math.max(length / 2, 0.6) * pitch;
  const tail = trail * pitch;
  const reach = radius + tail + pitch;
  const reach2 = reach * reach;
  const { p, v } = dot;
  for (let i = 0; i < model.pixels.length; i++) {
    const w = model.pixels[i]!.world;
    const dx = w.x - p.x;
    const dy = w.y - p.y;
    const dz = w.z - p.z;
    const dist2 = dx * dx + dy * dy + dz * dz;
    if (dist2 > reach2) continue;
    const dist = Math.sqrt(dist2);
    let b = clamp01((radius + pitch / 2 - dist) / pitch);
    if (tail > 0) {
      const behind = -(dx * v.x + dy * v.y + dz * v.z);
      if (behind > 0 && behind <= tail) {
        const perp = Math.sqrt(Math.max(0, dist2 - behind * behind));
        const f = 1 - behind / tail;
        b = Math.max(b, clamp01((radius + pitch / 2 - perp) / pitch) * f * f * 0.8);
      }
    }
    if (b > 0) stamp(state, i, b * level, rgb);
  }
}

export const dot: EffectGenerator<DotState> = {
  id: 'dot',
  name: 'Dot',
  category: 'particle',
  timebase: 'voice',
  liveVoices: dotLiveVoices,
  paramSpec: [
    // Dots
    { key: 'count', label: 'Dots', type: 'number', default: 1, min: 1, max: 64, step: 1 },
    { key: 'spawn', label: 'Spawn', type: 'enum', default: 'together', options: ['together', 'stagger', 'stream'] },
    { key: 'interval', label: 'Interval', type: 'number', default: 250, min: 10, max: 4000, step: 1, unit: 'ms' },
    { key: 'start', label: 'Start', type: 'enum', default: 'hit', options: ['hit', 'random', 'fixed', 'even'] },
    { key: 'startDrum', label: 'Start drum', type: 'number', default: 0, min: 0, max: 16, step: 1 },
    { key: 'startHoop', label: 'Start hoop', type: 'number', default: 1, min: 1, max: 8, step: 1 },
    { key: 'startAngle', label: 'Start angle', type: 'number', default: 0, min: 0, max: 360, step: 1, unit: '°' },
    { key: 'maxLive', label: 'Max live', type: 'number', default: 0, min: 0, max: 256, step: 1 },
    { key: 'life', label: 'Lifespan', type: 'number', default: 0, min: 0, max: 20000, step: 10, unit: 'ms' },
    { key: 'fade', label: 'Fade', type: 'number', default: 0.15, min: 0, max: 0.5, step: 0.01 },
    // Shape
    { key: 'length', label: 'Length', type: 'number', default: 1, min: 1, max: 32, step: 1, unit: 'px' },
    { key: 'height', label: 'Height', type: 'number', default: 1, min: 1, max: 5, step: 1, unit: 'hoops' },
    { key: 'form', label: 'Shape', type: 'enum', default: 'dot', options: ['dot', 'bar', 'diamond'] },
    { key: 'trail', label: 'Trail', type: 'number', default: 0, min: 0, max: 64, step: 1, unit: 'px' },
    // Move around
    { key: 'speed', label: 'Speed', type: 'number', default: 40, min: 0, max: 400, step: 1, unit: 'px/s' },
    { key: 'speedPer', label: 'Speed per', type: 'enum', default: 'second', options: ['second', 'beat'] },
    { key: 'direction', label: 'Direction', type: 'enum', default: 'forward', options: ['forward', 'reverse', 'random', 'alternate'] },
    { key: 'bounce', label: 'Bounce', type: 'enum', default: 'wrap', options: ['wrap', 'bounce', 'random', 'pingpong'] },
    { key: 'span', label: 'Span', type: 'number', default: 12, min: 1, max: 200, step: 1, unit: 'px' },
    { key: 'accel', label: 'Accel', type: 'number', default: 0, min: -1, max: 1, step: 0.01 },
    // Move through
    { key: 'through', label: 'Through', type: 'enum', default: 'hoop', options: ['hoop', 'drum', 'kit', 'space'] },
    { key: 'kitOrder', label: 'Kit order', type: 'enum', default: 'kit', options: ['kit', 'nearest', 'random'] },
    // Colour
    { key: 'colorMode', label: 'Colours', type: 'enum', default: 'single', options: ['single', 'rainbow', 'random'] },
    { key: 'color', label: 'Colour', type: 'color', default: '#00e5ff' },
    { key: 'shift', label: 'Change', type: 'enum', default: 'off', options: ['off', 'to-colour', 'hue-cycle'] },
    { key: 'colorTo', label: 'To colour', type: 'color', default: '#ff2bd6' },
    { key: 'hueRate', label: 'Hue rate', type: 'number', default: 60, min: 0, max: 720, step: 1, unit: '°/s' },
    { key: 'background', label: 'Background', type: 'enum', default: 'none', options: ['none', 'same', 'other'] },
    { key: 'bgLevel', label: 'Bg level', type: 'number', default: 0.15, min: 0, max: 1, step: 0.01 },
    { key: 'bgColor', label: 'Bg colour', type: 'color', default: '#1a1440' },
    // Velocity
    { key: 'velSize', label: 'Vel → size', type: 'number', default: 0, min: 0, max: 1, step: 0.01 },
    { key: 'velSpeed', label: 'Vel → speed', type: 'number', default: 0, min: 0, max: 1, step: 0.01 },
    { key: 'velCount', label: 'Vel → dots', type: 'number', default: 0, min: 0, max: 1, step: 0.01 },
  ],
  createState(model: PixelModel, seed?: number): DotState {
    return {
      dots: [],
      spawned: 0,
      rng: mulberry32(seed ?? SEED),
      pitchMm: meanPitch(model),
      tour: nearestTour(model),
      cov: new Float32Array(model.pixelCount),
      col: new Float32Array(model.pixelCount * 3),
    };
  },
  render(ctx, params, fb, state) {
    const model = ctx.model;
    if (state.cov.length !== model.pixelCount) {
      state.cov = new Float32Array(model.pixelCount);
      state.col = new Float32Array(model.pixelCount * 3);
    }
    const ageMs = Math.max(0, ctx.timeMs);
    const velocity = clamp01(ctx.triggers[0]?.velocity ?? 1);
    const count = voiceCount(params, velocity);
    const spawn = pstr(params, 'spawn', 'together');
    const interval = Math.max(10, pnum(params, 'interval', 250));

    // Spawn what is due: all at once, one per interval up to the count, or a stream that keeps
    // the newest `count` (the oldest recycles).
    const due = spawn === 'together' ? count : Math.floor(ageMs / interval) + 1;
    const target = spawn === 'stream' ? due : Math.min(count, due);
    while (state.spawned < target) {
      const bornMs = spawn === 'together' ? 0 : state.spawned * interval;
      const d = spawnDot(ctx, params, state, state.spawned, bornMs, count);
      state.spawned++;
      if (d) state.dots.push(d);
    }
    if (spawn === 'stream') while (state.dots.length > count) state.dots.shift();
    const dots = spawn === 'stream' ? state.dots : state.dots.slice(0, count);

    const life = Math.max(0, pnum(params, 'life', 0));
    const fade = clamp01(pnum(params, 'fade', 0.15));
    const through = pstr(params, 'through', 'hoop') as Through;
    const bounce = pstr(params, 'bounce', 'wrap') as Bounce;
    const span = Math.max(1, pnum(params, 'span', 12));
    const order = pstr(params, 'kitOrder', 'kit');
    const accel = pnum(params, 'accel', 0);
    const velSpeed = clamp01(pnum(params, 'velSpeed', 0));
    const velSize = clamp01(pnum(params, 'velSize', 0));
    const perBeat = pstr(params, 'speedPer', 'second') === 'beat';
    const bpm = ctx.transport.bpm > 0 ? ctx.transport.bpm : 120;
    const pxPerSec = Math.max(0, pnum(params, 'speed', 40)) * (perBeat ? bpm / 60 : 1) * (1 - velSpeed + velSpeed * velocity);
    const sizeScale = 1 - velSize + velSize * velocity;
    const length = Math.max(1, Math.round(pnum(params, 'length', 1) * sizeScale));
    const height = Math.max(1, Math.min(5, Math.round(pnum(params, 'height', 1))));
    const form = pstr(params, 'form', 'dot');
    const trail = Math.max(0, pnum(params, 'trail', 0) * sizeScale);
    const dtSec = Math.max(0, ctx.dt) / 1000;

    const alive = (d: Dot) => d.bornMs <= ageMs && (life <= 0 || ageMs - d.bornMs < life);
    const lifeFrac = (d: Dot) => (life > 0 ? clamp01((ageMs - d.bornMs) / life) : clamp01((ageMs - d.bornMs) / 2000));

    // Move.
    for (const d of dots) {
      if (!alive(d)) continue;
      const px = pxPerSec * accelMult(accel, lifeFrac(d)) * dtSec;
      if (through === 'space') moveInSpace(model, state, d, px, bounce, span);
      else moveOnRings(model, state, d, px, ageMs - d.bornMs, through, bounce, span, order);
    }
    if (bounce === 'bounce' && through !== 'space' && pxPerSec > 0) collide(model, dots.filter(alive), Math.max(1, length));

    // Colour.
    const base = pstr(params, 'color', '#00e5ff');
    const baseHsv = hexToHsv(base);
    const baseRgb = hexToRgb(base);
    const toRgb = hexToRgb(pstr(params, 'colorTo', '#ff2bd6'));
    const colorMode = pstr(params, 'colorMode', 'single');
    const shift = pstr(params, 'shift', 'off');
    const hueRate = pnum(params, 'hueRate', 60);
    const colourOf = (d: Dot): Rgb => {
      const a = ageMs - d.bornMs;
      const cycle = shift === 'hue-cycle' ? (hueRate * a) / 1000 : 0;
      const own = colorMode === 'single' && cycle === 0
        ? baseRgb
        : hsvToRgb(baseHsv.h + d.hue + cycle, colorMode === 'single' ? baseHsv.s : Math.max(baseHsv.s, 0.85), Math.max(baseHsv.v, 0.0001));
      return shift === 'to-colour' ? lerpRgb(own, toRgb, lifeFrac(d)) : own;
    };

    // Draw every live dot into the scratch, then compose over the background.
    state.cov.fill(0);
    for (const d of dots) {
      if (!alive(d)) continue;
      const a = ageMs - d.bornMs;
      let level = 1;
      if (fade > 0 && life > 0) {
        const edge = fade * life;
        level = Math.min(clamp01(a / edge), clamp01((life - a) / edge));
      }
      if (level <= 0) continue;
      const rgb = colourOf(d);
      if (through === 'space') drawInSpace(model, state, d, level, rgb, length, trail);
      else drawOnRings(model, state, d, level, rgb, length, height, form, trail);
    }

    const bgMode = pstr(params, 'background', 'none');
    const bgLevel = bgMode === 'none' ? 0 : clamp01(pnum(params, 'bgLevel', 0.15));
    const bg = bgMode === 'other' ? hexToRgb(pstr(params, 'bgColor', '#1a1440')) : baseRgb;
    const { cov, col } = state;
    for (let p = 0; p < model.pixelCount; p++) {
      const a = cov[p]!;
      if (a < 0.004 && bgLevel <= 0) continue;
      const k = p * 3;
      const under = bgLevel * (1 - a);
      fb.max(p, bg.r * under + col[k]! * a, bg.g * under + col[k + 1]! * a, bg.b * under + col[k + 2]! * a, under + a);
    }
  },
};

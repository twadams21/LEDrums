import { hsvToRgb, type Rgb } from '../../color/color';
import { clamp01, mulberry32, wrap, type Vec3 } from '../../math';
import { getHoopPixelRange, type PixelModel } from '../../geometry/pixel-model';
import { pnum, pstr, type EffectGenerator, type ResolvedParams } from '../types';

/*
 * Dot (Tim, 2026-10-03): small pulses — as little as one pixel — that travel in set directions
 * and speeds around a hoop, up a drum, across the kit or straight through 3D space, or sit still
 * and twinkle. Each dot has its own Lifespan; the Effect's brightness envelope is the master
 * over them all, so a dot ends at whichever comes first. "Max alive" (the most dots alive at once;
 * Tim renamed it from "Max live", then "Max alive", 2026-10-05) is enforced in two places: within a voice here, and
 * across hits by the engine, which cuts or fades the oldest hits' voices (see {@link dotCap}).
 *
 * Voice timebase: motion integrates `ctx.dt` into per-voice state seeded from the voice's seed,
 * like Comet Trails, so every hit replays its own dots and nothing leaks between voices.
 */

type Through = 'hoop' | 'drum' | 'kit' | 'space';
type Bounce = 'wrap' | 'bounce' | 'random' | 'pingpong' | 'leave';

/** On a drum's LED grid one hoop counts as two pixel steps (Tim, 2026-10-05: "we need to go 2p
    across for every hoop"), so a 45° Travel angle goes two pixels round for each hoop. */
const HOOP_STEP = 2;

interface Dot {
  /** Spawn index — drives the alternate direction, the even spacing and the rainbow hue. */
  slot: number;
  /** Voice age at birth (ms). */
  bornMs: number;
  /** Index into `model.drums`. */
  drum: number;
  /** 0-based hoop (the nearest, while climbing between hoops). */
  hoop: number;
  /** The hoop as a float — Through a drum, a climbing dot glides between hoops. */
  hf: number;
  /** Where Ping-pong swings from, vertically. */
  hf0: number;
  /** Position around the ring, 0..1 (angle-mapped, so it carries across hoops of any size). */
  u: number;
  /** Where round the ring it shows: climbing (Travel angle ≠ 0°) it jumps hoop to hoop, so this
      only moves when the dot changes hoop — it never slides round its own hoop (Tim, 2026-10-05). */
  uShown: number;
  /** Travel around the ring: +1 / -1. */
  dir: number;
  /** Climbing a drum: up (+1) or down (−1). */
  step: number;
  /** Through the kit: the step through the drum order (+1 / −1). */
  kstep: number;
  /** Pixels travelled on this drum (Across the kit: Hop after moves it on). */
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
  /** Hue offset in degrees (Per hit / Rainbow / Random colour). */
  hue: number;
  /** Voice age when a stream recycled this dot with Oldest = Fade; it fades out from here. */
  dyingAtMs?: number;
  /** Gone off an edge (Bounce = Leave): it no longer moves or lights. */
  gone?: boolean;
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
  /** Per drum, per hoop: which pixel is 0° and which way the pixel order turns. */
  frames: HoopFrame[][];
  /** Per-pixel scratch: the strongest dot coverage and its colour this frame. */
  cov: Float32Array;
  col: Float32Array;
}

const SEED = 0xd07d07;

/** A hoop's angle frame: `front` is the pixel at 0° — the front of the drum, the side nearest the
    drummer — and `sense` is +1 when the pixel order runs towards 90° (the drummer's right). */
interface HoopFrame {
  front: number;
  sense: number;
}

type V = { x: number; y: number; z: number };
const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot3 = (a: V, b: V) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: V, b: V): V => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const unit = (a: V): V => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};

/**
 * Every hoop's angle frame (Tim, 2026-10-05: "the bottom of the ring should be 0 degrees and … the
 * front of the drum — the closest point to the drummer's playing position"). The audience faces
 * the kit from +y (the visualiser's front camera), so the drummer sits towards −y: 0° is the
 * pixel furthest that way round its hoop. A drum whose hoops face the drummer (a kick on its
 * side) has no such side, so its 0° is the bottom. 90° is the drummer's right AS THE VISUALISER
 * SHOWS THE KIT (Tim, 2026-10-05: "the right most point of the ring … should be the right most
 * point of the corresponding drum's hoop"). The visualiser draws world (x, y, z) as (x, z, y) — a
 * mirror — and a kit's Mirror setting is chosen so that picture matches the real kit, so the
 * real right is −x in world terms: front × axis, not axis × front.
 */
function hoopFrames(model: PixelModel): HoopFrame[][] {
  return model.drums.map((d) => {
    const hoops: { start: number; end: number; c: V }[] = [];
    for (let h = 1; h <= d.hoopCount; h++) {
      const r = getHoopPixelRange(model, d.drumId, h);
      if (!r || r.end <= r.start) {
        hoops.push({ start: 0, end: 0, c: { x: 0, y: 0, z: 0 } });
        continue;
      }
      const c = { x: 0, y: 0, z: 0 };
      for (let i = r.start; i < r.end; i++) {
        const w = model.pixels[i]!.world;
        c.x += w.x;
        c.y += w.y;
        c.z += w.z;
      }
      const k = r.end - r.start;
      hoops.push({ start: r.start, end: r.end, c: { x: c.x / k, y: c.y / k, z: c.z / k } });
    }
    const real = hoops.filter((h) => h.end > h.start);
    // The drum's axis, bottom hoop to top; a one-hoop drum stands upright.
    const axis = real.length > 1 ? unit(sub(real[real.length - 1]!.c, real[0]!.c)) : { x: 0, y: 0, z: 1 };
    const towards = (dir: V): V => {
      const along = dot3(dir, axis);
      return { x: dir.x - axis.x * along, y: dir.y - axis.y * along, z: dir.z - axis.z * along };
    };
    let e1 = towards({ x: 0, y: -1, z: 0 });
    if (Math.hypot(e1.x, e1.y, e1.z) < 0.3) e1 = towards({ x: 0, y: 0, z: -1 });
    e1 = unit(e1);
    const e2 = cross(e1, axis);
    return hoops.map((h) => {
      const n = h.end - h.start;
      if (n <= 0) return { front: 0, sense: 1 };
      const angle = (i: number) => {
        const r = sub(model.pixels[h.start + i]!.world, h.c);
        return Math.atan2(dot3(r, e2), dot3(r, e1));
      };
      let front = 0;
      let best = Infinity;
      for (let i = 0; i < n; i++) {
        const a = Math.abs(angle(i));
        if (a < best) {
          best = a;
          front = i;
        }
      }
      return { front, sense: n > 1 && angle((front + 1) % n) < angle(front) ? -1 : 1 };
    });
  });
}

/** Where round a hoop (0..1 of its pixel order) `deg` degrees from its front lands, on a pixel. */
function ringAt(state: DotState, model: PixelModel, drum: number, hoop: number, deg: number): number {
  const n = hoopSize(model, drum, hoop);
  const f = state.frames[drum]?.[hoop] ?? { front: 0, sense: 1 };
  return wrap(Math.round(f.front + (f.sense * deg * n) / 360), n) / n;
}

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

/** Dots alive in one voice, after the velocity amount and the Max alive cap. */
function voiceCount(params: ResolvedParams, velocity: number): number {
  const count = Math.max(1, Math.round(pnum(params, 'count', 1)));
  const vel = clamp01(pnum(params, 'velCount', 0));
  const scaled = Math.max(1, Math.round(count * (1 - vel + vel * clamp01(velocity))));
  const cap = Math.round(pnum(params, 'maxLive', 0));
  return cap > 0 ? Math.min(scaled, cap) : scaled;
}

/**
 * How many EARLIER voices of the same Effect may keep living when a new hit fires, so the dots
 * alive across hits stay within Max alive — or `undefined` when there is no cap. Counted at the
 * dots-per-hit before velocity, so the cap never lets a loud hit overshoot it. With Oldest =
 * Fade the rest fade out over Fade time instead of cutting.
 */
export function dotCap(params: ResolvedParams): { keep: number; fadeMs?: number } | undefined {
  const cap = Math.round(pnum(params, 'maxLive', 0));
  if (cap <= 0) return undefined;
  const perHit = Math.max(1, Math.round(pnum(params, 'count', 1)));
  const keep = Math.max(0, Math.floor(cap / perHit) - 1);
  return pstr(params, 'oldest', 'cut') === 'fade' ? { keep, fadeMs: Math.max(1, pnum(params, 'oldestFade', 400)) } : { keep };
}

/**
 * When the last dot of a hit ends (ms from the hit), for Sustain "Until dots end" — or `null`
 * when they never do on their own (Lifespan 0, or a Stream that runs while the Effect plays).
 */
export function dotSpanMs(params: ResolvedParams): number | null {
  const life = pnum(params, 'life', 2000);
  const spawn = pstr(params, 'spawn', 'together');
  if (life <= 0 || spawn === 'stream') return null;
  if (spawn !== 'stagger') return life;
  const count = Math.max(1, Math.round(pnum(params, 'count', 1)));
  const cap = Math.round(pnum(params, 'maxLive', 0));
  const dots = cap > 0 ? Math.min(count, cap) : count;
  return (dots - 1) * Math.max(10, pnum(params, 'interval', 250)) + life;
}

/** The golden angle: successive hits' hues land as far apart as they can. */
const GOLDEN_DEG = 137.508;

function spawnDot(ctx: Parameters<EffectGenerator['render']>[0], params: ResolvedParams, state: DotState, slot: number, bornMs: number, count: number): Dot | null {
  const model = ctx.model;
  const drums = model.drums;
  if (!drums.length) return null;
  const rng = state.rng;
  const struckId = ctx.triggers[0]?.drumId ?? '';
  const struck = drums.findIndex((d) => d.drumId === struckId);
  const through = pstr(params, 'through', 'hoop');
  // Start is always the set point; RANDOM says how far each dot may stray from it (Tim, 2026-10-05:
  // "i can't choose whether that randomness is going to be on a certain hoop of a drum or a certain
  // pixel of a hoop"). An older Dot's Start choice still reads.
  const legacy = typeof params.start === 'string' ? params.start : '';
  const amount = (key: string, whole: boolean) => (whole ? 1 : clamp01(pnum(params, key, 0)));
  const randDrum = amount('randDrum', legacy === 'random');
  const randHoop = amount('randHoop', legacy === 'random' || legacy === 'hit');
  const randAngle = amount('randAngle', legacy === 'random' || legacy === 'hit');
  const spread = params.spread === true || legacy === 'even';

  // The drum: the one chosen (or the drum you hit); Through the kit in a Custom order, the first in
  // that order (Tim, 2026-10-05: "if i make the drum order start with the kick, i am seeing the
  // bottom hoop on tom 1 light up first"). An older 1-based number still reads.
  const pick = params.startDrum;
  const named = typeof pick === 'string' && pick ? drums.findIndex((x) => x.drumId === pick)
    : typeof pick === 'number' && pick >= 1 ? Math.min(drums.length, Math.round(pick)) - 1
    : -1;
  let drum = named >= 0 ? named : struck >= 0 ? struck : 0;
  if (through === 'kit' && pstr(params, 'kitOrder', 'kit') === 'custom') drum = customDrumOrder(model, pstr(params, 'kitList', ''))[0] ?? drum;
  else if (randDrum > 0 && rng() < randDrum) drum = Math.floor(rng() * drums.length) % drums.length;

  // The hoop: the set one, pulled towards a random hoop by Random hoop.
  const hc = hoopCount(model, drum);
  const setHoop = Math.min(hc, Math.max(1, Math.round(pnum(params, 'startHoop', 1)))) - 1;
  const anyHoop = Math.floor(rng() * hc) % hc;
  const hoop = Math.round(setHoop + (anyHoop - setHoop) * randHoop);

  // The angle: degrees from the front, swung up to ±180° by Random angle; Spread shares the hoop
  // out evenly among a hit's dots.
  const deg = pnum(params, 'startAngle', 0) + (rng() * 2 - 1) * 180 * randAngle + (spread ? (slot * 360) / Math.max(1, count) : 0);
  const u = ringAt(state, model, drum, hoop, deg);

  const direction = pstr(params, 'direction', 'forward');
  const sign = direction === 'reverse' ? -1
    : direction === 'random' ? (rng() < 0.5 ? -1 : 1)
    : direction === 'alternate' ? (slot % 2 ? -1 : 1)
    : 1;

  const colorMode = pstr(params, 'colorMode', 'single');
  const hue = colorMode === 'rainbow' ? (slot * 360) / Math.max(1, count)
    : colorMode === 'random' ? rng() * 360
    // Per hit: every dot of one hit shares a hue; the next hit steps on by the golden angle.
    : colorMode === 'per-hit' ? wrap((ctx.triggers[0]?.seq ?? 0) * GOLDEN_DEG, 360)
    : 0;

  const at = ringPixel(model, drum, hoop, u);
  const pixel = at === null ? null : model.pixels[at]!;
  let p: Vec3 = pixel ? { ...pixel.world } : { ...model.bounds.center };
  let v: Vec3;
  if (through === 'space') {
    // Through space: the Start point in the kit's box, pulled towards a random point by Random
    // position. Its heading: round the kit (Heading, level) and up (Elevation); the kit is z-up.
    const { min, max } = model.bounds;
    const across = (lo: number, hi: number, t: number) => lo + (hi - lo) * clamp01(t);
    const r = amount('randSpace', legacy === 'random');
    const toward = (axis: 'x' | 'y' | 'z', key: string) => {
      const set = pnum(params, key, 0.5);
      return across(min[axis], max[axis], set + (rng() - set) * r);
    };
    p = legacy === 'hit' && pixel ? { ...pixel.world } : { x: toward('x', 'spaceX'), y: toward('y', 'spaceY'), z: toward('z', 'spaceZ') };
    if (direction === 'random') v = randomUnit(rng);
    else {
      const az = ((pnum(params, 'heading', 0) + (spread ? (slot * 360) / Math.max(1, count) : 0)) * Math.PI) / 180;
      const el = (Math.max(-90, Math.min(90, pnum(params, 'elevation', 0))) * Math.PI) / 180;
      v = { x: Math.cos(el) * Math.cos(az) * sign, y: Math.cos(el) * Math.sin(az) * sign, z: Math.sin(el) * sign };
    }
  } else {
    const t = pixel?.tangent;
    if (direction === 'random' || !t || t.x * t.x + t.y * t.y + t.z * t.z < 1e-9) v = randomUnit(rng);
    else v = { x: t.x * sign, y: t.y * sign, z: t.z * sign };
  }

  return {
    slot, bornMs, drum, hoop, hf: hoop, hf0: hoop, u, uShown: u, dir: sign, step: sign, kstep: sign, lapPx: 0, runPx: 0,
    u0: u, dir0: sign, p0: { ...p }, v0: { ...v },
    turnAtMs: bornMs + 400 + rng() * 1200, hue, p, v,
  };
}

/** A dot's speed multiplier from Accel over its life: −1 slows to a stop, +1 ends 3× faster. */
function accelMult(accel: number, lifeFrac: number): number {
  const a = Math.max(-1, Math.min(1, accel));
  return a >= 0 ? 1 + 2 * a * lifeFrac : Math.max(0, 1 + a * lifeFrac);
}

/** The drums in Custom order: the listed drum ids first (as dragged), then any drum not listed. */
export function customDrumOrder(model: PixelModel, list: string): number[] {
  const ids = list.split(',').map((id) => id.trim()).filter(Boolean);
  const seq: number[] = [];
  for (const id of ids) {
    const i = model.drums.findIndex((d) => d.drumId === id);
    if (i >= 0 && !seq.includes(i)) seq.push(i);
  }
  model.drums.forEach((_, i) => {
    if (!seq.includes(i)) seq.push(i);
  });
  return seq;
}

/** The next drum across the kit, or the same drum when the kit has one. Past the end of the
    order with Bounce = Leave the dot is gone. */
function nextKitDrum(model: PixelModel, state: DotState, dot: Dot, order: string, bounce: Bounce, list = ''): number {
  const count = model.drums.length;
  if (count <= 1) {
    if (bounce === 'leave') dot.gone = true;
    return dot.drum;
  }
  if (order === 'random' || bounce === 'random') {
    const pick = Math.floor(state.rng() * (count - 1)) % (count - 1);
    return pick >= dot.drum ? pick + 1 : pick;
  }
  const seq = order === 'nearest' ? state.tour : order === 'custom' ? customDrumOrder(model, list) : model.drums.map((_, i) => i);
  const at = Math.max(0, seq.indexOf(dot.drum));
  let next = at + dot.kstep;
  if (next < 0 || next >= count) {
    if (bounce === 'leave') {
      dot.gone = true;
      return dot.drum;
    }
    if (bounce === 'wrap') next = wrap(next, count);
    else {
      dot.kstep = -dot.kstep;
      next = at + dot.kstep;
    }
  }
  return seq[next]!;
}

/** Ping-pong: how far along its stretch a dot is after `run` px, and which way it is heading. */
function swing(run: number, span: number): { at: number; heading: number } {
  const m = wrap(run, 2 * span);
  return m < span ? { at: m, heading: 1 } : { at: 2 * span - m, heading: -1 };
}

/** How a dot moves on the rings this frame. */
interface RingMotion {
  through: Through;
  bounce: Bounce;
  span: number;
  order: string;
  /** Through a drum / the kit: the Travel angle's share of the travel round the hoop and up the
      hoops — on the LED grid, one hoop counting as one pixel step. */
  around: number;
  up: number;
  /** Through the kit at Travel angle 0°: px on a drum before hopping on (0 = one lap). */
  hopPx: number;
  /** Through the kit in Custom order: the drum ids, comma-separated. */
  list: string;
}

/** A float hoop folded back into [0, top] — a ping-pong swing reflects off the end hoops. */
function foldHoop(h: number, top: number): number {
  if (top <= 0) return 0;
  const m = wrap(h, 2 * top);
  return m <= top ? m : 2 * top - m;
}

/** Move a dot on the rings; a climbing dot shows round its ring only where it changed hoop. */
function moveOnRings(model: PixelModel, state: DotState, dot: Dot, px: number, ageMs: number, m: RingMotion): void {
  const { hoop, drum } = dot;
  const climbing = m.up !== 0 && ((m.through === 'drum' && hoopCount(model, drum) > 1) || m.through === 'kit');
  stepOnRings(model, state, dot, px, ageMs, m);
  // Tim, 2026-10-05: "if light is supposed to be travelling through a drum's hoops it should never
  // travel around the hoop" — at 45° it jumps straight to the pixel on the next hoop.
  if (!climbing) dot.uShown = dot.u;
  else if (dot.hoop !== hoop || dot.drum !== drum) {
    // On a new hoop: shown where the path crosses that hoop's line, so each hoop step lands exactly
    // HOOP_STEP × (round / up) pixels on — two at 45° — not where the dot happened to round over.
    const n = hoopSize(model, dot.drum, dot.hoop);
    const perHoop = (dot.dir * m.around * HOOP_STEP) / (n * dot.step * m.up);
    dot.uShown = wrap(dot.u - (dot.hf - dot.hoop) * perHoop, 1);
  }
}

function stepOnRings(model: PixelModel, state: DotState, dot: Dot, px: number, ageMs: number, m: RingMotion): void {
  if (px <= 0) return;
  const n = hoopSize(model, dot.drum, dot.hoop);
  const top = hoopCount(model, dot.drum) - 1;
  // Through a drum / the kit at a Travel angle: part of the travel goes up (or down) the hoops,
  // on the LED grid where a hoop is HOOP_STEP pixel steps (Tim, 2026-10-05: in millimetres a hoop
  // gap is ~6 pixels, so a 45° dot hugged the hoops). Across the kit a one-hoop drum still
  // climbs: out of it, into the next.
  const climbing = m.up !== 0 && ((m.through === 'drum' && top > 0) || m.through === 'kit');
  const around = climbing ? m.around : 1;
  if (m.bounce === 'pingpong') {
    // Back and forth over Span from where it started, along its heading.
    dot.runPx += px;
    const { at, heading } = swing(dot.runPx, m.span);
    dot.dir = dot.dir0 * heading;
    dot.u = wrap(dot.u0 + (dot.dir0 * at * around) / n, 1);
    if (climbing) {
      dot.step = dot.dir0 * heading;
      dot.hf = foldHoop(dot.hf0 + (dot.dir0 * at * m.up) / HOOP_STEP, top);
      dot.hoop = Math.round(dot.hf);
    }
    return;
  }
  if (m.bounce === 'random' && m.through !== 'kit' && ageMs >= dot.turnAtMs) {
    if (state.rng() < 0.5) dot.dir = -dot.dir;
    dot.turnAtMs = ageMs + 400 + state.rng() * 1200;
  }
  dot.u = wrap(dot.u + (dot.dir * px * around) / n, 1);
  if (climbing) {
    let h = dot.hf + (dot.step * px * m.up) / HOOP_STEP;
    if (m.through === 'kit' && (h > top + 0.5 || h < -0.5)) {
      // Out of the top (or bottom) of this drum and on into the next, entering at its far end.
      const rising = h > top + 0.5;
      const over = rising ? h - (top + 0.5) : -0.5 - h;
      dot.drum = nextKitDrum(model, state, dot, m.order, m.bounce, m.list);
      const nextTop = hoopCount(model, dot.drum) - 1;
      h = rising ? -0.5 + over : nextTop + 0.5 - over;
      dot.hf = h;
      dot.hoop = Math.min(nextTop, Math.max(0, Math.round(h)));
      return;
    }
    if (m.bounce === 'leave' && (h > top + 0.5 || h < -0.5)) {
      // Off the top (or bottom) hoop and gone.
      dot.gone = true;
      return;
    }
    if (m.bounce === 'wrap') {
      // Off the top hoop, back in at the bottom (and the other way).
      if (h > top + 0.5) h -= top + 1;
      else if (h < -0.5) h += top + 1;
    } else if (m.bounce !== 'leave' && (h > top || h < 0)) {
      h = h > top ? 2 * top - h : -h;
      dot.step = -dot.step;
      if (m.bounce === 'random' && state.rng() < 0.5) dot.dir = -dot.dir;
    }
    dot.hf = h;
    dot.hoop = Math.min(top, Math.max(0, Math.round(h)));
    return;
  }
  if (m.through !== 'kit') return;
  // Across the kit, round only (Travel angle 0°): after Hop after px (or a lap), hop to the next.
  dot.lapPx += px;
  for (;;) {
    const hop = m.hopPx > 0 ? m.hopPx : hoopSize(model, dot.drum, dot.hoop);
    if (dot.lapPx < hop) break;
    dot.lapPx -= hop;
    dot.drum = nextKitDrum(model, state, dot, m.order, m.bounce, m.list);
    if (dot.gone) return;
    dot.hoop = Math.min(dot.hoop, hoopCount(model, dot.drum) - 1);
    dot.hf = dot.hoop;
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
    if (bounce === 'leave') {
      // Out of the kit's space and gone (Tim, 2026-10-05: Wrap "re-enter[ed] the space from a
      // different spot").
      dot.gone = true;
      return;
    }
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

/** Write a coverage into the scratch, keeping the strongest dot's colour per pixel. */
function stamp(state: DotState, pixel: number, v: number, rgb: Rgb): void {
  if (v <= state.cov[pixel]!) return;
  state.cov[pixel] = v;
  const i = pixel * 3;
  state.col[i] = rgb.r;
  state.col[i + 1] = rgb.g;
  state.col[i + 2] = rgb.b;
}

function drawOnRings(model: PixelModel, state: DotState, dot: Dot, level: number, colour: (along: number) => Rgb, length: number, height: number, form: string, trail: number, around: number, up: number, glide: boolean): void {
  const info = model.drums[dot.drum];
  if (!info) return;
  // Glide off (the default): the dot steps whole pixels and hoops, crisp like a Bar (Tim,
  // 2026-10-05: the blend "is like the light is lasting too long on each pixel"). On: it blends
  // between them — smoother at slow speeds.
  const centre = glide ? dot.hf : Math.round(dot.hf);
  const halfH = (height - 1) / 2;
  const half = length / 2;
  const barLo = Math.round(centre) - Math.floor(halfH);
  // Climbing: the trail follows the heading, up the drum as well as round it.
  const climbing = up !== 0;
  const hx = dot.dir * around;
  const hy = dot.step * up;
  const thick = Math.max(0.5, halfH * HOOP_STEP);
  const vReach = halfH + 1 + (climbing ? (trail * Math.abs(up)) / HOOP_STEP : 0);
  for (let hoop = Math.ceil(centre - vReach); hoop <= Math.floor(centre + vReach); hoop++) {
    if (hoop < 0 || hoop >= info.hoopCount) continue;
    const off = hoop - centre;
    // How much of this hoop the dot covers: a Bar fills whole hoops; a Dot / Diamond glides
    // between them, shared across the two it sits between.
    const cover = form === 'bar' ? (hoop >= barLo && hoop < barLo + height ? 1 : 0) : clamp01(halfH + 1 - Math.abs(off));
    if (cover <= 0 && !climbing) continue;
    const range = getHoopPixelRange(model, info.drumId, hoop + 1);
    if (!range || range.end <= range.start) continue;
    const n = range.end - range.start;
    const c = glide ? dot.u * n : Math.round(dot.uShown * n);
    // Half the length on this row: a Dot rounds its ends, a Diamond tapers, a Bar is square.
    const across = halfH > 0 ? Math.min(1, Math.abs(off) / (halfH + 1)) : 0;
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
      b *= cover;
      if (trail > 0) {
        if (!climbing) {
          const behind = -dot.dir * d - rowHalf;
          if (behind > 0 && behind <= trail) {
            const f = 1 - behind / trail;
            b = Math.max(b, f * f * 0.8 * cover);
          }
        } else {
          // On the drum's unrolled LED grid: x round the hoop, y up the hoops (a hoop = HOOP_STEP px).
          const y = off * HOOP_STEP;
          const behind = -(d * hx + y * hy) - half;
          if (behind > 0 && behind <= trail) {
            const perp = Math.abs(d * hy - y * hx);
            const f = 1 - behind / trail;
            b = Math.max(b, f * f * 0.8 * clamp01(thick + 0.5 - perp));
          }
        }
      }
      // Along the dot, tail (0) to head (1) — Colours Per pixel gives each pixel its own.
      const along = length > 1 ? clamp01((Math.round(dot.dir * d + (length - 1) / 2)) / (length - 1)) : 1;
      if (b > 0) stamp(state, range.start + idx, b * level, colour(along));
    }
  }
}

/**
 * Through space: a shape of light at the dot's point, facing its heading (Tim, 2026-10-05: "there's
 * only 1 shape option, which is a ball"). Ball: every pixel inside Size. Shell: a hollow ball.
 * Disc: a flat round sheet facing the way it flies. Beam: a rod along its heading, Size each way.
 * Box: a cube, square to the kit. Edges soften over a pixel.
 */
function drawInSpace(model: PixelModel, state: DotState, dot: Dot, level: number, colour: (along: number) => Rgb, radiusMm: number, trail: number, form: string): void {
  const pitch = state.pitchMm;
  const radius = Math.max(1, radiusMm);
  const thin = pitch * 0.75;
  const edge = (inside: number) => clamp01(inside / pitch + 0.5);
  const tail = trail * pitch;
  // A trail follows behind at the shape's thickness: a Beam's or a Shell's is thin.
  const trailR = form === 'beam' || form === 'shell' ? thin : radius;
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
    const along = dx * v.x + dy * v.y + dz * v.z;
    const perp = Math.sqrt(Math.max(0, dist2 - along * along));
    let b = form === 'shell' ? edge(thin - Math.abs(dist - radius))
      : form === 'disc' ? edge(radius - perp) * edge(thin - Math.abs(along))
      : form === 'beam' ? edge(thin - perp) * edge(radius - Math.abs(along))
      : form === 'box' ? edge(radius - Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)))
      : edge(radius - dist);
    if (tail > 0) {
      const behind = -along;
      if (behind > 0 && behind <= tail) {
        const f = 1 - behind / tail;
        b = Math.max(b, edge(trailR - perp) * f * f * 0.8);
      }
    }
    // Per pixel through space: by distance from the centre out to the edge.
    if (b > 0) stamp(state, i, b * level, colour(clamp01(dist / radius)));
  }
}

export const dot: EffectGenerator<DotState> = {
  id: 'dot',
  name: 'Dot',
  category: 'particle',
  timebase: 'voice',
  liveVoices: dotCap,
  contentSpanMs: dotSpanMs,
  paramSpec: [
    // Dots — how many, and the set point each begins at (Tim, 2026-10-05: "can you simplify this
    // section"). Where it may stray from that point is RANDOM, further down.
    { key: 'count', label: 'Dots', type: 'number', default: 1, min: 1, max: 64, step: 1, section: 'Dots' },
    { key: 'spawn', label: 'Spawn', type: 'enum', default: 'together', options: ['together', 'stagger', 'stream'], section: 'Dots',
      info: 'Together: every dot at the hit. Stagger: one per Interval up to the count. Stream: one per Interval for as long as the Effect plays, the oldest making way.' },
    { key: 'interval', label: 'Interval', type: 'number', default: 250, min: 10, max: 4000, step: 1, unit: 'ms', section: 'Dots',
      showIf: { key: 'spawn', is: ['stagger', 'stream'] } },
    // Its one fixed option is '@hit' (the drum you hit); the card adds the kit's drums.
    { key: 'startDrum', label: 'Start drum', type: 'enum', default: '@hit', options: ['@hit'], optionsFrom: 'drums', section: 'Dots',
      showIf: [{ key: 'through', not: ['space'] }, { any: [{ key: 'through', not: ['kit'] }, { key: 'kitOrder', not: ['custom'] }] }],
      info: 'The drum each dot begins on. Through the kit in a Custom order, dots begin on the first drum of that order.' },
    { key: 'startHoop', label: 'Start hoop', type: 'number', default: 1, min: 1, max: 8, step: 1, section: 'Dots', rangeFrom: 'start-hoops',
      widget: { kind: 'hoop-pick' }, showIf: { key: 'through', not: ['space'] }, info: 'Counting from the bottom hoop, 1.' },
    { key: 'startAngle', label: 'Start angle', type: 'number', default: 0, min: 0, max: 359, step: 1, unit: '°', section: 'Dots', rangeFrom: 'start-pixels',
      widget: { kind: 'hoop-angle' }, showIf: { key: 'through', not: ['space'] },
      info: 'Where round the hoop it begins. The ring is the hoop seen from the throne: its bottom is the front of the drum — the point nearest you — its right side the drum\'s right side. Click a pixel, or use the arrow keys.' },
    { key: 'spaceX', label: 'Start point', type: 'number', default: 0.5, min: 0, max: 1, step: 0.01, unit: '%', section: 'Dots',
      widget: { kind: 'space-point', keys: ['spaceX', 'spaceY', 'spaceZ'] }, showIf: { key: 'through', is: ['space'] },
      info: 'Where in the kit\'s space it begins — click it on the kit seen from the top or the front, as the visualiser shows them.' },
    { key: 'spaceY', label: 'Start depth', type: 'number', default: 0.5, min: 0, max: 1, step: 0.01, unit: '%', section: 'Dots', partOf: 'spaceX', showIf: { key: 'through', is: ['space'] } },
    { key: 'spaceZ', label: 'Start height', type: 'number', default: 0.5, min: 0, max: 1, step: 0.01, unit: '%', section: 'Dots', partOf: 'spaceX', showIf: { key: 'through', is: ['space'] } },
    { key: 'spread', label: 'Spread out', type: 'bool', default: false, section: 'Dots',
      info: 'Several dots: share them out evenly round the hoop from the start angle (through space, round the compass from the heading) instead of all at the one point.' },
    // Random — how far each dot may stray from the set point, one amount per way it can.
    { key: 'randDrum', label: 'Drum', type: 'number', default: 0, min: 0, max: 1, step: 0.01, unit: '%', section: 'Random', showIf: { key: 'through', not: ['space'] },
      info: 'The chance a dot begins on a random drum instead of the start drum. 0%: never; 100%: always.' },
    { key: 'randHoop', label: 'Hoop', type: 'number', default: 0, min: 0, max: 1, step: 0.01, unit: '%', section: 'Random', showIf: { key: 'through', not: ['space'] },
      info: 'How far a dot may stray from the start hoop. 0%: always the start hoop; 100%: any hoop.' },
    { key: 'randAngle', label: 'Angle', type: 'number', default: 0, min: 0, max: 1, step: 0.01, unit: '%', section: 'Random', showIf: { key: 'through', not: ['space'] },
      info: 'How far round the hoop a dot may stray from the start angle. 0%: exactly there; 50%: within a quarter turn either way; 100%: anywhere round.' },
    { key: 'randSpace', label: 'Position', type: 'number', default: 0, min: 0, max: 1, step: 0.01, unit: '%', section: 'Random', showIf: { key: 'through', is: ['space'] },
      info: 'How far a dot may stray from the start point through the kit\'s space. 0%: exactly there; 100%: anywhere.' },
    { key: 'life', label: 'Lifespan', type: 'number', default: 2000, min: 0, max: 20000, step: 10, unit: 'ms', section: 'Life',
      info: 'How long each dot lives. With the Trigger card\'s Sustain on "Until dots end" (a new Dot\'s default) the hit lasts until the last dot finishes; on a time instead, a dot also ends when the envelope does. 0 = forever — until Max alive, a Cut, or the section changes.' },
    { key: 'fade', label: 'Fade in/out', type: 'number', default: 0.15, min: 0, max: 0.5, step: 0.01, unit: '%', section: 'Life',
      info: 'Each dot fades in and out over this share of its Lifespan.' },
    { key: 'maxLive', label: 'Max alive', type: 'number', default: 0, min: 0, max: 256, step: 1, section: 'Life',
      info: 'The most dots alive at once, across hits. When a new hit would go over, the oldest dots go first. 0 = no limit.' },
    { key: 'oldest', label: 'Oldest', type: 'enum', default: 'cut', options: ['cut', 'fade'], section: 'Life',
      info: 'Past Max alive (or a Stream past its count): the oldest dots cut out at once, or fade out over Fade time.' },
    { key: 'oldestFade', label: 'Fade time', type: 'number', default: 400, min: 10, max: 4000, step: 1, unit: 'ms', section: 'Life',
      showIf: { key: 'oldest', is: ['fade'] } },
    { key: 'length', label: 'Length', type: 'number', default: 1, min: 1, max: 32, step: 1, unit: 'px', section: 'Shape', showIf: { key: 'through', not: ['space'] } },
    { key: 'height', label: 'Height', type: 'number', default: 1, min: 1, max: 5, step: 1, unit: 'hoops', section: 'Shape', showIf: { key: 'through', not: ['space'] } },
    { key: 'form', label: 'Shape', type: 'enum', default: 'dot', options: ['dot', 'bar', 'diamond'], section: 'Shape', showIf: { key: 'through', not: ['space'] },
      info: 'Dot: rounded ends. Bar: square. Diamond: tapers over the hoops either side (Height 3 or more).' },
    { key: 'glide', label: 'Glide', type: 'bool', default: false, section: 'Shape', showIf: { key: 'through', not: ['space'] },
      info: 'Off: the dot steps from pixel to pixel and hoop to hoop — crisp, and climbing it jumps straight to the next hoop. On: it blends between them, smoother at slow speeds but softer.' },
    { key: 'spaceForm', label: 'Shape', type: 'enum', default: 'ball', options: ['ball', 'shell', 'disc', 'beam', 'box'], section: 'Shape', showIf: { key: 'through', is: ['space'] },
      info: 'Ball: every pixel inside it lights. Shell: a hollow ball — just its skin. Disc: a flat round sheet facing the way it flies. Beam: a rod along its heading. Box: a cube, square to the kit.' },
    { key: 'radius', label: 'Size', type: 'number', default: 120, min: 5, max: 500, step: 1, unit: 'mm', section: 'Shape', showIf: { key: 'through', is: ['space'] },
      info: 'How big the shape is — a Ball\'s or Shell\'s radius, a Disc\'s, a Beam\'s half-length, half a Box\'s side. Pixels only sit on the hoops, so a small shape in the air between drums lights nothing.' },
    { key: 'trail', label: 'Trail', type: 'number', default: 0, min: 0, max: 64, step: 1, unit: 'px', section: 'Shape' },
    // Movement — one heading for every way a dot travels (Tim, 2026-10-05).
    { key: 'through', label: 'Through', type: 'enum', default: 'hoop', options: ['hoop', 'drum', 'kit', 'space'], section: 'Movement',
      info: 'Hoop: round its own hoop. Drum: across the drum\'s hoops at the Travel angle — up, round, or a diagonal. Kit: up through a drum\'s hoops at the Travel angle, then on into the next drum. Space: a shape of light flying straight through the kit\'s 3D space from its start point, lighting the pixels it passes. A Dot through the kit or space lights the whole kit, so its Target widens to the Kit.' },
    { key: 'speed', label: 'Speed', type: 'number', default: 40, min: 0, max: 400, step: 1, unit: 'px/s', section: 'Movement',
      info: 'How fast it travels, whichever way it is going — pixels a second (or a beat, below). 0 = the dots stay where they appear.' },
    { key: 'speedPer', label: 'Speed per', type: 'enum', default: 'second', options: ['second', 'beat'], section: 'Movement' },
    { key: 'climb', label: 'Travel angle', type: 'number', default: 90, min: -90, max: 90, step: 1, unit: '°', section: 'Movement',
      showIf: { key: 'through', is: ['drum', 'kit'] },
      info: 'Which way it crosses the hoops: 90° straight up, 0° round the hoop, 45° a diagonal (two pixels round for each hoop); below 0 heads down. At any angle but 0° it jumps hoop to hoop — it never slides round its own hoop.' },
    { key: 'heading', label: 'Heading', type: 'number', default: 0, min: 0, max: 360, step: 1, unit: '°', section: 'Movement', showIf: { key: 'through', is: ['space'] },
      info: 'Which way round it flies, level with the floor — 0° along the kit\'s X axis (right in the Top view), 90° along Y.' },
    { key: 'elevation', label: 'Elevation', type: 'number', default: 0, min: -90, max: 90, step: 1, unit: '°', section: 'Movement', showIf: { key: 'through', is: ['space'] },
      info: 'How steeply it climbs: 0° level, 90° straight up, −90° straight down.' },
    { key: 'direction', label: 'Direction', type: 'enum', default: 'forward', options: ['forward', 'reverse', 'random', 'alternate'], section: 'Movement',
      info: 'Forward or Reverse along its way (Reverse on a drum heads down), Random per dot, or Alternate dot by dot.' },
    { key: 'kitOrder', label: 'Kit order', type: 'enum', default: 'kit', options: ['kit', 'nearest', 'random', 'custom'], section: 'Movement',
      showIf: { key: 'through', is: ['kit'] },
      info: 'Which drum comes next. Kit: the kit\'s own order. Nearest: the closest drum. Random. Custom: the order you drag below — dots begin on its first drum.' },
    { key: 'kitList', label: 'Drum order', type: 'enum', default: '', options: [''], widget: { kind: 'drum-order' }, section: 'Movement',
      showIf: [{ key: 'through', is: ['kit'] }, { key: 'kitOrder', is: ['custom'] }],
      info: 'Drag the drums into the order the dot visits them — or focus one and press ← / →. Dots begin on the first.' },
    { key: 'hopEvery', label: 'Hop after', type: 'number', default: 0, min: 0, max: 400, step: 1, unit: 'px', section: 'Movement',
      showIf: { key: 'through', is: ['kit'] },
      info: 'At Travel angle 0° (round only): how far a dot travels on a drum before hopping to the next. 0 = one lap. At any other angle it hops when it leaves the top or bottom of a drum.' },
    { key: 'bounce', label: 'Bounce', type: 'enum', default: 'wrap', options: ['wrap', 'bounce', 'random', 'pingpong', 'leave'], section: 'Movement',
      info: 'At an edge (the top or bottom hoop, the last drum, the side of the kit): Wrap carries on from the other end, Bounce turns back — and dots meeting head-on turn too — Random picks a new way, Leave goes off the edge and is gone. Ping-pong swings back and forth over Swing.' },
    { key: 'span', label: 'Swing', type: 'number', default: 12, min: 1, max: 200, step: 1, unit: 'px', section: 'Movement',
      showIf: { key: 'bounce', is: ['pingpong'] }, info: 'Ping-pong only: how far each dot swings before turning back.' },
    { key: 'accel', label: 'Accel', type: 'number', default: 0, min: -1, max: 1, step: 0.01, unit: '%', section: 'Movement',
      info: 'Over each dot\'s life: below 0 it slows to a stop, above 0 it speeds up (to 3×).' },
    // Colour — Hue and Saturation, as on the other effects.
    { key: 'colorMode', label: 'Colours', type: 'enum', default: 'single', options: ['single', 'per-hit', 'per-pixel', 'rainbow', 'random'], section: 'Colour',
      info: 'Single: the Hue below. Per hit: each new hit a different colour. Per pixel: each pixel of a dot its own colour, spread round the wheel from the Hue. Rainbow: the dots of a hit spread round the wheel. Random: every dot its own.' },
    { key: 'hue', label: 'Hue', type: 'number', default: 190, min: 0, max: 360, step: 1, unit: '°', section: 'Colour' },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 1, min: 0, max: 1, step: 0.01, unit: '%', section: 'Colour' },
    { key: 'hueSpread', label: 'Spread', type: 'number', default: 360, min: 0, max: 360, step: 1, unit: '°', section: 'Colour',
      showIf: { key: 'colorMode', is: ['per-pixel'] },
      info: 'Per pixel: how far round the colour wheel a dot\'s pixels reach, tail to head. 360°: a 5-pixel dot shows 5 colours evenly round the wheel.' },
    { key: 'shift', label: 'Change', type: 'enum', default: 'off', options: ['off', 'to-hue', 'hue-cycle'], section: 'Colour',
      info: 'Off. To hue: each dot turns to a second hue over its life. Hue cycle: the colours keep turning round the wheel.' },
    { key: 'hueTo', label: 'To hue', type: 'number', default: 320, min: 0, max: 360, step: 1, unit: '°', section: 'Colour', showIf: { key: 'shift', is: ['to-hue'] } },
    { key: 'hueRate', label: 'Hue rate', type: 'number', default: 60, min: 0, max: 720, step: 1, unit: '°/s', section: 'Colour', showIf: { key: 'shift', is: ['hue-cycle'] } },
    { key: 'background', label: 'Background', type: 'enum', default: 'none', options: ['none', 'same', 'other'], section: 'Background',
      info: 'Light behind the dots across the Effect\'s Target: none, the dot colour dimmed, or a colour of its own.' },
    { key: 'bgLevel', label: 'Level', type: 'number', default: 0.15, min: 0, max: 1, step: 0.01, unit: '%', section: 'Background',
      showIf: { key: 'background', is: ['same', 'other'] } },
    { key: 'bgHue', label: 'Hue', type: 'number', default: 250, min: 0, max: 360, step: 1, unit: '°', section: 'Background', showIf: { key: 'background', is: ['other'] } },
    { key: 'bgSat', label: 'Saturation', type: 'number', default: 0.7, min: 0, max: 1, step: 0.01, unit: '%', section: 'Background', showIf: { key: 'background', is: ['other'] } },
    { key: 'velSize', label: 'Size', type: 'number', default: 0, min: 0, max: 1, step: 0.01, unit: '%', section: 'Velocity',
      info: 'How much a softer hit shrinks the dots. 0 = every hit the same.' },
    { key: 'velSpeed', label: 'Speed', type: 'number', default: 0, min: 0, max: 1, step: 0.01, unit: '%', section: 'Velocity' },
    { key: 'velCount', label: 'Dots', type: 'number', default: 0, min: 0, max: 1, step: 0.01, unit: '%', section: 'Velocity' },
  ],
  createState(model: PixelModel, seed?: number): DotState {
    const pitchMm = meanPitch(model);
    return {
      dots: [],
      spawned: 0,
      rng: mulberry32(seed ?? SEED),
      pitchMm,
      tour: nearestTour(model),
      frames: hoopFrames(model),
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
    // A stream past its count: the oldest cut out, or (Oldest = Fade) fade out over Fade time.
    const fadeOld = pstr(params, 'oldest', 'cut') === 'fade';
    const oldestFade = Math.max(1, pnum(params, 'oldestFade', 400));
    if (spawn === 'stream') {
      let over = state.dots.filter((d) => d.dyingAtMs === undefined).length - count;
      for (const d of state.dots) {
        if (over <= 0) break;
        if (d.dyingAtMs !== undefined) continue;
        d.dyingAtMs = fadeOld ? ageMs : -Infinity;
        over--;
      }
      state.dots = state.dots.filter((d) => d.dyingAtMs === undefined || ageMs - d.dyingAtMs < oldestFade);
    }
    const dots = spawn === 'stream' ? state.dots : state.dots.slice(0, count);

    const life = Math.max(0, pnum(params, 'life', 2000));
    const fade = clamp01(pnum(params, 'fade', 0.15));
    const through = pstr(params, 'through', 'hoop') as Through;
    const bounce = pstr(params, 'bounce', 'wrap') as Bounce;
    const span = Math.max(1, pnum(params, 'span', 12));
    const order = pstr(params, 'kitOrder', 'kit');
    const climbRad = (Math.max(-90, Math.min(90, pnum(params, 'climb', 90))) * Math.PI) / 180;
    const climbs = through === 'drum' || through === 'kit';
    const motion: RingMotion = {
      through, bounce, span, order,
      around: climbs ? Math.cos(climbRad) : 1,
      up: climbs ? Math.sin(climbRad) : 0,
      hopPx: Math.max(0, pnum(params, 'hopEvery', 0)),
      list: pstr(params, 'kitList', ''),
    };
    // Below a hair, cos/sin of ±90° leave a sliver of travel round the hoop; drop it.
    if (Math.abs(motion.around) < 1e-9) motion.around = 0;
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
    const glide = params.glide === true;
    const radiusMm = Math.max(1, pnum(params, 'radius', 60) * sizeScale);
    const trail = Math.max(0, pnum(params, 'trail', 0) * sizeScale);
    const dtSec = Math.max(0, ctx.dt) / 1000;

    const alive = (d: Dot) => !d.gone && d.bornMs <= ageMs && (life <= 0 || ageMs - d.bornMs < life);
    const lifeFrac = (d: Dot) => (life > 0 ? clamp01((ageMs - d.bornMs) / life) : clamp01((ageMs - d.bornMs) / 2000));

    // Move.
    for (const d of dots) {
      if (!alive(d)) continue;
      const px = pxPerSec * accelMult(accel, lifeFrac(d)) * dtSec;
      if (through === 'space') moveInSpace(model, state, d, px, bounce, span);
      else moveOnRings(model, state, d, px, ageMs - d.bornMs, motion);
    }
    if (bounce === 'bounce' && through !== 'space' && pxPerSec > 0) collide(model, dots.filter(alive), Math.max(1, length));

    // Colour — Hue and Saturation, like the other effects (Tim, 2026-10-05: "The colour palette is
    // different than other effects. Make it the same").
    const hue = pnum(params, 'hue', 190);
    const sat = clamp01(pnum(params, 'saturation', 1));
    const colorMode = pstr(params, 'colorMode', 'single');
    const shift = pstr(params, 'shift', 'off');
    const hueRate = pnum(params, 'hueRate', 60);
    const hueTo = pnum(params, 'hueTo', 320);
    // Per pixel: the dot's pixels spread round the colour wheel, tail to head ("if we have 5 pixels,
    // we can have 5 different colours associated with them").
    const spreadDeg = colorMode === 'per-pixel' ? pnum(params, 'hueSpread', 360) : 0;
    const colourFor = (d: Dot) => {
      const a = ageMs - d.bornMs;
      let h = hue + d.hue + (shift === 'hue-cycle' ? (hueRate * a) / 1000 : 0);
      if (shift === 'to-hue') h += ringDelta(h, hueTo, 360) * lifeFrac(d);
      if (!spreadDeg) {
        const rgb = hsvToRgb(h, sat, 1);
        return () => rgb;
      }
      // With n pixels, n colours: steps of spread / n, so a full 360° never repeats the first.
      const steps = Math.max(1, through === 'space' ? 6 : length);
      return (along: number) => hsvToRgb(h + Math.round(along * (steps - 1)) * (spreadDeg / steps), sat, 1);
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
      if (d.dyingAtMs !== undefined) level *= clamp01(1 - (ageMs - d.dyingAtMs) / oldestFade);
      if (level <= 0) continue;
      const colour = colourFor(d);
      if (through === 'space') drawInSpace(model, state, d, level, colour, radiusMm, trail, pstr(params, 'spaceForm', 'ball'));
      else drawOnRings(model, state, d, level, colour, length, height, form, trail, motion.around, hoopCount(model, d.drum) > 1 ? motion.up : 0, glide);
    }

    const bgMode = pstr(params, 'background', 'none');
    const bgLevel = bgMode === 'none' ? 0 : clamp01(pnum(params, 'bgLevel', 0.15));
    const bg = bgMode === 'other' ? hsvToRgb(pnum(params, 'bgHue', 250), clamp01(pnum(params, 'bgSat', 0.7)), 1) : hsvToRgb(hue, sat, 1);
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

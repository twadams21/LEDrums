/**
 * Splice — cutting a voice's pixels into bands, deciding what shows in each, and moving
 * them. Pure math shared by the core compositor and the web offline preview, so the two
 * can never disagree about where a splice starts or which splice is showing.
 *
 * Three separable pieces, in the order the compositor uses them:
 *   1. {@link forEachPartitionUnit} — WHICH runs of pixels get cut (each hoop, each drum,
 *      or the whole scope), derived from the model and the voice's resolved ranges.
 *   2. {@link computeSpliceBands} — how one run is divided into `count` contiguous bands,
 *      with seeded length jitter. Widths always sum to the run exactly.
 *   3. {@link forEachSpliceBand} — which splice slot each band currently shows, after the
 *      chase. `step` rotates the CONTENT over static bands; `smooth` slides the band
 *      GEOMETRY around the run and wraps, so one band can emit two ranges.
 *
 * Deterministic and allocation-light: the two `forEach*` walkers hand ranges to a callback
 * rather than building arrays, because they run per voice per frame. No IO, no wall-clock,
 * no `Math.random` — jitter comes from the seeded {@link mulberry32}, as the modifier rule
 * requires.
 */
import { hexToRgb, type Rgb } from '../color/color';
import { clamp01, hashString, mulberry32 } from '../math';
import { drumHoopPixelRange, type PixelModel } from '../geometry/pixel-model';
import type { PixelRange } from '../modifiers/types';
import { computeDelayMs } from './delay';
import type { EffectDef, GraphNode, SpliceConfig, SpliceDef, SpliceOrder } from './types';

/** Splice count defaults + the authoring ceiling. The cap is a legibility bound, not a
    perf one: past a few dozen splices per hoop each band is a pixel or two wide. */
export const DEFAULT_SPLICE_COUNT = 4;
export const MIN_SPLICE_COUNT = 1;
export const MAX_SPLICE_COUNT = 64;
/** Default chase interval when a node authors none (an eighth note at 120bpm). */
export const DEFAULT_SPLICE_RATE_MS = 250;
export const DEFAULT_SPLICE_DIVISION = '1/8';
/** Default + ceiling for the `'stagger'` pixel increment. */
export const DEFAULT_SPLICE_INCREMENT_PX = 4;
export const MAX_SPLICE_INCREMENT_PX = 512;
/**
 * Default splice envelope: a fast rise, a visible hold, a gentle fade. A splice node owns
 * these outright rather than inheriting the first splice's effect — so "how long the lights
 * stay up after a hit" is one authorable number, and reordering the splices cannot silently
 * change the envelope.
 */
export const DEFAULT_SPLICE_ATTACK_MS = 10;
export const DEFAULT_SPLICE_HOLD_MS = 400;
export const DEFAULT_SPLICE_RELEASE_MS = 300;
export const MAX_SPLICE_ENVELOPE_MS = 120000;
/**
 * The reserved effect a colour-only splice hosts. It is an ENGINE-REGISTERED def, not an
 * authored one: `effectId`s in a graph are `EffectDef` ids (the web mints them as
 * `gen:<generatorId>`), and core cannot know that convention — so rather than guess an id
 * out of the show's effect list, the engine registers this one itself at `setShow` (see
 * {@link spliceFillEffectDef}). The `@` prefix keeps it out of any authored id space.
 */
export const SPLICE_FILL_EFFECT_ID = '@splice-fill';
/** The generator behind {@link SPLICE_FILL_EFFECT_ID} — see `effects/impl/solid-colour.ts`. */
export const SPLICE_FILL_GENERATOR_ID = 'solid-colour';

/**
 * The reserved {@link SPLICE_FILL_EFFECT_ID} definition, registered by the engine so a
 * colour-only splice always has a real effect to host. It also supplies the composite
 * voice's envelope when the FIRST splice is a colour (a splice voice takes its bus and
 * envelope from its first non-blank splice, the same rule the Mix collector uses for its
 * first input) — hence a hit-shaped attack/decay rather than an infinite hold.
 */
export function spliceFillEffectDef(busId: string): EffectDef {
  return {
    id: SPLICE_FILL_EFFECT_ID,
    name: 'Splice Colour',
    generatorId: SPLICE_FILL_GENERATOR_ID,
    busId,
    scope: 'kit',
    params: [
      { key: 'color', label: 'Colour', kind: 'color', default: '#ffffff' },
      { key: 'brightness', label: 'Brightness', kind: 'number', min: 0, max: 1, step: 0.01, default: 1 },
    ],
    attackMs: 10,
    sustainMs: 400,
    releaseMs: 300,
  };
}

/** One band of a partitioned run, in offsets local to that run. */
export interface SpliceBand {
  start: number;
  width: number;
}

const clampInt = (v: number, min: number, max: number): number => {
  const n = Math.round(Number.isFinite(v) ? v : min);
  return n < min ? min : n > max ? max : n;
};

/** Positive modulo — JS `%` keeps the sign of the dividend, which would break a negative
    chase direction (band −1 must wrap to the last slot, not stay −1). */
export function wrapIndex(value: number, count: number): number {
  if (count <= 0) return 0;
  const m = value % count;
  return m < 0 ? m + count : m;
}

/**
 * The splice authored for slot `slot`. Fewer authored splices than slots CYCLE rather than
 * leaving the tail blank — two colours over eight splices alternate, which is what an
 * author means by "red and blue splices" without filling in eight rows.
 */
export function spliceDefAt(splices: readonly SpliceDef[] | undefined, slot: number): SpliceDef | undefined {
  if (!splices || splices.length === 0) return undefined;
  return splices[wrapIndex(slot, splices.length)];
}

/** A splice that renders nothing: muted, or carrying neither a colour nor an effect. */
export function isBlankSplice(def: SpliceDef | undefined): boolean {
  if (!def || def.muted) return true;
  const hasColor = typeof def.color === 'string' && def.color.length > 0;
  const hasEffect = typeof def.effectId === 'string' && def.effectId.length > 0;
  return !hasColor && !hasEffect;
}

/**
 * Cut `len` pixels into `count` contiguous bands whose widths sum to EXACTLY `len` (no
 * gaps, no overlap — every pixel of the run belongs to exactly one band).
 *
 * `jitter` 0..1 varies the widths: each band draws a weight in `[1−jitter, 1+jitter]` and
 * widths are that weight's share of the run, so the run stays fully covered however wild
 * the jitter. Rounding drift is absorbed by the final band. A band CAN come out zero-width
 * (more splices than pixels, or heavy jitter); it simply renders nothing.
 *
 * Deterministic in (len, count, jitter, seed) — the same four always cut the same pattern,
 * so a splice layout is stable across frames and reproducible across machines.
 */
export function computeSpliceBands(len: number, count: number, jitter: number, seed: number): SpliceBand[] {
  const n = clampInt(count, MIN_SPLICE_COUNT, MAX_SPLICE_COUNT);
  const total = Math.max(0, Math.floor(len));
  if (total <= 0) return Array.from({ length: n }, () => ({ start: 0, width: 0 }));

  const j = clamp01(jitter);
  const weights: number[] = [];
  let sum = 0;
  if (j <= 0) {
    for (let i = 0; i < n; i++) weights.push(1);
    sum = n;
  } else {
    const rng = mulberry32(hashString(`splice:${total}:${n}:${j}:${seed >>> 0}`));
    for (let i = 0; i < n; i++) {
      const w = 1 + (rng() * 2 - 1) * j;
      const clamped = w < 0.05 ? 0.05 : w; // never a negative or vanishing share
      weights.push(clamped);
      sum += clamped;
    }
  }

  const bands: SpliceBand[] = [];
  let cursor = 0;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += weights[i]! / sum;
    // Walk the cumulative boundary rather than accumulating rounded widths, so drift can
    // never compound and the last band always lands exactly on `total`.
    const boundary = i === n - 1 ? total : Math.round(acc * total);
    const end = boundary < cursor ? cursor : boundary > total ? total : boundary;
    bands.push({ start: cursor, width: end - cursor });
    cursor = end;
  }
  return bands;
}

/**
 * Walk the runs of pixels a splice node cuts up, given the voice's already-resolved pixel
 * ranges (its scope, narrowed by any upstream Scope node).
 *
 * `'scope'` cuts each resolved range once, end to end. `'drum'` and `'hoop'` intersect the
 * ranges with the model's real drum / hoop runs, so a kit-scoped splice node cuts EVERY
 * hoop into `count` — which is what makes a chase read as one spin around all sixteen rings
 * at once, rather than a single band crawling the length of the whole kit.
 */
export interface SplicePartitionUnit {
  start: number;
  end: number;
  /** Emission index across the whole walk — used to decorrelate per-unit jitter seeds. */
  index: number;
  /** Position on the PRIMARY cascade axis: the hoop within its drum (`'hoop'`), the drum
      (`'drum'`), or always 0 (`'scope'`). */
  ordinal: number;
  ordinalCount: number;
  /** Position on the SECOND axis — which drum this unit belongs to. Only meaningful under the
      `'hoop'` partition, where hoops and drums are genuinely separate axes; the other two
      partitions already cascade by drum on the primary axis. */
  drumOrdinal: number;
  drumCount: number;
}

export function forEachPartitionUnit(
  model: PixelModel,
  ranges: readonly PixelRange[],
  partition: SpliceConfig['partition'],
  visit: (unit: SplicePartitionUnit) => void,
): void {
  let index = 0;
  const emit = (start: number, end: number, rest: Omit<SplicePartitionUnit, 'start' | 'end' | 'index'>): void => {
    if (end > start) visit({ start, end, index: index++, ...rest });
  };

  for (const range of ranges) {
    if (partition === 'scope') {
      emit(range.start, range.end, { ordinal: 0, ordinalCount: 1, drumOrdinal: 0, drumCount: 1 });
      continue;
    }
    for (let d = 0; d < model.drums.length; d++) {
      const drum = model.drums[d]!;
      if (partition === 'drum') {
        const start = Math.max(range.start, drum.pixelStart);
        const end = Math.min(range.end, drum.pixelStart + drum.pixelCount);
        emit(start, end, { ordinal: d, ordinalCount: model.drums.length, drumOrdinal: d, drumCount: model.drums.length });
        continue;
      }
      for (let hoop = 1; hoop <= drum.hoopCount; hoop++) {
        const hoopRange = drumHoopPixelRange(drum, hoop);
        if (!hoopRange) continue;
        // Ordinal is the hoop's position WITHIN ITS DRUM, not a running unit count: on a
        // kit-scoped splice that makes hoop 1 of every drum fire together and the cascade climb
        // each drum in parallel. The drum axis rides alongside so a kit-wide splice can ALSO
        // travel drum by drum.
        emit(Math.max(range.start, hoopRange.start), Math.min(range.end, hoopRange.end), {
          ordinal: hoop - 1,
          ordinalCount: drum.hoopCount,
          drumOrdinal: d,
          drumCount: model.drums.length,
        });
      }
    }
  }
}

/**
 * Where a unit sits in the firing order — 0 starts immediately, 1 starts one offset later, and
 * so on. Pure and total: an out-of-range ordinal clamps, a single unit is always position 0.
 *
 * `'random'` is a seeded shuffle rather than a per-unit hash so the result is a genuine
 * PERMUTATION: every position is used exactly once, which is what keeps a random cascade
 * evenly spread instead of clumping several hoops onto the same start time.
 */
export function spliceOrderIndex(ordinal: number, count: number, order: SpliceOrder, seed: number): number {
  const n = Math.max(1, Math.floor(count));
  const i = Math.min(n - 1, Math.max(0, Math.floor(ordinal)));
  switch (order) {
    case 'down':
      return n - 1 - i;
    case 'outside-in': {
      // 0, N−1, 1, N−2, … — pair up from both ends, outermost first.
      const fromEnd = n - 1 - i;
      return i <= fromEnd ? i * 2 : fromEnd * 2 + 1;
    }
    case 'random': {
      const rng = mulberry32(hashString(`splice-order:${n}:${seed >>> 0}`));
      const perm = Array.from({ length: n }, (_, k) => k);
      for (let k = n - 1; k > 0; k--) {
        const j = Math.floor(rng() * (k + 1));
        const tmp = perm[k]!;
        perm[k] = perm[j]!;
        perm[j] = tmp;
      }
      return perm[i]!;
    }
    default:
      return i;
  }
}

/**
 * A unit's own motion clock: the shared clock minus its place in the cascade. Clamped at 0, so a
 * unit whose turn has not come shows the cut STANDING STILL rather than going dark — the splice
 * colours are already lit; only the movement is waiting.
 *
 * Takes an absolute delay rather than (index × offset) because a unit can sit on TWO cascade axes
 * at once: a kit-wide splice can climb each drum's hoops AND travel drum to drum, and the two
 * delays simply add.
 */
export function unitMotionAge(ageMs: number, delayMs: number): number {
  if (!(delayMs > 0)) return ageMs;
  const own = ageMs - delayMs;
  return own > 0 ? own : 0;
}

/**
 * The LONGEST cascade delay any unit of this splice will take on the given model — what a voice
 * has to outlive for the cascade to finish rather than being cut off mid-travel. Derived from
 * the model's shape rather than by walking units, so the engine can extend a voice at spawn.
 */
export function maxCascadeDelayMs(model: PixelModel, cfg: SpliceConfig): number {
  if (cfg.partition === 'scope' || model.drums.length === 0) return 0;
  const drums = model.drums.length;
  const primary = cfg.partition === 'drum' ? drums : Math.max(...model.drums.map((d) => d.hoopCount));
  return Math.max(0, (primary - 1) * cfg.offsetMs + (drums - 1) * cfg.drumOffsetMs);
}

/**
 * One unit's own envelope level 0..1 in `'pulse'`, from the age it has had SINCE its turn came:
 * the same attack → hold → fade shape the voice runs, just started later. Before its turn (a
 * negative age) it is 0, and once its fade has run out it is 0 again — which is what makes the
 * light a travelling pulse rather than a leading edge.
 */
export function unitEnvelopeLevel(ownAgeMs: number, attackMs: number, sustainMs: number, releaseMs: number): number {
  if (!(ownAgeMs > 0)) return 0;
  if (ownAgeMs < attackMs) return ownAgeMs / attackMs;
  const held = attackMs + sustainMs;
  if (ownAgeMs <= held) return 1;
  const fade = Math.max(1, releaseMs);
  const out = 1 - (ownAgeMs - held) / fade;
  return out > 0 ? out : 0;
}

/** A unit's total cascade delay: its place on the hoop axis plus its place on the drum axis. */
export function unitCascadeDelayMs(orderIndex: number, drumOrderIndex: number, cfg: SpliceConfig): number {
  return orderIndex * cfg.offsetMs + drumOrderIndex * cfg.drumOffsetMs;
}

export function forEachSpliceBand(
  bands: readonly SpliceBand[],
  len: number,
  shiftPx: number,
  offsetSlots: number,
  visit: (slot: number, start: number, end: number) => void,
): void {
  forEachSpliceSegment(bands, len, shiftPx, offsetSlots, 0, (slot, start, end) => visit(slot, start, end));
}

/**
 * The feather width in pixels for a smudge amount: a fraction of the AVERAGE band width, so the
 * same setting reads the same on a 34-pixel hoop and a 196-pixel kick. Clamped to the narrowest
 * band, because a feather wider than a band would ramp across two boundaries at once and the
 * weights would stop summing to 1 — a visible dip rather than a smudge.
 */
export function spliceFeatherPx(smudge: number, bands: readonly SpliceBand[], len: number): number {
  const amount = clamp01(smudge);
  if (amount <= 0 || bands.length === 0 || len <= 0) return 0;
  let narrowest = Infinity;
  for (const band of bands) if (band.width > 0 && band.width < narrowest) narrowest = band.width;
  if (!Number.isFinite(narrowest)) return 0;
  return Math.min(amount * (len / bands.length), narrowest);
}

/**
 * Emit the weighted segments of one run: `(slot, start, end, w0, w1)`, the weight ramping
 * linearly from `w0` at `start` to `w1` at `end`. Offsets are local to the run; `end` exclusive.
 *
 * With `featherPx` 0 each band is ONE segment at full weight — a hard cut, byte for byte. With a
 * feather each band is three: a ramp up across its leading boundary, a full-weight core, and a
 * ramp down across its trailing one. Adjacent bands' ramps cover the same pixels with
 * complementary weights, so a caller that ACCUMULATES gets a crossfade summing to exactly 1 —
 * the colours smudge into one another with no bright seam and no dip.
 *
 * A segment crossing the run's wrap point is split in two, with the ramp kept continuous across
 * the split — which is why this is a walker and not a list.
 */
export function forEachSpliceSegment(
  bands: readonly SpliceBand[],
  len: number,
  shiftPx: number,
  offsetSlots: number,
  featherPx: number,
  visit: (slot: number, start: number, end: number, w0: number, w1: number) => void,
): void {
  const count = bands.length;
  if (count === 0 || len <= 0) return;
  const shift = wrapIndex(Math.round(shiftPx), len);
  // ONE integer half-width for the whole run, not one per band. Whole pixels because segment
  // bounds index the framebuffer; shared because a band's ramp-out has to line up exactly with
  // its neighbour's ramp-in for the two weights to sum to 1 — with jittered widths, a per-band
  // half would leave a seam at every boundary between bands of different sizes.
  const half = Math.round(featherPx / 2);

  const emit = (slot: number, from: number, to: number, w0: number, w1: number): void => {
    if (to <= from) return;
    const span = to - from;
    let cursor = from;
    while (cursor < to) {
      const wrapped = wrapIndex(cursor, len);
      const chunk = Math.min(to - cursor, len - wrapped);
      const t0 = (cursor - from) / span;
      const t1 = (cursor + chunk - from) / span;
      visit(slot, wrapped, wrapped + chunk, w0 + (w1 - w0) * t0, w0 + (w1 - w0) * t1);
      cursor += chunk;
    }
  };

  for (let b = 0; b < count; b++) {
    const band = bands[b]!;
    if (band.width <= 0) continue;
    const slot = wrapIndex(b - offsetSlots, count);
    const start = band.start + shift;
    // No guard on band width: when a band is exactly twice the half-width its flat core is
    // empty and it is pure ramp — which is what a full-strength smudge IS, not a degenerate
    // case. `emit` drops empty segments on its own.
    if (half <= 0) {
      emit(slot, start, start + band.width, 1, 1);
      continue;
    }
    emit(slot, start - half, start + half, 0, 1);
    emit(slot, start + half, start + band.width - half, 1, 1);
    emit(slot, start + band.width - half, start + band.width + half, 1, 0);
  }
}

/**
 * Chase position at voice age `ageMs`, split into the two forms the two chase modes need:
 * whole slots stepped so far, and the fraction of a full lap travelled (in pixels, given a
 * run length). `chaseMs` ≤ 0 (or `'off'`) freezes both at 0.
 *
 * The clock is the VOICE's age, not the engine's wall clock, so a splice chase starts at
 * the hit that spawned it and two hits an eighth apart are visibly an eighth apart.
 */
export function chaseStepOffset(ageMs: number, chaseMs: number, direction: 1 | -1): number {
  if (!(chaseMs > 0) || !Number.isFinite(ageMs) || ageMs < 0) return 0;
  return Math.floor(ageMs / chaseMs) * direction;
}

/** Pixels the band geometry has slid at `ageMs` — one full lap of `len` per `chaseMs`. */
export function chasePixelShift(ageMs: number, chaseMs: number, direction: 1 | -1, len: number): number {
  if (!(chaseMs > 0) || !Number.isFinite(ageMs) || ageMs < 0 || len <= 0) return 0;
  return (ageMs / chaseMs) * len * direction;
}

/**
 * Pixels the band geometry has jumped at `ageMs` in `'stagger'` — a whole `incrementPx` per
 * elapsed interval and nothing in between, so the material lands on the same pixel boundaries
 * every time rather than gliding across them.
 *
 * Distinct from both siblings on purpose: `'smooth'` covers a lap per interval (speed is tied to
 * the run's length, so a 34px hoop and a 196px kick spin at different pixel rates), while
 * `'step'` moves exactly one splice (so the increment is whatever the cut happens to be). Here
 * the increment is authored outright and identical on every run — the mode to reach for when the
 * movement itself is the rhythm.
 */
export function chaseStaggerShift(ageMs: number, chaseMs: number, direction: 1 | -1, incrementPx: number): number {
  if (!(chaseMs > 0) || !Number.isFinite(ageMs) || ageMs < 0) return 0;
  const step = Math.max(0, Math.round(incrementPx));
  if (step <= 0) return 0;
  return Math.floor(ageMs / chaseMs) * step * direction;
}

/**
 * Recolour a rendered pixel toward a splice colour, keeping the effect's own brightness —
 * so tinting a comet red gives a red comet, not a red rectangle. The target is the splice
 * colour scaled to the source's peak channel; `amount` 0..1 crossfades to it.
 *
 * Tinting a flat fill with its own colour is the identity, which is why a colour-only
 * splice (hosted by `solid-colour`) can run through this same path unbranched.
 */
export function tintPixel(r: number, g: number, b: number, colour: Rgb, amount: number): Rgb {
  const a = clamp01(amount);
  if (a <= 0) return { r, g, b };
  const peak = Math.max(r, g, b);
  const tr = colour.r * peak;
  const tg = colour.g * peak;
  const tb = colour.b * peak;
  return { r: r + (tr - r) * a, g: g + (tg - g) * a, b: b + (tb - b) * a };
}

/** Parse a splice colour once per frame rather than per pixel. `null` = no tint. */
export function spliceTintColour(colour: string | null | undefined): Rgb | null {
  return typeof colour === 'string' && colour.length > 0 ? hexToRgb(colour) : null;
}

/** One non-blank splice slot, paired with the slot it occupies. */
export interface ResolvedSpliceMember {
  slot: number;
  def: SpliceDef;
  /** The effect this member hosts — the authored one, or `solid-colour` for a colour fill. */
  effectId: string;
  /** Params for {@link effectId}: the authored overrides, plus `color` for a colour fill. */
  params: Record<string, number | string | boolean>;
}

export interface ResolvedSplices {
  config: SpliceConfig;
  members: ResolvedSpliceMember[];
  /** The voice envelope this splice node owns (see {@link DEFAULT_SPLICE_HOLD_MS}). */
  envelope: { attackMs: number; sustainMs: number; releaseMs: number };
}

/**
 * Resolve a `splice` node into the layout the compositor consumes plus the members that
 * actually render. Returns `null` when every slot is blank — a splice node with nothing
 * authored emits no voice at all, mirroring how a Mix with no inputs emits nothing.
 *
 * `bpm` resolves a `beats` chase rate into milliseconds HERE, at eval time, so the value is
 * snapshot-stable for the voice's life exactly like a delay node's offset: a tempo change
 * mid-decay must not re-time a chase already in flight.
 */
export function resolveSplices(node: GraphNode, bpm: number, beatsPerBar = 4): ResolvedSplices | null {
  const count = clampInt(node.spliceCount ?? DEFAULT_SPLICE_COUNT, MIN_SPLICE_COUNT, MAX_SPLICE_COUNT);
  const chase = node.spliceChase ?? 'off';
  const chaseMs =
    chase === 'off'
      ? 0
      : Math.max(
          0,
          computeDelayMs(
            node.spliceRateMode ?? 'beats',
            node.spliceRateMs ?? DEFAULT_SPLICE_RATE_MS,
            node.spliceDivision ?? DEFAULT_SPLICE_DIVISION,
            bpm > 0 ? bpm : 120,
            beatsPerBar,
          ),
        );

  // Per-unit cascade offset, resolved here (not per frame) for the same snapshot-stability
  // reason as the chase rate. A `beats` offset with no division chosen is 0: picking an ORDER
  // alone must never start a cascade the author did not ask for.
  const offsetMs =
    chase === 'off'
      ? 0
      : Math.max(
          0,
          (node.spliceOffsetMode ?? 'beats') === 'time'
            ? (node.spliceOffsetMs ?? 0)
            : node.spliceOffsetDivision
              ? computeDelayMs('beats', 0, node.spliceOffsetDivision, bpm > 0 ? bpm : 120, beatsPerBar)
              : 0,
        );

  /** Resolve one of the two cascade offsets — a division against the bar, or free ms. A
      `beats` offset with no division chosen is 0: picking an ORDER alone must never start a
      cascade the author did not ask for. */
  const cascadeMs = (mode: 'time' | 'beats' | undefined, ms: number | undefined, division: string | undefined): number =>
    chase === 'off'
      ? 0
      : Math.max(
          0,
          (mode ?? 'beats') === 'time'
            ? (ms ?? 0)
            : division
              ? computeDelayMs('beats', 0, division, bpm > 0 ? bpm : 120, beatsPerBar)
              : 0,
        );
  const drumOffsetMs = cascadeMs(node.spliceDrumOffsetMode, node.spliceDrumOffsetMs, node.spliceDrumOffsetDivision);

  const colors: (string | null)[] = [];
  const inputBySlot: number[] = [];
  const members: ResolvedSpliceMember[] = [];

  for (let slot = 0; slot < count; slot++) {
    const def = spliceDefAt(node.splices, slot);
    const colour = typeof def?.color === 'string' && def.color.length > 0 ? def.color : null;
    colors.push(colour);
    if (isBlankSplice(def) || !def) {
      inputBySlot.push(-1);
      continue;
    }
    const authored = typeof def.effectId === 'string' && def.effectId.length > 0 ? def.effectId : null;
    const params: Record<string, number | string | boolean> = { ...(def.params ?? {}) };
    // A colour-only splice becomes a `solid-colour` member so every member is the same kind
    // of thing (a generator sub-voice) and the compositor needs no separate fill branch.
    if (!authored) params.color = colour ?? '#ffffff';
    inputBySlot.push(members.length);
    members.push({ slot, def, effectId: authored ?? SPLICE_FILL_EFFECT_ID, params });
  }

  if (members.length === 0) return null;

  const envelope = {
    attackMs: clampInt(node.spliceAttackMs ?? DEFAULT_SPLICE_ATTACK_MS, 0, MAX_SPLICE_ENVELOPE_MS),
    sustainMs: clampInt(node.spliceHoldMs ?? DEFAULT_SPLICE_HOLD_MS, 0, MAX_SPLICE_ENVELOPE_MS),
    releaseMs: clampInt(node.spliceReleaseMs ?? DEFAULT_SPLICE_RELEASE_MS, 0, MAX_SPLICE_ENVELOPE_MS),
  };

  return {
    envelope,
    config: {
      count,
      partition: node.splicePartition ?? 'hoop',
      jitter: clamp01(node.spliceJitter ?? 0),
      seed: Math.trunc(node.spliceSeed ?? 1) >>> 0,
      chase,
      chaseMs,
      direction: node.spliceDirection === -1 ? -1 : 1,
      incrementPx: clampInt(node.spliceIncrementPx ?? DEFAULT_SPLICE_INCREMENT_PX, 0, MAX_SPLICE_INCREMENT_PX),
      offsetMs,
      order: node.spliceOrder ?? 'up',
      // Zeroed off the hoop partition: elsewhere the primary axis IS the drum, so letting this
      // through would delay every unit twice over.
      drumOffsetMs: (node.splicePartition ?? 'hoop') === 'hoop' ? drumOffsetMs : 0,
      drumOrder: node.spliceDrumOrder ?? 'up',
      smudge: clamp01(node.spliceSmudge ?? 0),
      motionMode: node.spliceMotionMode ?? 'restart',
      waitMode: node.spliceWaitMode ?? 'lit',
      envelope,
      tint: clamp01(node.spliceTint ?? 1),
      colors,
      inputBySlot,
    },
    members,
  };
}

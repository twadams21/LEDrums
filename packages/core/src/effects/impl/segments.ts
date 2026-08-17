/**
 * Segments — divide the struck drum into angular wedges, colour them from a generator
 * (never twenty pickers), and fire them in a chosen order.
 *
 * Three orthogonal axes, so the param surface stays small while the look space stays wide:
 *   1. SEGMENTATION — how many wedges, where wedge 0 starts, and how their edges read
 *      (`gap` carves dark lanes between them, `feather` softens the boundary).
 *   2. COLOUR — a `palette` generator maps segment index → hue from one base `hue` plus a
 *      single `hueSpread`. Manual per-segment colour is reached through routing, not through
 *      N pickers: `fire: 'single'` lights exactly one wedge, so N play nodes off one trigger
 *      give N independently-coloured wedges (see the module note in metadata).
 *   3. FIRING — `fire` chooses which wedges light and in what order WITHIN one hit. Ordering
 *      is resolved once into a permutation (`buildSegmentOrder`) that every order-sensitive
 *      knob reads, so `direction`/`stride`/`segmentOffset` mean the same thing in every mode.
 *
 * Cross-hit advancement is deliberately NOT in here — the voice engine gives each hit a fresh
 * `genState`, so an in-effect hit counter would advance under the offline sim and never under
 * the real engine. Exact per-hit stepping is the graph's `sequence` node driving N
 * `fire: 'single'` play nodes; random-per-hit is a `random` modulation source on
 * `segmentOffset`. Both are existing routing, not duplicated here.
 *
 * Pure + deterministic: no wall clock, no `Math.random`. All randomness derives from the
 * voice's per-trigger seed via `mulberry32`.
 */
import { hsvToRgb } from '../../color/color';
import { clamp01, mulberry32, wrap } from '../../math';
import { createEmitterState, updateEmissions, type EmitterState } from '../emitter';
import { pnum, pstr, type EffectGenerator } from '../types';
import { lifeFade } from '../life-fade';

/** Hard ceiling on wedge count — also the size of the cached order buffers. */
export const MAX_SEGMENTS = 32;

export interface SegmentsState {
  em: EmitterState;
  /** Per-voice seed, used by the `random` palette and the `random` fire order. */
  seed: number;
  /** step k → segment index. */
  order: Int32Array;
  /** segment index → step k. */
  ordOf: Int32Array;
  /** Cache key for the resolved order; rebuilt only when the shaping params change. */
  orderKey: string;
  /** Scratch, one slot per segment — level and hue, refilled per emission. */
  segLevel: Float32Array;
  segHue: Float32Array;
}

/**
 * Which wedge a pixel's angle falls in, and how far through that wedge it sits.
 * `angleDeg` is `Pixel.angleDeg` (already carries the drum's `startAngleDeg` +
 * `localSpinDeg`, baked at model-build time — never re-apply them here).
 * Returns `frac` in [0,1): 0 at the wedge's leading edge, →1 at its trailing edge.
 */
export function segmentAt(angleDeg: number, rotationDeg: number, segments: number): { index: number; frac: number } {
  const n = Math.max(2, Math.min(MAX_SEGMENTS, Math.round(segments)));
  const span = 360 / n;
  const raw = wrap(angleDeg - rotationDeg, 360) / span;
  const floor = Math.floor(raw);
  return { index: wrap(floor, n), frac: raw - floor };
}

/**
 * The firing order: a permutation of `0..n-1` starting at `offset` and stepping by
 * `dirSign * stride`. When `stride` shares a factor with `n` the naive walk would revisit
 * wedges and miss others, so an already-visited landing point advances by one until it finds
 * a free wedge — guaranteeing every wedge appears exactly once, for any `n`/`stride` pair.
 * `shuffleSeed` (the `random` fire mode) shuffles the result with a seeded Fisher–Yates.
 */
export function buildSegmentOrder(
  n: number,
  offset: number,
  stride: number,
  dirSign: number,
  shuffleSeed: number | null,
  order: Int32Array,
  ordOf: Int32Array,
): void {
  const visited = new Uint8Array(n);
  let cursor = wrap(offset, n);
  for (let k = 0; k < n; k++) {
    while (visited[cursor] === 1) cursor = wrap(cursor + 1, n);
    order[k] = cursor;
    visited[cursor] = 1;
    cursor = wrap(cursor + dirSign * stride, n);
  }
  if (shuffleSeed !== null) {
    const rng = mulberry32(shuffleSeed);
    for (let k = n - 1; k > 0; k--) {
      const j = Math.floor(rng() * (k + 1)) % (k + 1);
      const tmp = order[k]!;
      order[k] = order[j]!;
      order[j] = tmp;
    }
  }
  for (let k = 0; k < n; k++) ordOf[order[k]!] = k;
}

/** Triangle wave over [0, span] — the `ping-pong` head position. */
function pingPong(v: number, span: number): number {
  if (span <= 0) return 0;
  const t = wrap(v, span * 2);
  return t <= span ? t : span * 2 - t;
}

/** Hue for wedge `index` under the chosen generator. Exported so the generators can be
    asserted directly, independent of the framebuffer. */
export function paletteHue(palette: string, index: number, n: number, hue: number, spread: number, seed: number): number {
  switch (palette) {
    case 'sweep':
      return hue + spread * (n > 1 ? index / n : 0);
    case 'hue-step':
      return hue + spread * index;
    case 'cycle3':
      return hue + spread * (index % 3);
    case 'random': {
      // Hashed per index rather than drawn from a running stream, so a wedge's hue is
      // stable regardless of the order wedges are visited in.
      const r = mulberry32((seed + Math.imul(index, 0x9e3779b1)) >>> 0)();
      return hue + spread * (r - 0.5);
    }
    case 'alternate':
    default:
      return hue + spread * (index % 2);
  }
}

export const segments: EffectGenerator<SegmentsState> = {
  id: 'segments',
  name: 'Segments',
  category: 'trigger',
  description:
    'Slices the struck drum into angular wedges and fires them — all at once, chasing in order, every second one, bouncing, or in a seeded random order. Colours come from a generator (alternate, sweep, hue-step, cycle, random) so twenty wedges is still one hue and one spread, never twenty pickers. Set Fire to "single" and one node owns one wedge, so a sequence node steps wedges per hit and stacked nodes give hand-picked colours.',
  tags: ['band', 'hit', 'per-drum', 'hoop-aware', 'beat-synced', 'emission', 'seeded'],
  timebase: 'voice',
  // Its wedges fade on a hard `1 - ageBeats / lifeBeats`, so the host voice must live that
  // long or the Life slider looks inert (flagged 2026-08-16, landed with S6b).
  voiceLife: { key: 'lifeBeats', unit: 'beats' },
  paramSpec: [
    // --- segmentation ---
    { key: 'segments', label: 'Segments', type: 'number', default: 8, min: 2, max: MAX_SEGMENTS, step: 1 },
    { key: 'rotationDeg', label: 'Rotation', type: 'number', default: 0, min: 0, max: 360, step: 1, unit: '°' },
    { key: 'gap', label: 'Gap', type: 'number', default: 0.06, min: 0, max: 0.9, step: 0.01, unit: 'wedge' },
    { key: 'feather', label: 'Feather', type: 'number', default: 0.2, min: 0, max: 1, step: 0.01, unit: 'wedge' },
    // --- colour ---
    {
      key: 'palette',
      label: 'Palette',
      type: 'enum',
      default: 'alternate',
      options: ['alternate', 'cycle3', 'sweep', 'hue-step', 'random'],
    },
    { key: 'hue', label: 'Hue', type: 'number', default: 200, min: 0, max: 360, unit: '°' },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'hueSpread', label: 'Hue Spread', type: 'number', default: 140, min: -360, max: 360, step: 1, unit: '°' },
    // --- firing ---
    {
      key: 'fire',
      label: 'Fire',
      type: 'enum',
      default: 'chase',
      options: ['chase', 'all', 'every-nth', 'ping-pong', 'random', 'single'],
    },
    { key: 'speed', label: 'Speed', type: 'number', default: 4, min: 0.25, max: 32, step: 0.25, unit: 'seg/beat' },
    { key: 'width', label: 'Width', type: 'number', default: 1, min: 1, max: 8, step: 1, unit: 'seg' },
    { key: 'tail', label: 'Tail', type: 'number', default: 4, min: 0, max: 16, step: 0.5, unit: 'seg' },
    { key: 'stride', label: 'Stride', type: 'number', default: 1, min: 1, max: 8, step: 1, unit: 'seg' },
    { key: 'segmentOffset', label: 'Start Segment', type: 'number', default: 0, min: 0, max: MAX_SEGMENTS - 1, step: 1 },
    { key: 'direction', label: 'Direction', type: 'enum', default: 'cw', options: ['cw', 'ccw'] },
    // --- expression ---
    { key: 'lifeBeats', label: 'Decay', type: 'number', default: 3, min: 0.25, max: 16, step: 0.25, unit: 'beats' },
    { key: 'stagger', label: 'Stagger', type: 'number', default: 0, min: 0, max: 1, step: 0.01, unit: '× life' },
    { key: 'falloff', label: 'Falloff', type: 'number', default: 0, min: -1, max: 1, step: 0.01 },
    { key: 'radial', label: 'Radial Tilt', type: 'number', default: 0, min: -1, max: 1, step: 0.01 },
  ],

  createState(_model, seed): SegmentsState {
    return {
      em: createEmitterState(),
      seed: (seed ?? 0x9e3779b9) >>> 0,
      order: new Int32Array(MAX_SEGMENTS),
      ordOf: new Int32Array(MAX_SEGMENTS),
      orderKey: '',
      segLevel: new Float32Array(MAX_SEGMENTS),
      segHue: new Float32Array(MAX_SEGMENTS),
    };
  },

  render(ctx, params, fb, state) {
    const n = Math.max(2, Math.min(MAX_SEGMENTS, Math.round(pnum(params, 'segments', 8))));
    const rotationDeg = pnum(params, 'rotationDeg', 0);
    const gap = clamp01(pnum(params, 'gap', 0.06));
    const feather = clamp01(pnum(params, 'feather', 0.2));

    const palette = pstr(params, 'palette', 'alternate');
    const hue = pnum(params, 'hue', 200);
    const sat = pnum(params, 'saturation', 1);
    const bri = pnum(params, 'brightness', 1);
    const spread = pnum(params, 'hueSpread', 140);

    const fire = pstr(params, 'fire', 'chase');
    const speed = Math.max(0.01, pnum(params, 'speed', 4));
    const width = Math.max(1, Math.min(n, Math.round(pnum(params, 'width', 1))));
    const tail = Math.max(0, pnum(params, 'tail', 4));
    const stride = Math.max(1, Math.round(pnum(params, 'stride', 1)));
    const offset = wrap(Math.round(pnum(params, 'segmentOffset', 0)), n);
    const dirSign = pstr(params, 'direction', 'cw') === 'ccw' ? -1 : 1;

    const lifeBeats = Math.max(0.05, pnum(params, 'lifeBeats', 3));
    const stagger = clamp01(pnum(params, 'stagger', 0));
    const falloff = pnum(params, 'falloff', 0);
    const radial = pnum(params, 'radial', 0);

    // Order is shaping-only, so cache it across frames and rebuild on a param change.
    const orderKey = `${n}|${offset}|${stride}|${dirSign}|${fire === 'random' ? 1 : 0}`;
    if (state.orderKey !== orderKey) {
      buildSegmentOrder(n, offset, stride, dirSign, fire === 'random' ? state.seed : null, state.order, state.ordOf);
      state.orderKey = orderKey;
    }
    const ordOf = state.ordOf;

    for (let i = 0; i < n; i++) state.segHue[i] = paletteHue(palette, i, n, hue, spread, state.seed);

    const bpm = ctx.transport.bpm || 120;
    const msPerBeat = 60000 / bpm;
    const emissions = updateEmissions(state.em, ctx, lifeBeats * msPerBeat, () => undefined);

    // Edge shaping is per-wedge-fraction and identical for every wedge — resolve the core
    // window once. `gap` carves an equal dark lane off each side; `feather` ramps the
    // remaining core in from both edges. gap = feather = 0 ⇒ exact, hard boundaries.
    const core = 1 - gap;
    const gapHalf = gap * 0.5;
    const featherHalf = feather * 0.5;

    for (const em of emissions) {
      const drum = ctx.model.drumById.get(em.drumId);
      if (!drum) continue;
      const ageBeats = em.ageMs / msPerBeat;
      const fade = lifeFade(ctx, clamp01(1 - ageBeats / lifeBeats));
      const gain = fade * em.velocity * bri;
      if (gain < 0.004) continue;

      const head = ageBeats * speed;
      const bounce = pingPong(head, n - 1);

      for (let seg = 0; seg < n; seg++) {
        const k = ordOf[seg]!;
        let lvl: number;
        switch (fire) {
          case 'chase':
          case 'random': {
            // Wrapped so the head laps the drum for as long as the emission lives.
            const behind = wrap(head - k, n);
            const past = behind - (width - 1);
            lvl = past <= 0 ? 1 : tail > 0 ? clamp01(1 - past / tail) : 0;
            break;
          }
          case 'ping-pong': {
            const d = Math.abs(k - bounce);
            const past = d - (width - 1);
            lvl = past <= 0 ? 1 : tail > 0 ? clamp01(1 - past / tail) : 0;
            break;
          }
          case 'every-nth': {
            lvl = wrap(seg - offset, n) % stride === 0 ? 1 : 0;
            break;
          }
          case 'single': {
            lvl = wrap(seg - offset, n) < width ? 1 : 0;
            break;
          }
          case 'all':
          default:
            lvl = 1;
            break;
        }
        // Stagger rolls the onset across the firing order — a bloom instead of a flat hit.
        // Order-driven modes already carry their own timing, so it applies to the static ones.
        if (lvl > 0 && stagger > 0 && (fire === 'all' || fire === 'every-nth' || fire === 'single')) {
          const onset = stagger * (n > 1 ? k / n : 0) * lifeBeats;
          if (ageBeats < onset) lvl = 0;
        }
        if (lvl > 0 && falloff !== 0) {
          const t = n > 1 ? k / (n - 1) : 0;
          lvl *= clamp01(1 - Math.abs(falloff) * (falloff >= 0 ? t : 1 - t));
        }
        state.segLevel[seg] = lvl * gain;
      }

      const end = drum.pixelStart + drum.pixelCount;
      for (let i = drum.pixelStart; i < end; i++) {
        const p = ctx.model.pixels[i]!;
        const { index, frac } = segmentAt(p.angleDeg, rotationDeg, n);
        const base = state.segLevel[index]!;
        if (base < 0.004) continue;

        // Wedge-local shaping: dark gap lane, then a feathered ramp into the core.
        let mask = 1;
        if (gap > 0) {
          if (frac < gapHalf || frac > 1 - gapHalf) continue;
          mask = 1;
        }
        if (feather > 0) {
          const u = core > 0 ? (frac - gapHalf) / core : 0;
          const edge = u < 1 - u ? u : 1 - u;
          mask = clamp01(edge / featherHalf);
          if (mask <= 0) continue;
        }

        // Radial tilt: bias intensity toward the head side (negative) or shell side (positive).
        let v = base * mask;
        if (radial !== 0) {
          v *= clamp01(1 - Math.abs(radial) * (radial >= 0 ? p.normHoop : 1 - p.normHoop));
        }
        if (v < 0.004) continue;
        const rgb = hsvToRgb(state.segHue[index]!, sat, v);
        fb.max(p.id, rgb.r, rgb.g, rgb.b, v);
      }
    }
  },
};

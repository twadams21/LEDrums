/**
 * Node-face signal previews (doc 10, S38) — the PURE geometry/value layer behind the
 * source-node previews (envelope shape + phase cursor, LFO waveform + moving phase, CC
 * live value bar) and the exposed-param-row live ticks.
 *
 * Every value here is sampled through the SAME core functions the engine samples with —
 * `voice.sampleEnvelope` / `voice.sampleLfo` / `voice.sampleCc` / `voice.sampleSource` —
 * so a preview can never draw a waveform the render path wouldn't produce. No DOM, no rAF,
 * no time source of its own: the caller passes `tMs` (the shared thumbnail ticker's clock),
 * which keeps this module unit-testable and lets the ONE ticker drive every preview.
 *
 * The drawing (canvas) lives in `SignalFace.svelte`; the shape of what to draw lives here.
 */
import { voice } from '@ledrums/core';

/** The loop window a PHASE-based preview (envelope) sweeps its cursor over. Reuses the
    thumbnail loop feel (`THUMB_LOOP_MS`) so a source preview and an effect thumbnail on the
    same canvas breathe at the same rate. Continuous sources (LFO) use their own period. */
export const PREVIEW_LOOP_MS = 1600;

/** The representative frame a reduced-motion preview freezes at (matches EffectThumb's static
    frame): the cursor sits a quarter of the way in — enough to read the shape, no animation. */
export const PREVIEW_STATIC_MS = 400;

/** Number of segments a waveform/shape polyline is sampled at — dense enough to read a curve
    on a ~56px face, cheap enough to redraw every frame. */
const SHAPE_SAMPLES = 40;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
/** Fractional part in [0,1), correct for negatives (`frac(-0.25) === 0.75`). */
export const frac = (x: number): number => x - Math.floor(x);

/**
 * The clock a TRIGGER-DRIVEN preview reads (TouchDesigner-style live-on-trigger): a node face is
 * STATIC until its graph fires, then plays live from that instant for one `windowMs` hit, then
 * settles back to the static frame. Pure: given the graph's fire epoch (`fireAt`, a
 * `performance.now()` timestamp or null) and the shared ticker's `now`, it returns whether the
 * preview is actively firing and the LOCAL time to sample at (0 at the fire instant).
 *
 * · not fired yet, or the hit window has elapsed → `{ firing:false, localMs: PREVIEW_STATIC_MS }`
 *   (a readable representative still — same frame reduced-motion freezes at).
 * · within the window → `{ firing:true, localMs: now - fireAt }` (live from t=0).
 */
export function triggerClock(
  fireAt: number | null | undefined,
  now: number,
  windowMs = PREVIEW_LOOP_MS,
): { firing: boolean; localMs: number } {
  if (fireAt == null) return { firing: false, localMs: PREVIEW_STATIC_MS };
  const elapsed = now - fireAt;
  if (elapsed < 0 || elapsed > windowMs) return { firing: false, localMs: PREVIEW_STATIC_MS };
  return { firing: true, localMs: elapsed };
}

/**
 * Trigger-driven pulse intensity for a STATE face (chance/toggle/all/random/switch/modifier
 * previews): 1 at the fire instant, easing out to 0 over `windowMs`; 0 when idle or before the
 * fire. Pure — same contract as {@link triggerClock}, but for a flash rather than a sweep.
 */
export function firePulse(fireAt: number | null | undefined, now: number, windowMs = 420): number {
  if (fireAt == null || windowMs <= 0) return 0;
  const elapsed = now - fireAt;
  if (elapsed < 0 || elapsed >= windowMs) return 0;
  const t = 1 - elapsed / windowMs;
  return t * t; // ease-out
}

/**
 * Deterministic pick of one of `n` fan lines from a fire epoch — the random node's preview
 * highlights a different (but reproducible-given-the-epoch) child line per fire. Display-only:
 * the ENGINE's pick uses its own seeded PRNG; this only needs to look plausibly random.
 */
export function firePick(fireAt: number, n: number): number {
  if (n <= 0) return 0;
  let h = Math.imul((Math.floor(fireAt) >>> 0) ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) % n;
}

/**
 * Delay-node preview progress: 0 idle, fills 0→1 across the wait after a fire, then back to 0
 * once the delayed children have fired (the arrival flash is `firePulse(fireAt + delayMs, now)`).
 */
export function delayProgress(
  fireAt: number | null | undefined,
  now: number,
  delayMs: number,
): number {
  if (fireAt == null || delayMs <= 0) return 0;
  const elapsed = now - fireAt;
  if (elapsed < 0 || elapsed >= delayMs) return 0;
  return elapsed / delayMs;
}

/** A point on a preview polyline. `x` runs 0→1 left→right; `y` is the 0..1 signal (1 = top). */
export interface PreviewPoint {
  x: number;
  y: number;
}

/**
 * A source's preview: the static `shape` polyline over one cycle, the live `cursor` x-position
 * (0..1), and the signal `value` at that cursor (0..1). Envelope and LFO both produce this; the
 * CC source has no shape (its signal is a single live level — see {@link ccPreviewValue}).
 */
export interface SignalTrace {
  shape: PreviewPoint[];
  cursor: number;
  value: number;
}

/**
 * Envelope source preview: the shape sampled across life-phase 0..1 (static), with the cursor
 * sweeping that phase over `loopMs` — an envelope has no absolute clock, so the preview replays
 * one hit forever (like the thumbnail's synthetic hit). `value` is the shape at the cursor.
 */
export function envelopeTrace(env: voice.Envelope, tMs: number, loopMs = PREVIEW_LOOP_MS): SignalTrace {
  const shape: PreviewPoint[] = [];
  for (let i = 0; i <= SHAPE_SAMPLES; i++) {
    const x = i / SHAPE_SAMPLES;
    shape.push({ x, y: clamp01(voice.sampleEnvelope(env, x)) });
  }
  const cursor = loopMs > 0 ? frac(tMs / loopMs) : 0;
  return { shape, cursor, value: clamp01(voice.sampleEnvelope(env, cursor)) };
}

/**
 * LFO source preview: the waveform sampled across one displayed period (static), with the cursor
 * = `frac(tMs / period)` and `value = sampleLfo(s, tMs, bpm)` — identical to the value a mapping
 * would read at `tMs`, so the moving cursor always sits on the drawn curve. A frozen LFO
 * (period ≤ 0: rate 0, or a beats rate with bpm ≤ 0) shows a flat line at its static value.
 */
export function lfoTrace(s: voice.LfoSettings, tMs: number, bpm: number): SignalTrace {
  const period = voice.lfoPeriodMs(s, bpm);
  const shape: PreviewPoint[] = [];
  for (let i = 0; i <= SHAPE_SAMPLES; i++) {
    const x = i / SHAPE_SAMPLES;
    // Sample by displayed phase: t = period·x ⇒ intrinsic phase x + s.phase (frozen ⇒ static).
    const y = period > 0 ? voice.sampleLfo(s, period * x, bpm) : voice.sampleLfo(s, 0, bpm);
    shape.push({ x, y: clamp01(y) });
  }
  const cursor = period > 0 ? frac(tMs / period) : frac(s.phase);
  return { shape, cursor, value: clamp01(voice.sampleLfo(s, tMs, bpm)) };
}

/**
 * Random SOURCE distribution preview: the probability-density curve of a distribution — x runs
 * 0..1 across the output range, y is the (peak-normalized) likelihood of landing there. Sampled
 * through the SAME core `voice.sampleRandomDistribution` the engine draws with, so the drawn
 * curve can never lie about what the node emits (`stepped` quantizes to its comb via
 * `voice.quantizeSteppedRandom`). Static — depends only on `distribution` + `steps`, so callers
 * compute it once (a `$derived`), never per frame. Deterministic: a fixed-seed LCG stands in for
 * the engine's PRNG, so the histogram never flickers between renders.
 */
export function randomDistributionTrace(
  distribution: voice.RandomDistribution,
  steps?: number,
  samples = 16384,
): PreviewPoint[] {
  // Fixed-seed LCG (Numerical Recipes constants) — a deterministic uniform stream so the density
  // is identical every call; the engine's real pick uses its own seeded PRNG.
  let s = 0x2545f491 >>> 0;
  const rng = {
    next: (): number => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 0x100000000;
    },
  };
  const bins = new Array<number>(SHAPE_SAMPLES).fill(0);
  for (let i = 0; i < samples; i++) {
    let v = clamp01(voice.sampleRandomDistribution(distribution, rng));
    if (distribution === 'stepped') v = voice.quantizeSteppedRandom(v, steps);
    const b = Math.min(SHAPE_SAMPLES - 1, Math.floor(v * SHAPE_SAMPLES));
    bins[b] = (bins[b] ?? 0) + 1;
  }
  const peak = Math.max(1, ...bins);
  const shape: PreviewPoint[] = [];
  for (let i = 0; i <= SHAPE_SAMPLES; i++) {
    // Sample bin centers; the endpoints (i=0, i=SHAPE_SAMPLES) clamp to the outer bins so the
    // filled area closes cleanly at both edges.
    const bin = Math.min(SHAPE_SAMPLES - 1, i);
    shape.push({ x: i / SHAPE_SAMPLES, y: (bins[bin] ?? 0) / peak });
  }
  return shape;
}

/** CC source preview: the live 0..1 level from the engine's CC table (the offline mirror in the
    sim). No shape — the face draws a value bar + numeric readout. Absent/unheard ⇒ 0. */
export function ccPreviewValue(
  table: voice.CcTable | undefined,
  controller: number,
  channel: number | null,
): number {
  return clamp01(voice.sampleCc(table, controller, channel));
}

/** Format a 0..1 preview level as its raw MIDI value (0..127) for the CC readout — the number a
    performer actually sends, more legible than a normalized fraction. */
export function formatCcReadout(value01: number): string {
  return String(Math.round(clamp01(value01) * 127));
}

/**
 * The exposed-param row's live tick value (0..1): the mean of its wired sources' post-invert
 * signals — "how hard are the sources driving this param right now". Each source is sampled
 * through core `sampleSource` (envelope reads `ctx.phase`, LFO reads `ctx.timeMs`/`bpm`, CC reads
 * `ctx.cc`), so the tick reflects the real signal, not a UI re-derivation. No wires ⇒ 0.
 *
 * (A normalized source drive, deliberately independent of each mapping's amount/range — the row
 * shows that the param is being animated and how strongly the sources swing, not the exact param
 * value, which the compositor owns.)
 */
export function paramRowSignal(
  sources: readonly { source: voice.ModSource; invert: boolean }[],
  ctx: voice.ModSampleCtx,
): number {
  if (sources.length === 0) return 0;
  let sum = 0;
  for (const s of sources) {
    const raw = clamp01(voice.sampleSource(s.source, ctx));
    sum += s.invert ? 1 - raw : raw;
  }
  return clamp01(sum / sources.length);
}

/**
 * Build the {@link voice.ModSampleCtx} a preview samples with at ticker time `tMs`: the envelope
 * `phase` loops over {@link PREVIEW_LOOP_MS} (one synthetic hit, forever), while `timeMs`/`bpm`/
 * `cc` are the live continuous inputs LFO/CC read. One helper so every preview builds the context
 * identically.
 */
export function previewCtx(
  tMs: number,
  bpm: number,
  cc: voice.CcTable | undefined,
  osc?: voice.OscTable | undefined,
): voice.ModSampleCtx {
  return { phase: frac(tMs / PREVIEW_LOOP_MS), timeMs: tMs, bpm, cc, osc };
}

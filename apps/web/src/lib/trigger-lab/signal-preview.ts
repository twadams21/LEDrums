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
export function previewCtx(tMs: number, bpm: number, cc: voice.CcTable | undefined): voice.ModSampleCtx {
  return { phase: frac(tMs / PREVIEW_LOOP_MS), timeMs: tMs, bpm, cc };
}

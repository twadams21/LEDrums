/**
 * Strobe / Shutter — a rate/duty chop. Gates the voice's output between the input and an
 * OFF state at a fixed frequency: during the "on" slice of each cycle the frame passes
 * through; during the "off" slice the range shows the off state. Classic shutter / strobe.
 *
 * The phase is read from the host voice's LOCAL clock (`ctx.timeMs`, the voice's age —
 * never wall-clock), so the chop starts with the voice and every replay lines up:
 *   phase = (timeMs mod periodMs) / periodMs,   periodMs = 1000 / rate
 *   on    = phase < duty
 *
 * Off state (`offMode`):
 * - `black` (default, the original behaviour): the range is blanked to transparent black.
 * - `dim`: the input scaled by `offLevel` (0..1); coverage (alpha) is kept.
 * - `colour`: the range is filled with `offColor` (fully covered), so the strobe
 *   alternates between the input and that colour — a two-tone strobe.
 *
 * `fade` (0..1) shapes the flash as a smooth window over the on slice. 0 is the hard gate.
 * Above 0, with `u = phase / duty` the position inside the on slice and `e = fade / 4`:
 *   gate(u) = S(0, e, u) · (1 − S(1 − e, 1, u)) · (1 − fade/2 · S(e, 1 − e, u))
 * (S = smoothstep): a soft rise over the first `e` of the flash, a per-flash decay that
 * sags the body to `1 − fade/2`, and a soft fall to the off state over the last `e`. The
 * output is `off + (input − off) · gate`, so the edges pass through intermediate values.
 *
 * Speed (`rateMode`): `hz` (default — shows saved before this read back unchanged) flashes
 * `rate` times a second; `beats` flashes once per `division` of the transport tempo
 * (`ctx.bpm`, 120 when the host has none), e.g. `1/16` at 120 bpm = 125 ms = 8 Hz — Tim,
 * 2026-10-01: "an option for the speed to be either in Hz or subdivisions, as it is with
 * splice and slice".
 *
 * `rate` ≤ 0 or `duty` ≥ 1 → always on (identity); `duty` ≤ 0 → always off. Stateless and
 * deterministic: a pure function of the voice clock and its params. At default params
 * (`offMode: black`, `fade: 0`) the output is bit-identical to the original hard gate.
 */
import { hexToRgb } from '../../color/color';
import { clamp01 } from '../../math';
import { pnum, pstr } from '../../effects/types';
import { DELAY_DIVISIONS, computeDelayMs } from '../../voice/delay';
import type { ModifierDef, PixelRange } from '../types';

function smoothstep(e0: number, e1: number, x: number): number {
  if (e1 <= e0) return x < e0 ? 0 : 1;
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** Flash gain for a phase inside the cycle: 1 = input, 0 = off state. */
function gateAt(phase: number, duty: number, fade: number): number {
  if (duty <= 0 || phase >= duty) return 0;
  if (fade <= 0) return 1;
  const u = phase / duty;
  const e = fade * 0.25;
  const rise = smoothstep(0, e, u);
  const fall = 1 - smoothstep(1 - e, 1, u);
  const decay = 1 - fade * 0.5 * smoothstep(e, 1 - e, u);
  return rise * fall * decay;
}

/** One flash cycle in ms: `1000 / rate` in Hz, else one `division` at `bpm`. 0 = no strobe. */
export function strobePeriodMs(params: Parameters<ModifierDef['apply']>[1], bpm: number | undefined): number {
  if (pstr(params, 'rateMode', 'hz') === 'beats') {
    const tempo = bpm !== undefined && bpm > 0 ? bpm : 120;
    return computeDelayMs('beats', 0, pstr(params, 'division', '1/16'), tempo);
  }
  const rate = pnum(params, 'rate', 8);
  return rate > 0 ? 1000 / rate : 0;
}

export const strobe: ModifierDef = {
  id: 'strobe',
  name: 'Strobe',
  category: 'temporal',
  scopePolicy: 'full-output',
  paramSpec: [
    { key: 'rateMode', label: 'Speed', type: 'enum', default: 'hz', options: ['hz', 'beats'] },
    { key: 'division', label: 'Division', type: 'enum', default: '1/16', options: [...DELAY_DIVISIONS] },
    { key: 'rate', label: 'Rate', type: 'number', default: 8, min: 0.1, max: 40, step: 0.1, unit: 'Hz' },
    { key: 'duty', label: 'Duty', type: 'number', default: 0.5, min: 0, max: 1, step: 0.05 },
    { key: 'offMode', label: 'Off state', type: 'enum', default: 'black', options: ['black', 'dim', 'colour'] },
    { key: 'offLevel', label: 'Off level', type: 'number', default: 0.25, min: 0, max: 1, step: 0.01 },
    { key: 'offColor', label: 'Off colour', type: 'color', default: '#ffffff' },
    { key: 'fade', label: 'Fade', type: 'number', default: 0, min: 0, max: 1, step: 0.01 },
  ],

  apply(ctx, params, fb, range: PixelRange): void {
    const duty = pnum(params, 'duty', 0.5);
    const periodMs = strobePeriodMs(params, ctx.bpm);
    if (!(periodMs > 0) || !Number.isFinite(periodMs) || duty >= 1) return; // always on → identity
    const fade = clamp01(pnum(params, 'fade', 0));
    const phase = ((ctx.timeMs % periodMs) + periodMs) % periodMs / periodMs; // [0,1), robust to <0
    const g = gateAt(phase, duty, fade);
    if (g >= 1) return; // fully on → pass through
    const out = fb.rgba;
    const mode = pstr(params, 'offMode', 'black');

    if (mode === 'dim') {
      const lvl = clamp01(pnum(params, 'offLevel', 0.25));
      const k = lvl + (1 - lvl) * g;
      for (let i = range.start; i < range.end; i++) {
        const j = i * 4;
        out[j] = out[j]! * k;
        out[j + 1] = out[j + 1]! * k;
        out[j + 2] = out[j + 2]! * k;
      }
      return;
    }

    if (mode === 'colour') {
      const { r, g: gc, b } = hexToRgb(pstr(params, 'offColor', '#ffffff'));
      for (let i = range.start; i < range.end; i++) {
        const j = i * 4;
        out[j] = r + (out[j]! - r) * g;
        out[j + 1] = gc + (out[j + 1]! - gc) * g;
        out[j + 2] = b + (out[j + 2]! - b) * g;
        out[j + 3] = 1 + (out[j + 3]! - 1) * g;
      }
      return;
    }

    // black (default; unknown modes fall back here).
    if (g <= 0) {
      // Hard off window: blank the range to black — the original path, bit for bit.
      for (let i = range.start; i < range.end; i++) {
        const j = i * 4;
        out[j] = 0;
        out[j + 1] = 0;
        out[j + 2] = 0;
        out[j + 3] = 0;
      }
      return;
    }
    for (let i = range.start; i < range.end; i++) {
      const j = i * 4;
      out[j] = out[j]! * g;
      out[j + 1] = out[j + 1]! * g;
      out[j + 2] = out[j + 2]! * g;
      out[j + 3] = out[j + 3]! * g;
    }
  },
};

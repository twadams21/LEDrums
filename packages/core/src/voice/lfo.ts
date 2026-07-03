/**
 * LFO source node (doc 10, S36) — a continuous modulation source that is a PURE, deterministic
 * function of absolute time + transport tempo. Unlike an envelope (which restarts per voice
 * hit via the voice's life phase), an LFO reads `ctx.timeMs`/`ctx.bpm` so every live voice of
 * its targets — including looped and base voices — samples the SAME value at a given frame;
 * nothing phase-locks to a voice. No state, no wall-clock, no `Math.random` (AGENTS.md hard
 * rule): `sampleLfo(settings, t, bpm)` returns the same 0..1 value for the same `(t, bpm)`,
 * always — even sample-&-hold, whose value is hash-derived from the time bucket.
 *
 * Rate is either a free frequency in Hz or a musical division synced to bpm — the SAME division
 * vocabulary the delay node uses (`DELAY_DIVISIONS` / `computeDelayMs`), shared not forked, so a
 * `1/8` LFO period tracks tempo exactly like a `1/8` delay. Plugs into the modulation model as a
 * `ModSource` arm + one `sampleSource` case (see `modulation.ts`); the graph layer builds the
 * source via `nodeModSource` (see `modulation-graph.ts`).
 */
import { computeDelayMs } from './delay';

/** The waveform a bipolar-ish LFO traces over one period, mapped to a unipolar 0..1 signal
    (the sweep scales it into the mapping's `[rangeMin, rangeMax]`). `sample-hold` (S&H) holds
    one hash-derived value per period — random-looking but fully deterministic in `(t, bpm)`. */
export const LFO_WAVEFORMS = ['sine', 'triangle', 'saw', 'square', 'sample-hold'] as const;
export type LfoWaveform = (typeof LFO_WAVEFORMS)[number];

/** How an LFO's rate is specified: a free frequency in Hz, or a musical division synced to bpm. */
export type LfoRateMode = 'hz' | 'beats';

/**
 * An LFO source node's settings (stored on `GraphNode.lfo`). `waveform` picks the shape;
 * `rateMode` chooses free `rateHz` vs bpm-synced `division` (a `DELAY_DIVISIONS` string);
 * `phase` is a 0..1 offset applied before sampling (0.25 = quarter-cycle ahead). A source has
 * no per-mapping depth/range of its own — that is edited target-side on each wire.
 */
export interface LfoSettings {
  waveform: LfoWaveform;
  rateMode: LfoRateMode;
  /** Free-running frequency in Hz (used when `rateMode === 'hz'`). */
  rateHz: number;
  /** Musical division string (used when `rateMode === 'beats'`); one of `DELAY_DIVISIONS`. */
  division: string;
  /** Phase offset 0..1 applied before sampling (wraps). */
  phase: number;
}

/** A sensible default LFO: a 1 Hz sine, no phase offset. */
export function defaultLfoSettings(): LfoSettings {
  return { waveform: 'sine', rateMode: 'hz', rateHz: 1, division: '1/4', phase: 0 };
}

/**
 * The LFO's period in milliseconds. Hz mode: `1000 / rateHz`. Beats mode: the division resolved
 * against `bpm` via the shared delay math (so `1/8` here == `1/8` on a delay node). A non-positive
 * rate (rateHz ≤ 0, or bpm ≤ 0) yields `0`, which `sampleLfo` treats as "frozen" (static at the
 * phase offset) rather than dividing by zero.
 */
export function lfoPeriodMs(s: LfoSettings, bpm: number): number {
  if (s.rateMode === 'beats') {
    return bpm > 0 ? computeDelayMs('beats', 0, s.division, bpm) : 0;
  }
  return s.rateHz > 0 ? 1000 / s.rateHz : 0;
}

/** A deterministic 0..1 hash of an integer (S&H per-period value). Integer avalanche
    (Murmur-style finaliser) — no state, no `Math.random`, stable across runs and platforms. */
function hash01(n: number): number {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = (x ^ (x >>> 16)) >>> 0;
  return x / 4294967296;
}

/** Map a wrapped phase `p` ∈ [0,1) to a 0..1 signal for a continuous waveform. */
function continuousWave(waveform: Exclude<LfoWaveform, 'sample-hold'>, p: number): number {
  switch (waveform) {
    case 'sine':
      return 0.5 + 0.5 * Math.sin(2 * Math.PI * p);
    case 'triangle':
      return p < 0.5 ? p * 2 : 2 * (1 - p);
    case 'saw':
      return p;
    case 'square':
      return p < 0.5 ? 1 : 0;
  }
}

/**
 * Sample the LFO to its 0..1 signal at absolute engine time `timeMs` and transport `bpm`. Pure
 * and deterministic: identical `(settings, timeMs, bpm)` always give the identical value. The
 * total phase is `timeMs / period + phase`; continuous waveforms sample its fractional part,
 * while `sample-hold` holds `hash01(floor(totalPhase))` for the whole period. A frozen LFO
 * (period ≤ 0) samples at the phase offset (S&H → bucket 0).
 */
export function sampleLfo(s: LfoSettings, timeMs: number, bpm: number): number {
  const period = lfoPeriodMs(s, bpm);
  const totalPhase = period > 0 ? timeMs / period + s.phase : s.phase;
  if (s.waveform === 'sample-hold') {
    return hash01(Math.floor(totalPhase));
  }
  const p = totalPhase - Math.floor(totalPhase); // wrap to [0,1)
  return continuousWave(s.waveform, p);
}

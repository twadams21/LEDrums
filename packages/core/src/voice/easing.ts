/**
 * Standard easing library — the Resolume-familiar set, single-sourced in core so
 * the web editor/sim import it instead of re-deriving (the `computeDelayMs`
 * precedent). Pure functions over the {@link EaseSpec} data model: no IO, no
 * wall-clock, no `Math.random`. Overshoot families (`back`, `elastic`) can return
 * values outside 0..1 by design — the caller ({@link adsrToPoints}) clamps the
 * rendered level.
 */
import type { EaseFn, EaseSpec } from './types';

/** `easeIn` form of each family: maps 0..1 → level, with `f(0)=0`, `f(1)=1`. */
type EaseImpl = (t: number) => number;

const C1 = 1.70158; //          back overshoot
const C3 = C1 + 1;
const C4 = (2 * Math.PI) / 3; // elastic period

/** Canonical `easeOutBounce` — the base the bounce family is derived from. */
function outBounce(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) {
    const u = t - 1.5 / d1;
    return n1 * u * u + 0.75;
  }
  if (t < 2.5 / d1) {
    const u = t - 2.25 / d1;
    return n1 * u * u + 0.9375;
  }
  const u = t - 2.625 / d1;
  return n1 * u * u + 0.984375;
}

/** The `in` form of every family. `out`/`inOut` are derived from these. */
const IN: Record<EaseFn, EaseImpl> = {
  linear: (t) => t,
  quad: (t) => t * t,
  cubic: (t) => t * t * t,
  quart: (t) => t * t * t * t,
  expo: (t) => (t === 0 ? 0 : Math.pow(2, 10 * (t - 1))),
  sine: (t) => 1 - Math.cos((t * Math.PI) / 2),
  circ: (t) => 1 - Math.sqrt(Math.max(0, 1 - t * t)),
  back: (t) => C3 * t * t * t - C1 * t * t,
  bounce: (t) => 1 - outBounce(1 - t),
  elastic: (t) =>
    t === 0 ? 0 : t === 1 ? 1 : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * C4),
};

const clampUnit = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Evaluate an ease at phase `t` (clamped to 0..1). `dir` composes the family's
 * `in` form: `out` mirrors it, `inOut` runs `in` on the first half and the mirror
 * on the second. Endpoints are exact (`ease(_, 0) === 0`, `ease(_, 1) === 1`) for
 * every family; `linear` is identical across all three directions.
 */
export function ease(spec: EaseSpec, t: number): number {
  const p = clampUnit(t);
  if (p === 0) return 0; // exact endpoints for every family (incl. overshoot) — no float dust
  if (p === 1) return 1;
  if (spec.fn === 'linear') return p; // identity in every direction — bit-exact, no round-trip
  const fn = IN[spec.fn] ?? IN.linear;
  switch (spec.dir) {
    case 'in':
      return fn(p);
    case 'out':
      return 1 - fn(1 - p);
    case 'inOut':
      return p < 0.5 ? fn(2 * p) / 2 : 1 - fn(2 - 2 * p) / 2;
    default:
      return p;
  }
}

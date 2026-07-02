/**
 * Envelope sampling + shape helpers (ported verbatim from `trigger-lab/sim.ts`).
 * Pure functions over the {@link Envelope} / {@link AdsrShape} data model — they
 * drive per-param sweeps over a voice's life.
 */
import type { AdsrShape, EaseSpec, EnvKind, Envelope, EnvPoint } from './types';
import { ease } from './easing';

const clampUnit = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Predefined envelope shape: life phase 0..1 → level 0..1. */
export function envShape(kind: EnvKind, p: number): number {
  switch (kind) {
    case 'decay':
      return 1 - p;
    case 'rise':
      return p;
    case 'pluck':
      return p < 0.12 ? p / 0.12 : Math.exp(-(p - 0.12) * 4);
    case 'pulse':
      return 0.5 + 0.5 * Math.sin(p * Math.PI * 2);
    default:
      return 1;
  }
}

/** Sample a preset shape into editable breakpoints. */
export function presetPoints(kind: EnvKind, n = 16): EnvPoint[] {
  if (kind === 'none' || kind === 'custom') {
    return [
      { t: 0, v: 1 },
      { t: 1, v: 1 },
    ];
  }
  const pts: EnvPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push({ t, v: clampUnit(envShape(kind, t)) });
  }
  return pts;
}

export function defaultEnvelope(kind: EnvKind): Envelope {
  return { kind, amount: 1, points: presetPoints(kind) };
}

/** Deep-copy an ADSR shape, including its per-segment {@link EaseSpec} sub-objects
    (a shallow spread would alias them across envelopes — an authoring hazard). */
export function cloneAdsr(a: AdsrShape): AdsrShape {
  return {
    ...a,
    attackEase: a.attackEase ? { ...a.attackEase } : undefined,
    decayEase: a.decayEase ? { ...a.decayEase } : undefined,
    releaseEase: a.releaseEase ? { ...a.releaseEase } : undefined,
  };
}

export function cloneEnvelope(e: Envelope): Envelope {
  return {
    kind: e.kind,
    amount: e.amount,
    points: e.points.map((p) => ({ ...p })),
    adsr: e.adsr ? cloneAdsr(e.adsr) : undefined,
  };
}

export function defaultAdsr(): AdsrShape {
  return { attack: 0.12, decay: 0.25, sustain: 0.5, release: 0.4, curve: 0 };
}

/** Legacy single-tension power law (-1..1). The v2 fallback for a segment whose
    per-segment {@link EaseSpec} is absent, so un-migrated shapes render unchanged. */
function easeCurve(t: number, curve: number): number {
  if (curve === 0) return t;
  const k = Math.abs(curve) * 3 + 1;
  return curve > 0 ? 1 - Math.pow(1 - t, k) : Math.pow(t, k);
}

/** Resolve a segment's easing: an explicit {@link EaseSpec} wins; otherwise fall
    back to the legacy `curve` power law (behaviour-preserving for legacy shapes). */
function segEase(spec: EaseSpec | undefined, curve: number, t: number): number {
  return spec ? ease(spec, t) : easeCurve(t, curve);
}

/**
 * Render an ADSR shape into editable breakpoints (the persisted curve). v2:
 * the attack rises to `attackLevel` (peak, default 1) and each segment eases
 * independently via its {@link EaseSpec}, falling back to the legacy `curve` when
 * absent. With `attackLevel` 1 and no per-segment eases this is byte-identical to
 * the pre-v2 renderer.
 */
export function adsrToPoints(a: AdsrShape, n = 48): EnvPoint[] {
  const sus = clampUnit(a.sustain);
  const peak = clampUnit(a.attackLevel ?? 1);
  const curve = a.curve ?? 0;
  const tA = Math.min(clampUnit(a.attack), 0.96);
  const tD = Math.min(tA + clampUnit(a.decay), 0.98);
  const tR = Math.max(tD, 1 - clampUnit(a.release));
  const pts: EnvPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let v: number;
    if (t <= tA) {
      v = tA <= 0 ? peak : peak * segEase(a.attackEase, curve, t / tA);
    } else if (t <= tD) {
      const f = (t - tA) / Math.max(1e-4, tD - tA);
      v = peak + (sus - peak) * segEase(a.decayEase, curve, f);
    } else if (t <= tR) {
      v = sus;
    } else {
      const f = (t - tR) / Math.max(1e-4, 1 - tR);
      v = sus * (1 - segEase(a.releaseEase, curve, f));
    }
    pts.push({ t, v: clampUnit(v) });
  }
  return pts;
}

const EASE_EPS = 1e-9;

/** Map a legacy `curve` to the standard ease that reproduces it *bit-identically*,
    or `null` when none does. Only `curve === 0` (linear) is IEEE-754-exact: the
    power law for `|curve|>0` uses `Math.pow`, which need not match a repeated-multiply
    ease in the last bit, so those are left on the `curve` fallback (already byte-exact)
    rather than risk sampling drift. */
function curveToExactEase(curve: number): EaseSpec | null {
  return Math.abs(curve) < EASE_EPS ? { fn: 'linear', dir: 'in' } : null;
}

/**
 * Behaviour-preserving, idempotent migration from a legacy single-`curve` shape to
 * the v2 per-segment form. A pure-legacy shape gains `attackLevel` (default 1) and,
 * where `curve` maps *exactly* to a standard ease, all three per-segment eases (the
 * `curve` is then dropped). When `curve` is not exactly representable it is retained
 * so the power-law fallback keeps sampling byte-identical — migration never alters
 * rendered output. A shape that already carries any authored ease is returned as-is
 * (only defaulting `attackLevel`), so authored v2 shapes are never clobbered.
 */
export function migrateAdsr(a: AdsrShape): AdsrShape {
  if (a.attackEase || a.decayEase || a.releaseEase) {
    return a.attackLevel === undefined ? { ...a, attackLevel: 1 } : a;
  }
  const attackLevel = a.attackLevel ?? 1;
  const eq = curveToExactEase(a.curve ?? 0);
  if (!eq) return { ...a, attackLevel };
  return {
    attack: a.attack,
    decay: a.decay,
    sustain: a.sustain,
    release: a.release,
    attackLevel,
    attackEase: { ...eq },
    decayEase: { ...eq },
    releaseEase: { ...eq },
  };
}

/** Piecewise-linear sample of an envelope's curve at life phase 0..1. */
export function sampleEnvelope(env: Envelope, phase: number): number {
  const pts = env.points;
  if (pts.length === 0) return 1;
  const t = clampUnit(phase);
  if (t <= pts[0]!.t) return pts[0]!.v;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if (t <= b.t) {
      const span = b.t - a.t;
      const f = span <= 0 ? 0 : (t - a.t) / span;
      return a.v + (b.v - a.v) * f;
    }
  }
  return pts[pts.length - 1]!.v;
}

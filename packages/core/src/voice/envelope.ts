/**
 * Envelope sampling + shape helpers (ported verbatim from `trigger-lab/sim.ts`).
 * Pure functions over the {@link Envelope} / {@link AdsrShape} data model — they
 * drive per-param sweeps over a voice's life.
 */
import type { AdsrShape, EnvKind, Envelope, EnvPoint } from './types';

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

export function cloneEnvelope(e: Envelope): Envelope {
  return {
    kind: e.kind,
    amount: e.amount,
    points: e.points.map((p) => ({ ...p })),
    adsr: e.adsr ? { ...e.adsr } : undefined,
  };
}

export function defaultAdsr(): AdsrShape {
  return { attack: 0.12, decay: 0.25, sustain: 0.5, release: 0.4, curve: 0 };
}

function easeCurve(t: number, curve: number): number {
  if (curve === 0) return t;
  const k = Math.abs(curve) * 3 + 1;
  return curve > 0 ? 1 - Math.pow(1 - t, k) : Math.pow(t, k);
}

/** Render an ADSR shape into editable breakpoints (the persisted curve). */
export function adsrToPoints(a: AdsrShape, n = 48): EnvPoint[] {
  const sus = clampUnit(a.sustain);
  const tA = Math.min(clampUnit(a.attack), 0.96);
  const tD = Math.min(tA + clampUnit(a.decay), 0.98);
  const tR = Math.max(tD, 1 - clampUnit(a.release));
  const pts: EnvPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let v: number;
    if (t <= tA) {
      v = tA <= 0 ? 1 : easeCurve(t / tA, a.curve);
    } else if (t <= tD) {
      const f = (t - tA) / Math.max(1e-4, tD - tA);
      v = 1 + (sus - 1) * easeCurve(f, a.curve);
    } else if (t <= tR) {
      v = sus;
    } else {
      const f = (t - tR) / Math.max(1e-4, 1 - tR);
      v = sus * (1 - easeCurve(f, a.curve));
    }
    pts.push({ t, v: clampUnit(v) });
  }
  return pts;
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

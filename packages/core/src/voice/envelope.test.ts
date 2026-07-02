import { describe, expect, it } from 'vitest';
import { adsrToPoints, cloneEnvelope, defaultAdsr, defaultEnvelope, migrateAdsr } from './envelope';
import type { AdsrShape } from './types';

const clampUnit = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** The pre-v2 renderer, inlined verbatim, as the behaviour-preservation oracle. */
function legacyPoints(a: { attack: number; decay: number; sustain: number; release: number; curve?: number }, n = 48) {
  const easeCurve = (t: number, curve: number): number => {
    if (curve === 0) return t;
    const k = Math.abs(curve) * 3 + 1;
    return curve > 0 ? 1 - Math.pow(1 - t, k) : Math.pow(t, k);
  };
  const curve = a.curve ?? 0;
  const sus = clampUnit(a.sustain);
  const tA = Math.min(clampUnit(a.attack), 0.96);
  const tD = Math.min(tA + clampUnit(a.decay), 0.98);
  const tR = Math.max(tD, 1 - clampUnit(a.release));
  const pts: { t: number; v: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let v: number;
    if (t <= tA) v = tA <= 0 ? 1 : easeCurve(t / tA, curve);
    else if (t <= tD) v = 1 + (sus - 1) * easeCurve((t - tA) / Math.max(1e-4, tD - tA), curve);
    else if (t <= tR) v = sus;
    else v = sus * (1 - easeCurve((t - tR) / Math.max(1e-4, 1 - tR), curve));
    pts.push({ t, v: clampUnit(v) });
  }
  return pts;
}

const CURVE_GRID = [-1, -0.85, -0.5, -0.35, -0.1, 0, 0.1, 0.35, 0.5, 0.85, 1];
const legacyShape = (curve: number): AdsrShape => ({ attack: 0.2, decay: 0.3, sustain: 0.5, release: 0.25, curve });

// ---- behaviour preservation (v2 renderer on legacy shapes) --------------------

describe('adsrToPoints — legacy shapes render byte-identically', () => {
  it('matches the pre-v2 renderer across the full curve grid', () => {
    for (const curve of CURVE_GRID) {
      const a = legacyShape(curve);
      expect(adsrToPoints(a)).toEqual(legacyPoints(a));
    }
  });

  it('default ADSR (curve 0) renders exactly linear', () => {
    const d = defaultAdsr();
    expect(adsrToPoints(d)).toEqual(
      legacyPoints({ attack: d.attack, decay: d.decay, sustain: d.sustain, release: d.release, curve: d.curve ?? 0 }),
    );
  });
});

// ---- attackLevel --------------------------------------------------------------

describe('adsrToPoints — attackLevel scales attack peak and decay start', () => {
  const base: AdsrShape = {
    attack: 0.25,
    decay: 0.25,
    sustain: 0.3,
    release: 0.25,
    attackEase: { fn: 'linear', dir: 'in' },
    decayEase: { fn: 'linear', dir: 'in' },
    releaseEase: { fn: 'linear', dir: 'in' },
  };

  it('peaks at attackLevel, not 1', () => {
    const full = adsrToPoints({ ...base, attackLevel: 1 });
    const half = adsrToPoints({ ...base, attackLevel: 0.6 });
    expect(Math.max(...full.map((p) => p.v))).toBeCloseTo(1, 12);
    expect(Math.max(...half.map((p) => p.v))).toBeCloseTo(0.6, 12);
  });

  it('starts the decay from the (lowered) peak, not from 1', () => {
    // With attackLevel 0.6 the point at the attack/decay boundary equals 0.6.
    const pts = adsrToPoints({ ...base, attackLevel: 0.6 });
    const tA = 0.25;
    const atPeak = pts.find((p) => Math.abs(p.t - tA) < 1e-9);
    expect(atPeak?.v).toBeCloseTo(0.6, 12);
  });

  it('defaults attackLevel to 1 when absent', () => {
    const withDefault = adsrToPoints({ ...base });
    const explicitOne = adsrToPoints({ ...base, attackLevel: 1 });
    expect(withDefault).toEqual(explicitOne);
  });
});

// ---- per-segment eases --------------------------------------------------------

describe('adsrToPoints — per-segment eases', () => {
  // tA=0.4, tD=0.6, tR=0.8 → index 9 (t=0.1875) is inside attack, 34 (t≈0.708) is on the sustain plateau.
  const base: AdsrShape = { attack: 0.4, decay: 0.2, sustain: 0.4, release: 0.2 };
  const ATTACK_I = 9;
  const SUSTAIN_I = 34;

  it('a segment ease overrides the legacy curve fallback for that segment only', () => {
    const easedAttack = adsrToPoints({ ...base, curve: 0, attackEase: { fn: 'quad', dir: 'in' } });
    const linear = adsrToPoints({ ...base, curve: 0 });
    // Attack region differs (quad-in bows below the linear ramp)…
    expect(easedAttack[ATTACK_I]!.v).toBeLessThan(linear[ATTACK_I]!.v);
    // …while the sustain plateau is untouched.
    expect(easedAttack[SUSTAIN_I]!.v).toBeCloseTo(linear[SUSTAIN_I]!.v, 15);
    expect(linear[SUSTAIN_I]!.v).toBeCloseTo(0.4, 15);
  });

  it('attack in vs out eases produce different shapes', () => {
    const easeIn = adsrToPoints({ ...base, attackEase: { fn: 'cubic', dir: 'in' } });
    const easeOut = adsrToPoints({ ...base, attackEase: { fn: 'cubic', dir: 'out' } });
    expect(easeIn[ATTACK_I]!.v).toBeLessThan(easeOut[ATTACK_I]!.v);
  });
});

// ---- migrator: parity + idempotency ------------------------------------------

describe('migrateAdsr', () => {
  it('is sample-identical to the legacy shape across the full curve grid (parity)', () => {
    for (const curve of CURVE_GRID) {
      const a = legacyShape(curve);
      expect(adsrToPoints(migrateAdsr(a))).toEqual(adsrToPoints(a));
    }
  });

  it('is idempotent across the full curve grid', () => {
    for (const curve of CURVE_GRID) {
      const once = migrateAdsr(legacyShape(curve));
      expect(migrateAdsr(once)).toEqual(once);
    }
  });

  it('promotes curve 0 to explicit linear eases and drops the curve', () => {
    const m = migrateAdsr(legacyShape(0));
    expect(m.attackEase).toEqual({ fn: 'linear', dir: 'in' });
    expect(m.decayEase).toEqual({ fn: 'linear', dir: 'in' });
    expect(m.releaseEase).toEqual({ fn: 'linear', dir: 'in' });
    expect(m.attackLevel).toBe(1);
    expect(m.curve).toBeUndefined();
  });

  it('retains a non-representable curve on the fallback (no eases invented)', () => {
    const m = migrateAdsr(legacyShape(0.5));
    expect(m.curve).toBe(0.5);
    expect(m.attackEase).toBeUndefined();
    expect(m.attackLevel).toBe(1);
  });

  it('never clobbers an already-authored ease', () => {
    const authored: AdsrShape = { attack: 0.2, decay: 0.2, sustain: 0.5, release: 0.2, curve: 0.5, attackEase: { fn: 'bounce', dir: 'out' } };
    const m = migrateAdsr(authored);
    expect(m.attackEase).toEqual({ fn: 'bounce', dir: 'out' });
    expect(m.attackLevel).toBe(1);
  });
});

// ---- clone hygiene -----------------------------------------------------------

describe('cloneEnvelope — deep-copies per-segment eases', () => {
  it('does not alias EaseSpec sub-objects', () => {
    const env = defaultEnvelope('decay');
    env.adsr = { attack: 0.2, decay: 0.2, sustain: 0.5, release: 0.2, attackEase: { fn: 'back', dir: 'in' } };
    const copy = cloneEnvelope(env);
    copy.adsr!.attackEase!.fn = 'elastic';
    expect(env.adsr.attackEase!.fn).toBe('back');
  });
});

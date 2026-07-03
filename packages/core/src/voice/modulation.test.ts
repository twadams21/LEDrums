import { describe, expect, it } from 'vitest';
import { Framebuffer } from '../engine/framebuffer';
import type { PixelModel } from '../geometry/pixel-model';
import { applyModifierChain } from '../modifiers/chain';
import { levels } from '../modifiers/impl/levels';
import { getModifier } from '../modifiers/registry';
import type { PixelRange, ResolvedModifier } from '../modifiers/types';
import { applyEffectiveParams } from './compositor';
import {
  applyModulations,
  envelopeToMapping,
  mappingContribution,
  type Mapping,
  type ModSampleCtx,
} from './modulation';
import {
  MODULATION_PARITY_CASES,
  PARITY_PHASES,
  legacyEnvValue,
  mappingEnvValue,
} from './modulation-parity';
import type { Envelope, ParamSpec, Voice } from './types';

/* S33 — modulation core. Verified at the engine seam (graph wiring is S34): tests inject
   resolved `Mapping`s directly, the same structures a voice will carry once S34 walks the
   graph. Pins: multi-source sum + clamp / invert / range; envelope mapping restarts per
   voice/retrigger and is deterministic; legacy env-sweep parity (the S35 migration fixture);
   modifier-param modulation applied through the chain-runner seam. */

// ---- helpers ----------------------------------------------------------------

const ctx = (phase: number): ModSampleCtx => ({ phase, timeMs: 0, bpm: 120 });

/** A flat envelope that samples to the constant `v` at any phase — exact goldens. */
const constEnv = (v: number): Envelope => ({ kind: 'custom', amount: 1, points: [{ t: 0, v }, { t: 1, v }] });

/** A constant envelope wrapped as a modulation source. */
const constSrc = (v: number): Mapping['source'] => ({ kind: 'envelope', env: constEnv(v) });

const numSpec = (key: string, min: number, max: number): ParamSpec => ({
  key,
  label: key,
  kind: 'number',
  min,
  max,
  default: min,
});

const map = (over: Partial<Mapping> & Pick<Mapping, 'targetParam' | 'source'>): Mapping => ({
  amount: 1,
  invert: false,
  rangeMin: 0,
  rangeMax: 1,
  ...over,
});

// ---- contributions & sweep --------------------------------------------------

describe('modulation model — contributions & sweep', () => {
  it('multi-source contributions SUM over a shared base, then clamp to the spec range', () => {
    const spec = numSpec('x', 0, 1);
    const base = { x: 0 };
    const out = { x: 0 };
    applyModulations(
      base,
      out,
      [
        map({ targetParam: 'x', source: constSrc(0.5) }),
        map({ targetParam: 'x', source: constSrc(0.3) }),
      ],
      [spec],
      ctx(0),
    );
    expect(out.x).toBeCloseTo(0.8, 10); // 0 + 0.5 + 0.3
  });

  it('the summed contribution is clamped once to the spec range (not per source)', () => {
    const spec = numSpec('x', 0, 1);
    const out = { x: 0 };
    applyModulations(
      { x: 0 },
      out,
      [
        map({ targetParam: 'x', source: constSrc(0.5) }),
        map({ targetParam: 'x', source: constSrc(0.5) }),
        map({ targetParam: 'x', source: constSrc(0.5) }),
      ],
      [spec],
      ctx(0),
    );
    expect(out.x).toBe(1); // 1.5 sum → clamped to max
  });

  it('invert flips the source signal before scaling', () => {
    const spec = numSpec('x', 0, 1);
    const out = { x: 0 };
    applyModulations({ x: 0 }, out, [map({ targetParam: 'x', source: constSrc(0.2), invert: true })], [spec], ctx(0));
    expect(out.x).toBeCloseTo(0.8, 10); // (1 - 0.2) scaled into [0,1] from base 0
  });

  it('rangeMin/rangeMax scale the mapped value', () => {
    const spec = numSpec('x', 0, 4);
    const out = { x: 0 };
    applyModulations(
      { x: 0 },
      out,
      [map({ targetParam: 'x', source: constSrc(0.5), rangeMin: 2, rangeMax: 4 })],
      [spec],
      ctx(0),
    );
    expect(out.x).toBeCloseTo(3, 10); // target = 2 + 0.5·(4-2) = 3, contribution = 3 - 0
  });

  it('amount weights the contribution', () => {
    const spec = numSpec('x', 0, 1);
    const out = { x: 0 };
    applyModulations({ x: 0 }, out, [map({ targetParam: 'x', source: constSrc(1), amount: 0.5 })], [spec], ctx(0));
    expect(out.x).toBeCloseTo(0.5, 10); // 0.5 · (1 - 0)
  });

  it('a non-number param is skipped (strings flow through untouched)', () => {
    const spec: ParamSpec = { key: 'mode', label: 'Mode', kind: 'enum', options: ['a', 'b'], default: 'a' };
    const out: Record<string, number | boolean | string> = { mode: 'a' };
    applyModulations({ mode: 'a' }, out, [map({ targetParam: 'mode', source: constSrc(1) })], [spec], ctx(0));
    expect(out.mode).toBe('a');
  });

  it('is deterministic across runs (same inputs ⇒ identical output)', () => {
    const spec = numSpec('x', 0, 1);
    const mappings = [map({ targetParam: 'x', source: constSrc(0.42), amount: 0.7 })];
    const a = { x: 0.1 };
    const b = { x: 0.1 };
    applyModulations({ x: 0.1 }, a, mappings, [spec], ctx(0.3));
    applyModulations({ x: 0.1 }, b, mappings, [spec], ctx(0.3));
    expect(a).toEqual(b);
  });

  it('mappingContribution is base-relative (a mapping AT base contributes nothing)', () => {
    // Source scaled to exactly the base value ⇒ zero contribution ⇒ base unchanged.
    const spec = numSpec('x', 0, 1);
    const out = { x: 0.5 };
    applyModulations({ x: 0.5 }, out, [map({ targetParam: 'x', source: constSrc(0.5) })], [spec], ctx(0));
    expect(out.x).toBeCloseTo(0.5, 10);
    expect(mappingContribution(map({ targetParam: 'x', source: constSrc(0.5) }), 0.5, ctx(0))).toBeCloseTo(0, 10);
  });
});

// ---- envelope mapping: per-voice phase --------------------------------------

/** Minimal live voice (mirrors makeVoiceSlot defaults) with per-test overrides. */
function mkVoice(over: Partial<Voice>): Voice {
  return {
    active: true,
    id: 'v1',
    effectId: 'fx',
    pattern: 'flash',
    busId: 'base',
    mode: 'oneshot',
    scope: 'kit',
    sourceDrumId: 'kick',
    velocity: 1,
    generatorId: null,
    genState: null,
    modifiers: undefined,
    modState: undefined,
    modulations: undefined,
    params: {},
    liveParams: {},
    specs: [],
    env: {},
    attackMs: 100,
    sustainMs: 300,
    releaseMs: 100,
    phase: 'attack',
    level: 1,
    bornAtMs: 0,
    releaseAtMs: null,
    releaseFromLevel: 1,
    via: '',
    deckGain: 1,
    ...over,
  };
}

describe('envelope mapping — per-voice phase (compositor sweep)', () => {
  const spec = numSpec('brightness', 0, 1);
  const decay: Envelope = { kind: 'decay', amount: 1, points: [{ t: 0, v: 1 }, { t: 1, v: 0 }] };
  // Voice life = 100+300+100 = 500ms; oneshot phase = age/life.
  const mods: Mapping[] = [envelopeToMapping('brightness', decay, spec)];

  it('samples by the voice life phase — the value sweeps as the voice ages', () => {
    const v = mkVoice({ params: { brightness: 1 }, specs: [spec], modulations: mods, bornAtMs: 0 });
    const at0 = applyEffectiveParams(v, 0, 120).brightness; // phase 0 → decay=1 → base+0
    const atHalf = applyEffectiveParams(v, 250, 120).brightness; // phase 0.5 → decay=0.5
    const atEnd = applyEffectiveParams(v, 500, 120).brightness; // phase 1 → decay=0
    expect(at0).toBeCloseTo(1, 6);
    expect(atHalf).toBeCloseTo(0.5, 6);
    expect(atEnd).toBeCloseTo(0, 6);
  });

  it('restarts per voice/retrigger — a fresh voice (age 0) samples from phase 0 again', () => {
    const v1 = mkVoice({ params: { brightness: 1 }, specs: [spec], modulations: mods, bornAtMs: 0 });
    const mid = applyEffectiveParams(v1, 250, 120).brightness;
    expect(mid).toBeCloseTo(0.5, 6);
    // Retrigger = a new voice whose clock starts at its own bornAtMs; at bornAtMs its phase is 0.
    const v2 = mkVoice({ params: { brightness: 1 }, specs: [spec], modulations: mods, bornAtMs: 1000 });
    expect(applyEffectiveParams(v2, 1000, 120).brightness).toBeCloseTo(1, 6);
    expect(applyEffectiveParams(v2, 1250, 120).brightness).toBeCloseTo(0.5, 6);
  });

  it('is deterministic across runs at the compositor seam', () => {
    const run = (): number[] => {
      const v = mkVoice({ params: { brightness: 1 }, specs: [spec], modulations: mods, bornAtMs: 0 });
      return [0, 125, 250, 375, 500].map((t) => applyEffectiveParams(v, t, 120).brightness as number);
    };
    expect(run()).toEqual(run());
  });
});

// ---- legacy env-sweep parity fixture (S35 reuses this) ----------------------

describe('legacy env-sweep parity fixture', () => {
  it('exposes reusable cases + phases', () => {
    expect(MODULATION_PARITY_CASES.length).toBeGreaterThan(0);
    expect(PARITY_PHASES.length).toBeGreaterThan(0);
  });

  it('legacy env behaviour == equivalent mapping, sample-identical across the voice life', () => {
    for (const c of MODULATION_PARITY_CASES) {
      for (const phase of PARITY_PHASES) {
        const legacy = legacyEnvValue(c.spec, c.base, c.env, phase);
        const mapped = mappingEnvValue(c.spec, c.base, c.env, phase);
        // Identical to floating-point precision. The only difference the model can introduce
        // is its range clamp, which for a single equivalent mapping is a no-op within the
        // valid range (both base and target lie in [min,max]) — so any delta is float dust.
        expect(mapped).toBeCloseTo(legacy, 12);
      }
    }
  });
});

// ---- modifier-param modulation at the chain-runner seam ---------------------

const stripModel = (n: number): PixelModel => ({ pixelCount: n }) as unknown as PixelModel;
const stripRange = (n: number): PixelRange => ({ start: 0, end: n });

/** A framebuffer seeded with a mid-grey ramp so a brightness change is visible. */
function strip(n: number): Framebuffer {
  const fb = new Framebuffer(n);
  for (let i = 0; i < n; i++) fb.set(i, 0.4, 0.5, 0.6, 1);
  return fb;
}

describe('modifier-param modulation (chain-runner seam)', () => {
  const N = 6;
  const model = stripModel(N);
  const range = stripRange(N);
  const modCtx = ctx(0);
  // levels.brightness ∈ [0,2]; drive base 1 → 1.5 via a const-0.75 envelope over [0,2].
  const brightnessMap: Mapping = {
    targetParam: 'brightness',
    source: constSrc(0.75),
    amount: 1,
    invert: false,
    rangeMin: 0,
    rangeMax: 2,
  };

  it('a link’s modulations drive its params — identical to setting the modulated value directly', () => {
    expect(getModifier('levels')).toBe(levels); // registered; runner resolves it by id
    const modulated = strip(N);
    applyModifierChain(
      [{ modifierId: 'levels', params: { brightness: 1, saturation: 1, invert: false }, modulations: [brightnessMap] }],
      [],
      modulated,
      range,
      model,
      0,
      0,
      modCtx,
    );
    const direct = strip(N);
    applyModifierChain(
      [{ modifierId: 'levels', params: { brightness: 1.5, saturation: 1, invert: false } }],
      [],
      direct,
      range,
      model,
      0,
      0,
    );
    expect(Array.from(modulated.rgba)).toEqual(Array.from(direct.rgba));
  });

  it('without modCtx the modulations are inert — the link runs on its authored params', () => {
    const link: ResolvedModifier = {
      modifierId: 'levels',
      params: { brightness: 1, saturation: 1, invert: false },
      modulations: [brightnessMap],
    };
    const noCtx = strip(N);
    applyModifierChain([link], [], noCtx, range, model, 0, 0); // modCtx omitted
    const authored = strip(N);
    applyModifierChain(
      [{ modifierId: 'levels', params: { brightness: 1, saturation: 1, invert: false } }],
      [],
      authored,
      range,
      model,
      0,
      0,
    );
    expect(Array.from(noCtx.rgba)).toEqual(Array.from(authored.rgba));
  });
});

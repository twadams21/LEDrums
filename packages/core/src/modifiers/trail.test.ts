import { describe, expect, it } from 'vitest';
import { Framebuffer } from '../engine/framebuffer';
import type { PixelModel } from '../geometry/pixel-model';
import { applyModifierChain } from './chain';
import { trail } from './impl/trail';
import type { PixelRange, ResolvedModifier } from './types';

// Trail is a pure per-voice framebuffer transform: these goldens pin its temporal-smear
// math and exercise the chain runner (bypass, unknown-id, ordering, lazy per-voice state)
// that S30–S32 will reuse verbatim. No model geometry is read by Trail.apply — only
// createState sizes its accumulator to pixelCount — so a light stub model suffices.

const model = (n: number): PixelModel => ({ pixelCount: n }) as unknown as PixelModel;
const range = (n: number): PixelRange => ({ start: 0, end: n });

/** A 1-pixel framebuffer with a grey value in all channels. */
function px(v: number): Framebuffer {
  const fb = new Framebuffer(1);
  fb.set(0, v, v, v, v);
  return fb;
}
function ch0(fb: Framebuffer): number {
  return fb.rgba[0]!;
}

/** Drive a chain across successive frames; `inputs[i]` is the fresh value rendered at tick i
    (all channels), `dt` the per-frame delta. Returns the channel-0 output after each tick. */
function runTicks(chain: ResolvedModifier[], inputs: number[], dt: number): number[] {
  const state: unknown[] = [];
  const m = model(1);
  const r = range(1);
  const out: number[] = [];
  for (let i = 0; i < inputs.length; i++) {
    const fb = px(inputs[i]!);
    applyModifierChain(chain, state, fb, r, m, i * dt, dt);
    out.push(ch0(fb));
  }
  return out;
}

const T = (params: Record<string, number | string>, bypass?: boolean): ResolvedModifier => ({
  modifierId: 'trail',
  params,
  bypass,
});

/** Round expected values through Float32 (the framebuffer's storage) for exact comparison. */
const f32 = (a: number[]): number[] => a.map((x) => Math.fround(x));

describe('Trail modifier — pure apply goldens', () => {
  it('decayMs=0 leaves no tail: output tracks the current frame exactly', () => {
    // k = 0 → decayed history contributes nothing; each frame is passed through unchanged.
    const out = runTicks([T({ decayMs: 0, mode: 'add' })], [0.8, 0, 0.3], 100);
    expect(out).toEqual(f32([0.8, 0, 0.3]));
  });

  it('add mode retains a decaying tail after the source goes dark', () => {
    // Bright frame, then two dark frames: the tail decays by k = exp(-dt/decayMs) each tick.
    const decayMs = 250;
    const dt = 100;
    const k = Math.exp(-dt / decayMs);
    const out = runTicks([T({ decayMs, mode: 'add' })], [0.8, 0, 0], dt);
    expect(out[0]).toBeCloseTo(0.8, 6);
    expect(out[1]).toBeCloseTo(0.8 * k, 6); // decayed history, source dark
    expect(out[2]).toBeCloseTo(0.8 * k * k, 6);
    // Strictly fading, never negative.
    expect(out[1]!).toBeLessThan(out[0]!);
    expect(out[2]!).toBeLessThan(out[1]!);
    expect(out[2]!).toBeGreaterThan(0);
  });

  it('add mode accumulates over the head and clamps to 1', () => {
    // Repeated bright frames pile the decayed tail onto the fresh head → saturates at 1.
    const out = runTicks([T({ decayMs: 1000, mode: 'add' })], [0.8, 0.8, 0.8, 0.8], 50);
    for (const v of out) expect(v).toBeLessThanOrEqual(1);
    expect(out[out.length - 1]).toBe(1); // clamped
  });

  it('max mode holds the brightest of head vs decayed tail (no additive bloom)', () => {
    const decayMs = 300;
    const dt = 100;
    const k = Math.exp(-dt / decayMs);
    // 0.9, then dark → tail = 0.9k; then 0.5 (dimmer than the tail) → max keeps the tail.
    const out = runTicks([T({ decayMs, mode: 'max' })], [0.9, 0, 0.5], dt);
    expect(out[0]).toBeCloseTo(0.9, 6);
    expect(out[1]).toBeCloseTo(0.9 * k, 6);
    const tail2 = 0.9 * k * k;
    expect(out[2]).toBeCloseTo(Math.max(0.5, tail2), 6);
    // max mode never exceeds 1 without any explicit clamp on this input.
    for (const v of out) expect(v).toBeLessThanOrEqual(1);
  });

  it('is deterministic across separate runs', () => {
    const chain = [T({ decayMs: 220, mode: 'add' })];
    const run = (): number[] => runTicks(chain, [0.7, 0.2, 0.9, 0, 0.4], 33);
    expect(run()).toEqual(run());
  });
});

describe('Modifier chain runner — bypass, unknown id, ordering, state', () => {
  it('bypass = identity: a bypassed link never touches the framebuffer', () => {
    const withBypass = runTicks([T({ decayMs: 500, mode: 'add' }, true)], [0.6, 0, 0.2], 100);
    const noModifier = runTicks([], [0.6, 0, 0.2], 100);
    expect(withBypass).toEqual(noModifier);
    expect(withBypass).toEqual(f32([0.6, 0, 0.2])); // untouched frames
  });

  it('an unknown modifier id is skipped, never thrown', () => {
    const chain: ResolvedModifier[] = [{ modifierId: 'does-not-exist', params: {} }];
    expect(() => runTicks(chain, [0.5, 0.5], 16)).not.toThrow();
    expect(runTicks(chain, [0.5, 0.5], 16)).toEqual([0.5, 0.5]);
  });

  it('chain application order is respected (order matters — not commuted)', () => {
    // Two Trail links with distinct decay + mode. Because each has its own per-voice
    // accumulator fed by the other's output, the composition is order-dependent.
    const a = T({ decayMs: 120, mode: 'add' });
    const b = T({ decayMs: 400, mode: 'max' });
    const inputs = [0.9, 0.1, 0.6, 0, 0.3];
    const ab = runTicks([a, b], inputs, 60);
    const ba = runTicks([b, a], inputs, 60);
    expect(ab).not.toEqual(ba);
  });

  it('per-modifier state is independent per chain position (parallel state slots)', () => {
    // Two identical Trail links: each gets its OWN accumulator slot, so the second sees the
    // first's output as its input — the result is a double-smeared tail, not a shared buffer.
    const single = runTicks([T({ decayMs: 300, mode: 'add' })], [0.8, 0, 0, 0], 100);
    const doubled = runTicks(
      [T({ decayMs: 300, mode: 'add' }), T({ decayMs: 300, mode: 'add' })],
      [0.8, 0, 0, 0],
      100,
    );
    // The double chain retains more tail energy than a single pass at the same tick.
    expect(doubled[3]!).toBeGreaterThan(single[3]!);
  });

  it('an empty chain is a no-op', () => {
    expect(runTicks([], [0.4, 0.7, 0.1], 20)).toEqual(f32([0.4, 0.7, 0.1]));
  });
});

describe('Trail modifier — registry surface', () => {
  it('exposes an id, name, temporal category, and its param spec', () => {
    expect(trail.id).toBe('trail');
    expect(trail.category).toBe('temporal');
    const keys = trail.paramSpec.map((s) => s.key);
    expect(keys).toContain('decayMs');
    expect(keys).toContain('mode');
  });
});

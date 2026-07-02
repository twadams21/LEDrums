import { describe, expect, it } from 'vitest';
import { Framebuffer } from '../engine/framebuffer';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import type { TransportState } from '../engine/render-context';
import { buildPixelAttrs, createDefaultCompositor, type CompositorFrame } from '../voice/compositor';
import { resolveModifierChain } from '../voice/modifier-graph';
import type { GraphEdge, GraphNode, TriggerGraph, Voice } from '../voice/types';
import { applyModifierChain } from './chain';
import { bloom } from './impl/bloom';
import { sparkle } from './impl/sparkle';
import { grain } from './impl/grain';
import { strobe } from './impl/strobe';
import type { PixelRange, ResolvedModifier } from './types';

/* S30 — modifier batch 2 (Bloom / Sparkle / Grain / Strobe). Two tiers, per DoD:
   (1) PURE apply goldens driving the chain runner directly on a hand-built framebuffer —
       deterministic across runs (seeded RNG for Sparkle/Grain), bypass = identity.
   (2) One END-TO-END wiring test each: a modifier NODE wired to a play node's `mod` input
       resolves (shared core resolver) onto a spawned voice's chain and the compositor
       renders the smear/chop — the same seam the graph/sim use. */

// ---- pure-apply harness -----------------------------------------------------

const model = (n: number): PixelModel => ({ pixelCount: n }) as unknown as PixelModel;
const range = (n: number): PixelRange => ({ start: 0, end: n });

/** A strip framebuffer whose channels are seeded per-pixel by `fill(i) → [r,g,b,a]`. */
function strip(n: number, fill: (i: number) => [number, number, number, number]): Framebuffer {
  const fb = new Framebuffer(n);
  for (let i = 0; i < n; i++) {
    const [r, g, b, a] = fill(i);
    fb.set(i, r, g, b, a);
  }
  return fb;
}

const link = (modifierId: string, params: Record<string, number | string>, bypass?: boolean): ResolvedModifier => ({
  modifierId,
  params,
  bypass,
});

/** Apply a chain once at (timeMs, dt) over a fresh strip; return channel-0 per pixel. */
function applyOnce(chain: ResolvedModifier[], fb: Framebuffer, timeMs: number, dt: number): number[] {
  const state: unknown[] = [];
  applyModifierChain(chain, state, fb, range(fb.pixelCount), model(fb.pixelCount), timeMs, dt);
  return [...Array(fb.pixelCount)].map((_, i) => fb.rgba[i * 4]!);
}

/** Drive a chain across frames on a per-tick-fresh source; returns the full RGBA total each tick. */
function runTotals(chain: ResolvedModifier[], srcAt: (i: number) => Framebuffer, ticks: number, dt: number): number[] {
  const state: unknown[] = [];
  const n = srcAt(0).pixelCount;
  const out: number[] = [];
  for (let t = 0; t < ticks; t++) {
    const fb = srcAt(t);
    applyModifierChain(chain, state, fb, range(n), model(n), t * dt, dt);
    let s = 0;
    for (let k = 0; k < fb.rgba.length; k++) s += fb.rgba[k]!;
    out.push(s);
  }
  return out;
}

// ---- Bloom ------------------------------------------------------------------

describe('Bloom modifier — spatial spread', () => {
  const grey = (i: number): [number, number, number, number] => (i === 3 ? [1, 1, 1, 1] : [0, 0, 0, 0]);

  it('spreads a single bright pixel into its neighbourhood, leaving far pixels dark', () => {
    const out = applyOnce([link('bloom', { radius: 2, intensity: 1 })], strip(7, grey), 0, 16);
    expect(out[3]).toBeGreaterThanOrEqual(1); // centre keeps its light (its own glow added, clamped)
    expect(out[2]!).toBeGreaterThan(0); // immediate neighbours pick up the halo
    expect(out[4]!).toBeGreaterThan(0);
    expect(out[2]).toBeCloseTo(out[4]!, 6); // symmetric spread
    expect(out[0]).toBe(0); // outside radius → untouched
    expect(out[6]).toBe(0);
  });

  it('intensity scales the halo; radius 0 spreads to no neighbours', () => {
    const dim = applyOnce([link('bloom', { radius: 2, intensity: 0.25 })], strip(7, grey), 0, 16);
    const bright = applyOnce([link('bloom', { radius: 2, intensity: 1 })], strip(7, grey), 0, 16);
    expect(bright[2]!).toBeGreaterThan(dim[2]!);
    const r0 = applyOnce([link('bloom', { radius: 0, intensity: 1 })], strip(7, grey), 0, 16);
    expect(r0[2]).toBe(0); // no neighbour reach
  });

  it('is deterministic and bypass = identity', () => {
    const chain = [link('bloom', { radius: 3, intensity: 0.7 })];
    expect(applyOnce(chain, strip(7, grey), 0, 16)).toEqual(applyOnce(chain, strip(7, grey), 0, 16));
    const bypassed = applyOnce([link('bloom', { radius: 3, intensity: 0.7 }, true)], strip(7, grey), 0, 16);
    expect(bypassed).toEqual(applyOnce([], strip(7, grey), 0, 16));
  });
});

// ---- Sparkle ----------------------------------------------------------------

describe('Sparkle modifier — seeded decaying glints', () => {
  const dark = (): Framebuffer => strip(24, () => [0, 0, 0, 0]);

  it('lights a dark source with glints (seeded — no Math.random)', () => {
    const out = applyOnce([link('sparkle', { density: 40, decayMs: 300 })], dark(), 0, 33);
    expect(Math.max(...out)).toBeGreaterThan(0); // glints appear over pure black
  });

  it('is deterministic across runs (identical seed → identical twinkle)', () => {
    const chain = [link('sparkle', { density: 20, decayMs: 400 })];
    const run = (): number[] => runTotals(chain, dark, 8, 33);
    expect(run()).toEqual(run());
  });

  it('longer decay retains more glint energy than short decay (same seed & spawns)', () => {
    const longD = runTotals([link('sparkle', { density: 20, decayMs: 2000 })], dark, 10, 33);
    const shortD = runTotals([link('sparkle', { density: 20, decayMs: 60 })], dark, 10, 33);
    const sum = (a: number[]): number => a.reduce((x, y) => x + y, 0);
    expect(sum(longD)).toBeGreaterThan(sum(shortD));
  });

  it('bypass = identity', () => {
    const bypassed = runTotals([link('sparkle', { density: 40, decayMs: 300 }, true)], dark, 5, 33);
    expect(bypassed).toEqual(runTotals([], dark, 5, 33));
  });
});

// ---- Grain ------------------------------------------------------------------

describe('Grain modifier — animated seeded noise', () => {
  const lit = (): Framebuffer => strip(16, () => [0.8, 0.4, 0.2, 1]);

  it('amount 0 is identity; amount > 0 darkens without shifting hue', () => {
    const id = applyOnce([link('grain', { amount: 0 })], lit(), 0, 16);
    expect(id.every((v) => v === Math.fround(0.8))).toBe(true);
    const fb = lit();
    applyOnce([link('grain', { amount: 0.5 })], fb, 0, 16);
    for (let i = 0; i < fb.pixelCount; i++) {
      const j = i * 4;
      expect(fb.rgba[j]!).toBeLessThanOrEqual(Math.fround(0.8) + 1e-6); // multiplicative → never brighter
      // monochrome factor preserves the R:G ratio (0.8 : 0.4 = 2:1)
      if (fb.rgba[j]! > 0) expect(fb.rgba[j]! / fb.rgba[j + 1]!).toBeCloseTo(2, 5);
      expect(fb.rgba[j + 3]).toBe(1); // alpha untouched
    }
  });

  it('animates: successive frames differ, but the sequence is deterministic', () => {
    const chain = [link('grain', { amount: 0.6 })];
    const drive = (): [number[], number[]] => {
      const s: unknown[] = [];
      const f0 = lit();
      applyModifierChain(chain, s, f0, range(16), model(16), 0, 16);
      const f1 = lit();
      applyModifierChain(chain, s, f1, range(16), model(16), 16, 16);
      return [[...f0.rgba], [...f1.rgba]];
    };
    const [a0, a1] = drive();
    expect(a0).not.toEqual(a1); // frame counter advanced → a different noise field
    const [b0, b1] = drive();
    expect(b0).toEqual(a0); // replays identically
    expect(b1).toEqual(a1);
  });

  it('bypass = identity', () => {
    const fb = lit();
    applyOnce([link('grain', { amount: 0.6 }, true)], fb, 0, 16);
    expect([...fb.rgba]).toEqual([...lit().rgba]);
  });
});

// ---- Strobe -----------------------------------------------------------------

describe('Strobe modifier — rate/duty chop', () => {
  const on = (): Framebuffer => strip(8, () => [0.5, 0.5, 0.5, 1]);

  it('passes the frame in the on-window and blanks it in the off-window', () => {
    // rate 10Hz → period 100ms, duty 0.5: phase<0.5 on, else off.
    const chain = [link('strobe', { rate: 10, duty: 0.5 })];
    expect(applyOnce(chain, on(), 0, 16)).toEqual([...Array(8)].map(() => Math.fround(0.5))); // phase 0 → on
    expect(applyOnce(chain, on(), 60, 16)).toEqual([...Array(8)].map(() => 0)); // phase 0.6 → off (black)
  });

  it('duty ≥ 1 and rate ≤ 0 are identity (always on)', () => {
    expect(applyOnce([link('strobe', { rate: 10, duty: 1 })], on(), 60, 16)).toEqual(
      [...Array(8)].map(() => Math.fround(0.5)),
    );
    expect(applyOnce([link('strobe', { rate: 0, duty: 0.5 })], on(), 60, 16)).toEqual(
      [...Array(8)].map(() => Math.fround(0.5)),
    );
  });

  it('is deterministic and bypass = identity', () => {
    const chain = [link('strobe', { rate: 7, duty: 0.4 })];
    expect(applyOnce(chain, on(), 123, 16)).toEqual(applyOnce(chain, on(), 123, 16));
    expect(applyOnce([link('strobe', { rate: 7, duty: 0.4 }, true)], on(), 60, 16)).toEqual(applyOnce([], on(), 60, 16));
  });
});

// ---- end-to-end wiring (graph → play node → rendered) -----------------------
// A modifier node wired to a play node's `mod` input resolves through the shared core
// resolver onto the spawned voice, and the compositor renders it — the real engine seam.

function testModel(): PixelModel {
  const kit = parseKit({
    global: { ledDensityPxPerM: 30, hoopCount: 2, defaultHoopSpacingMm: 50 },
    drums: [{ id: 'kick', diameterIn: 12, hoopSpacingMm: 50, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }],
  });
  return buildPixelModel(kit);
}

/** Minimal GraphNode (only the fields each `kind` reads matter). */
function gnode(kind: GraphNode['kind'], id: string, over: Partial<GraphNode> = {}): GraphNode {
  return {
    id, kind, x: 0, y: 0, mode: 'oneshot', scope: 'kit', effectId: '', presetId: '', busId: '',
    params: {}, env: {}, linked: false, noRepeat: true, on: 'value', valueMode: 'gate',
    threshold: 0.5, invert: false, bands: [0.5], p: 0.5, delayMode: 'time', ms: 0, division: '1/8',
    ...over,
  } as GraphNode;
}

/** A static-source pattern voice carrying `mods`, mirroring makeVoiceSlot defaults. */
function mkVoice(mods: ResolvedModifier[] | undefined): Voice {
  return {
    active: true, id: 'v1', effectId: 'fx', pattern: 'flash', busId: 'base', mode: 'oneshot',
    scope: 'kit', targetId: undefined, sourceDrumId: 'kick', velocity: 1, generatorId: null,
    genState: null, modifiers: mods, modState: undefined, params: {}, liveParams: { hue: 0, brightness: 0.6 },
    specs: [], env: {}, attackMs: 0, sustainMs: 5000, releaseMs: 100, phase: 'sustain', level: 1,
    bornAtMs: 0, releaseAtMs: null, releaseFromLevel: 1, via: '', deckGain: 1,
  } as Voice;
}

describe('S30 modifiers — end-to-end from the graph', () => {
  const model = testModel();
  const attrs = buildPixelAttrs(model);
  const transport = (now: number): TransportState => ({
    timeMs: now, beat: 0, bar: 0, beatInBar: 0, bpm: 120, beatsPerBar: 4, playing: true,
  });
  const frame = (timeMs: number, dt: number): CompositorFrame => ({ timeMs, dt, transport: transport(timeMs) });

  /** Wire one modifier node → play node, resolve the chain, render `frames` frames, total the output. */
  function wireRender(modifierId: string, params: Record<string, number | string>, frames: number[][]): {
    chain: ResolvedModifier[];
    total: number;
  } {
    const play = gnode('play', 'p', { y: 100 });
    const graph: TriggerGraph = {
      nodes: [gnode('trigger', 'trigger'), play, gnode('modifier', 'm', { modifierId, params, y: 10 })],
      edges: [{ id: 'flow', from: 'trigger', to: 'p' } as GraphEdge, { id: 'mod', from: 'm', to: 'p', toPort: 'mod' } as GraphEdge],
    };
    const chain = resolveModifierChain(graph, play);
    const v = mkVoice(chain.length ? chain : undefined);
    const c = createDefaultCompositor();
    const dst = new Framebuffer(model.pixelCount);
    for (const [timeMs, dt] of frames) c.render([v], model, attrs, frame(timeMs!, dt!), dst);
    let total = 0;
    for (let i = 0; i < dst.rgba.length; i++) total += dst.rgba[i]!;
    return { chain, total };
  }

  function baseline(frames: number[][]): number {
    const v = mkVoice(undefined);
    const c = createDefaultCompositor();
    const dst = new Framebuffer(model.pixelCount);
    for (const [timeMs, dt] of frames) c.render([v], model, attrs, frame(timeMs!, dt!), dst);
    let total = 0;
    for (let i = 0; i < dst.rgba.length; i++) total += dst.rgba[i]!;
    return total;
  }

  it('Bloom wired to a play node resolves and glows the rendered frame', () => {
    const { chain, total } = wireRender('bloom', { radius: 4, intensity: 1 }, [[0, 16]]);
    expect(chain).toEqual([{ modifierId: 'bloom', params: { radius: 4, intensity: 1 } }]);
    expect(total).toBeGreaterThan(baseline([[0, 16]])); // additive halo → more light
  });

  it('Sparkle wired to a play node resolves and adds glints over the render', () => {
    const { chain, total } = wireRender('sparkle', { density: 40, decayMs: 300 }, [[0, 33], [33, 33]]);
    expect(chain[0]!.modifierId).toBe('sparkle');
    expect(total).toBeGreaterThan(baseline([[0, 33], [33, 33]])); // white glints add light
  });

  it('Grain wired to a play node resolves and textures (darkens) the render', () => {
    const { chain, total } = wireRender('grain', { amount: 0.6 }, [[0, 16]]);
    expect(chain[0]!.modifierId).toBe('grain');
    expect(total).toBeLessThan(baseline([[0, 16]])); // multiplicative grain → less light
    expect(total).toBeGreaterThan(0);
  });

  it('Strobe wired to a play node resolves and chops the render off in its off-window', () => {
    const { chain, total } = wireRender('strobe', { rate: 10, duty: 0.5 }, [[60, 16]]); // phase 0.6 → off
    expect(chain[0]!.modifierId).toBe('strobe');
    expect(total).toBe(0); // blanked
    expect(baseline([[60, 16]])).toBeGreaterThan(0); // baseline is lit at the same instant
  });
});

import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import type { TransportState } from '../engine/render-context';
import { createVoiceBusEngine, type InputEvent } from './engine';
import { padKey, type Bus, type EffectDef, type GraphNode, type Show, type TriggerGraph } from './types';

/*
 * S1 / B1 — engine-level delay→Mix overlap. The R13/R14 unit tests each assert a SINGLE
 * evalGraph/evalChildren action list, which structurally cannot observe two voices coexisting
 * across ticks. This suite drives the real engine (setShow → fire → tick past the delay) so the
 * voice-pool/compositor seam is exercised: the still-live member must be composited ONCE, not
 * twice. Pre-fix, the immediate Mix[A] voice and the drained Mix[A,B] voice both render A →
 * active-voice count 2 and doubled brightness across the whole overlap window. Post-fix, the
 * drain supersedes the immediate composite (one evolving timeline voice) → count 1, single
 * brightness. See docs/reports/2026-07-09-gen3-p3-review.md (B1, S1).
 */

function testModel(): PixelModel {
  const kit = parseKit({
    global: { ledDensityPxPerM: 30, hoopCount: 2, defaultHoopSpacingMm: 50 },
    drums: [{ id: 'kick', diameterIn: 12, hoopSpacingMm: 50, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }],
  });
  return buildPixelModel(kit);
}

/** Both effects on a POLY bus (the overlap default — poly buses never steal, so the fix, not
    the mono-steal path, is what releases the superseded composite). */
function buses(): Bus[] {
  return [{ id: 'base', name: 'Base', polyphony: 'poly', crossfadeMs: 0 }];
}

/** Long sustain so a still-live member stays alive across the whole overlap window (a pre-fix
    double-count would persist), with a short release so the superseded voice reaps promptly. */
function effect(id: string, over: Partial<EffectDef> = {}): EffectDef {
  return {
    id,
    name: id,
    generatorId: 'solid-base',
    busId: 'base',
    scope: 'kit',
    // solid-base honours `brightness` and never saturates at 0.3, so an additive double-count is
    // observable in the framebuffer (not clamped away).
    params: [{ key: 'brightness', label: 'Brightness', kind: 'number', min: 0, max: 1, default: 0.3 }],
    attackMs: 10,
    sustainMs: 100_000,
    releaseMs: 100,
    ...over,
  };
}

function node(kind: GraphNode['kind'], id: string, over: Partial<GraphNode> = {}): GraphNode {
  return {
    id, kind, x: 0, y: 0, mode: 'oneshot', scope: 'kit', effectId: '', presetId: '', busId: '',
    params: { brightness: 0.3 }, env: {}, noRepeat: true, on: 'value', valueMode: 'gate', threshold: 0.5,
    invert: false, bands: [0.5], p: 0.5, delayMode: 'time', ms: 0, division: '1/8', ...over,
  };
}

/** immediate A → Mix, trigger → delay(ms) → B → Mix → output. A at y=0, B at y=100. */
function mixDelayGraph(ms: number): TriggerGraph {
  return {
    version: 3,
    nodes: [
      node('trigger', 'trigger', { y: 0 }),
      node('play', 'a', { y: 0, effectId: 'fxA' }),
      node('delay', 'd', { y: 50, ms }),
      node('play', 'b', { y: 100, effectId: 'fxB' }),
      node('mix', 'mix', { y: 0, mixBlendMode: 'add' }),
      node('output', 'output', { y: 0 }),
    ],
    edges: [
      { id: 'e0', from: 'trigger', to: 'a' },
      { id: 'e1', from: 'a', to: 'mix' },
      { id: 'e2', from: 'trigger', to: 'd' },
      { id: 'e3', from: 'd', to: 'b' },
      { id: 'e4', from: 'b', to: 'mix' },
      { id: 'e5', from: 'mix', to: 'output' },
    ],
  };
}

/** Same topology, no delay node — the delay-0 / immediate baseline. */
function noDelayMixGraph(): TriggerGraph {
  return {
    version: 3,
    nodes: [
      node('trigger', 'trigger', { y: 0 }),
      node('play', 'a', { y: 0, effectId: 'fxA' }),
      node('play', 'b', { y: 100, effectId: 'fxB' }),
      node('mix', 'mix', { y: 0, mixBlendMode: 'add' }),
      node('output', 'output', { y: 0 }),
    ],
    edges: [
      { id: 'e0', from: 'trigger', to: 'a' },
      { id: 'e1', from: 'a', to: 'mix' },
      { id: 'e2', from: 'trigger', to: 'b' },
      { id: 'e3', from: 'b', to: 'mix' },
      { id: 'e4', from: 'mix', to: 'output' },
    ],
  };
}

function show(graph: TriggerGraph): Show {
  return {
    buses: buses(),
    graphs: { [padKey('kick', '')]: graph },
    sections: [],
    effects: [effect('fxA'), effect('fxB')],
    presets: [],
  };
}

function transport(now: number): TransportState {
  return { timeMs: now, beat: 0, bar: 0, beatInBar: 0, bpm: 120, beatsPerBar: 4, playing: true };
}

function hit(timeMs = 0): InputEvent {
  return { kind: 'noteOn', drumId: 'kick', zone: '', velocity: 1, timeMs };
}

function engine(graph: TriggerGraph) {
  const e = createVoiceBusEngine();
  e.setModel(testModel());
  e.setShow(show(graph));
  return e;
}

/** Largest absolute per-channel difference between two frames. */
function maxDiff(a: Readonly<Float32Array>, b: Readonly<Float32Array>): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!));
  return m;
}

describe('S1/B1 — delay→Mix overlap does not double-count the still-live member', () => {
  it('the immediate composite is superseded on drain: one voice, not two, across the overlap window', () => {
    const e = engine(mixDelayGraph(100));
    e.applyInput(hit(0));

    e.tick(5, 5, transport(5)); // fire: spawn immediate Mix[A], enqueue delayed B (due at 105)
    expect(e.stats().voiceCount).toBe(1);

    e.tick(120, 115, transport(120)); // drain B → re-composed Mix[A,B] supersedes (releases) Mix[A]
    e.tick(260, 140, transport(260)); // past the superseded voice's release tail → it has reaped

    // Pre-fix: Mix[A] never released by the drain, still in its (100s) sustain → count 2.
    expect(e.stats().voiceCount).toBe(1);
  });

  it('composited brightness settles to a single Mix[A,B], not a doubled A (vs the no-delay baseline)', () => {
    const settleMs = 260;
    const delayed = engine(mixDelayGraph(100));
    delayed.applyInput(hit(0));
    delayed.tick(5, 5, transport(5));
    delayed.tick(120, 115, transport(120));
    delayed.tick(settleMs, 140, transport(settleMs));

    // Baseline: the equivalent immediate Mix[A,B], ticked to the SAME absolute time. solid-base is
    // a pure function of timeMs, and both composites sit at sustain level 1, so a correct overlap
    // resolution renders an identical frame; a lingering Mix[A] would add A again and diverge.
    const baseline = engine(noDelayMixGraph());
    baseline.applyInput(hit(0));
    baseline.tick(5, 5, transport(5));
    baseline.tick(settleMs, 140, transport(settleMs));

    expect(delayed.stats().voiceCount).toBe(1);
    expect(maxDiff(delayed.frame(), baseline.frame())).toBeLessThan(1e-6);
  });

  it('decayed member absent: A reaps before B drains → a single composite spawns on drain', () => {
    // Short-lived A (reaps well before the 1000ms delay), normal B.
    const e = createVoiceBusEngine();
    e.setModel(testModel());
    e.setShow({
      buses: buses(),
      graphs: { [padKey('kick', '')]: mixDelayGraph(1000) },
      sections: [],
      effects: [effect('fxA', { sustainMs: 20, releaseMs: 20 }), effect('fxB')],
      presets: [],
    });
    e.applyInput(hit(0));
    e.tick(5, 5, transport(5)); // spawn immediate Mix[A], enqueue B (due at 1005)

    // Let A run its full envelope and reap before the delay elapses.
    for (let t = 20; t <= 120 && e.stats().voiceCount > 0; t += 20) e.tick(t, 20, transport(t));
    expect(e.stats().voiceCount).toBe(0); // A decayed and reaped, B not yet due

    e.tick(1010, 200, transport(1010)); // drain B — no still-live A to fold or supersede
    expect(e.stats().voiceCount).toBe(1); // exactly one composite (just B), no lingering A voice
  });

  it('delay-0 parity at the engine level: byte-identical frame to the no-delay graph', () => {
    const zero = engine(mixDelayGraph(0));
    zero.applyInput(hit(0));
    zero.tick(5, 5, transport(5));
    zero.tick(40, 35, transport(40));

    const none = engine(noDelayMixGraph());
    none.applyInput(hit(0));
    none.tick(5, 5, transport(5));
    none.tick(40, 35, transport(40));

    expect(zero.stats().voiceCount).toBe(1);
    expect(none.stats().voiceCount).toBe(1);
    expect(maxDiff(zero.frame(), none.frame())).toBe(0);
  });

  it('rapid double-fire on the same pad keeps genuine multiplicity (two composites, not collapsed)', () => {
    const e = engine(noDelayMixGraph());

    e.applyInput(hit(0));
    e.tick(5, 5, transport(5)); // first Mix[A,B]
    expect(e.stats().voiceCount).toBe(1);

    e.applyInput(hit(5));
    e.tick(10, 5, transport(10)); // second fire is a fresh trigger (no drain) → its own composite

    // Immediate spawns never carry the supersede flag, so the two fires do NOT collapse.
    expect(e.stats().voiceCount).toBe(2);
  });
});

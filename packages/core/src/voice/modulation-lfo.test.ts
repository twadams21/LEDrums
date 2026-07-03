import { describe, expect, it } from 'vitest';
import {
  LFO_WAVEFORMS,
  defaultLfoSettings,
  lfoPeriodMs,
  sampleLfo,
  type LfoSettings,
} from './lfo';
import { applyModulations, sampleSource, type Mapping, type ModSampleCtx } from './modulation';
import { nodeModSource, resolveNodeModulations } from './modulation-graph';
import type { GraphNode, ParamSpec, TriggerGraph } from './types';

/* S36 — LFO source node. Pins the acceptance criteria: per-waveform determinism (same t/bpm ⇒
   same value); division sync tracks bpm; and a graph-resolved LFO mapping modulates a param
   CONTINUOUSLY — the same value for every voice regardless of its life phase (envelopes phase-lock,
   LFOs don't). Pure f(timeMs, bpm): no state, no wall-clock, no Math.random (S&H is hash-derived). */

const lfo = (over: Partial<LfoSettings> = {}): LfoSettings => ({ ...defaultLfoSettings(), ...over });

describe('sampleLfo — waveform goldens (1 Hz ⇒ period 1000ms, bpm irrelevant in Hz mode)', () => {
  it('sine rises from 0.5, peaks at quarter, troughs at three-quarter', () => {
    const s = lfo({ waveform: 'sine' });
    expect(sampleLfo(s, 0, 120)).toBeCloseTo(0.5, 10);
    expect(sampleLfo(s, 250, 120)).toBeCloseTo(1, 10);
    expect(sampleLfo(s, 500, 120)).toBeCloseTo(0.5, 10);
    expect(sampleLfo(s, 750, 120)).toBeCloseTo(0, 10);
    expect(sampleLfo(s, 1000, 120)).toBeCloseTo(0.5, 10); // wraps to phase 0
  });

  it('triangle: 0 → 1 → 0', () => {
    const s = lfo({ waveform: 'triangle' });
    expect(sampleLfo(s, 0, 120)).toBeCloseTo(0, 10);
    expect(sampleLfo(s, 250, 120)).toBeCloseTo(0.5, 10);
    expect(sampleLfo(s, 500, 120)).toBeCloseTo(1, 10);
    expect(sampleLfo(s, 750, 120)).toBeCloseTo(0.5, 10);
  });

  it('saw: rising ramp 0 → ~1', () => {
    const s = lfo({ waveform: 'saw' });
    expect(sampleLfo(s, 0, 120)).toBeCloseTo(0, 10);
    expect(sampleLfo(s, 500, 120)).toBeCloseTo(0.5, 10);
    expect(sampleLfo(s, 990, 120)).toBeCloseTo(0.99, 10);
  });

  it('square: high first half, low second half', () => {
    const s = lfo({ waveform: 'square' });
    expect(sampleLfo(s, 0, 120)).toBe(1);
    expect(sampleLfo(s, 499, 120)).toBe(1);
    expect(sampleLfo(s, 500, 120)).toBe(0);
    expect(sampleLfo(s, 999, 120)).toBe(0);
  });

  it('phase offset shifts the waveform (quarter-cycle lead)', () => {
    const s = lfo({ waveform: 'sine', phase: 0.25 });
    expect(sampleLfo(s, 0, 120)).toBeCloseTo(1, 10); // phase 0 + 0.25 = peak
  });
});

describe('determinism — same (t, bpm) ⇒ same value, every waveform', () => {
  for (const waveform of LFO_WAVEFORMS) {
    it(`${waveform} is a pure function of (t, bpm)`, () => {
      const s = lfo({ waveform, rateMode: 'beats', division: 'dotted-1/8' });
      for (const t of [0, 37, 128.5, 500, 993, 4021]) {
        const a = sampleLfo(s, t, 137);
        const b = sampleLfo(s, t, 137);
        expect(b).toBe(a);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1);
      }
    });
  }
});

describe('sample-hold — hash-derived per period, held within it', () => {
  it('holds one value across a whole period, then changes', () => {
    const s = lfo({ waveform: 'sample-hold', rateHz: 1 }); // period 1000ms
    const first = sampleLfo(s, 0, 120);
    expect(sampleLfo(s, 250, 120)).toBe(first);
    expect(sampleLfo(s, 999, 120)).toBe(first); // still bucket 0
    const second = sampleLfo(s, 1000, 120); // bucket 1
    expect(second).not.toBe(first);
    expect(sampleLfo(s, 1000, 120)).toBe(second); // deterministic re-sample
  });

  it('stays in 0..1 across many buckets', () => {
    const s = lfo({ waveform: 'sample-hold', rateHz: 4 });
    for (let t = 0; t < 5000; t += 53) {
      const v = sampleLfo(s, t, 90);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('division sync — period tracks bpm', () => {
  it('lfoPeriodMs resolves the shared delay vocabulary', () => {
    expect(lfoPeriodMs(lfo({ rateMode: 'beats', division: '1/4' }), 120)).toBeCloseTo(500, 10);
    expect(lfoPeriodMs(lfo({ rateMode: 'beats', division: '1/4' }), 240)).toBeCloseTo(250, 10);
    expect(lfoPeriodMs(lfo({ rateMode: 'beats', division: '1/8' }), 120)).toBeCloseTo(250, 10);
  });

  it('the same beat-relative moment gives the same phase at any bpm', () => {
    const s = lfo({ waveform: 'sine', rateMode: 'beats', division: '1/4' });
    // A quarter-period into the cycle → sine peak (1.0), independent of tempo.
    expect(sampleLfo(s, 500 / 4, 120)).toBeCloseTo(1, 10);
    expect(sampleLfo(s, 250 / 4, 240)).toBeCloseTo(1, 10);
  });

  it('freezes safely at a non-positive rate (no divide-by-zero)', () => {
    expect(lfoPeriodMs(lfo({ rateMode: 'hz', rateHz: 0 }), 120)).toBe(0);
    expect(sampleLfo(lfo({ waveform: 'saw', rateHz: 0, phase: 0.3 }), 9999, 120)).toBeCloseTo(0.3, 10);
    expect(lfoPeriodMs(lfo({ rateMode: 'beats', division: '1/4' }), 0)).toBe(0);
  });
});

describe('sampleSource — LFO reads absolute time, never the voice phase', () => {
  it('ignores ctx.phase (continuous), reads timeMs/bpm', () => {
    const src = { kind: 'lfo' as const, lfo: lfo({ waveform: 'sine' }) };
    const at = (phase: number, timeMs: number): number =>
      sampleSource(src, { phase, timeMs, bpm: 120 } satisfies ModSampleCtx);
    // Two voices at wildly different life phases, same frame time → identical LFO value.
    expect(at(0.1, 250)).toBeCloseTo(1, 10);
    expect(at(0.9, 250)).toBeCloseTo(1, 10);
  });
});

describe('graph resolution — an LFO node wired to a param modulates every voice the same', () => {
  const graph: TriggerGraph = {
    nodes: [
      { id: 'lfo1', kind: 'lfo', lfo: lfo({ waveform: 'saw', rateHz: 1 }) } as unknown as GraphNode,
      { id: 'play1', kind: 'play' } as unknown as GraphNode,
    ],
    edges: [{ id: 'e1', from: 'lfo1', to: 'play1', toPort: 'param:brightness', amount: 1 }],
  };
  const spec: ParamSpec = { key: 'brightness', label: 'Brightness', kind: 'number', min: 0, max: 1, default: 0 };

  it('nodeModSource builds an lfo source from the node settings', () => {
    const src = nodeModSource(graph.nodes[0]!);
    expect(src?.kind).toBe('lfo');
  });

  it('resolves to an lfo mapping; the swept value is phase-independent + tracks time', () => {
    const mappings: Mapping[] = resolveNodeModulations(graph, graph.nodes[1]!, [spec]);
    expect(mappings).toHaveLength(1);
    expect(mappings[0]!.source.kind).toBe('lfo');

    const sweep = (phase: number, timeMs: number): number => {
      const out = { brightness: 0 };
      applyModulations({ brightness: 0 }, out, mappings, [spec], { phase, timeMs, bpm: 120 });
      return out.brightness;
    };
    // saw at t=250 (period 1000) → phase 0.25 → 0.25; base 0, amount 1, range [0,1].
    expect(sweep(0.0, 250)).toBeCloseTo(0.25, 10);
    expect(sweep(0.8, 250)).toBeCloseTo(0.25, 10); // different voice phase, SAME value
    expect(sweep(0.0, 750)).toBeCloseTo(0.75, 10); // later frame → advanced
  });
});

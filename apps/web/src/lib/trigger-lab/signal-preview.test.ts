import { describe, expect, it } from 'vitest';
import { voice } from '@ledrums/core';
import {
  PREVIEW_LOOP_MS,
  PREVIEW_STATIC_MS,
  ccPreviewValue,
  envelopeTrace,
  formatCcReadout,
  frac,
  lfoTrace,
  paramRowSignal,
  previewCtx,
} from './signal-preview';

const env = (kind: voice.EnvKind = 'decay'): voice.Envelope => voice.defaultEnvelope(kind);
const lfo = (over: Partial<voice.LfoSettings> = {}): voice.LfoSettings => ({
  ...voice.defaultLfoSettings(),
  ...over,
});

describe('signal-preview — pure sampling (S38)', () => {
  describe('frac', () => {
    it('wraps positives and negatives into [0,1)', () => {
      expect(frac(0.25)).toBeCloseTo(0.25, 10);
      expect(frac(1.25)).toBeCloseTo(0.25, 10);
      expect(frac(-0.25)).toBeCloseTo(0.75, 10);
    });
  });

  describe('envelopeTrace', () => {
    it('shape is a 0..1 polyline sampled left→right, matching sampleEnvelope', () => {
      const t = envelopeTrace(env('decay'), 0);
      expect(t.shape.length).toBe(41);
      expect(t.shape[0]!.x).toBe(0);
      expect(t.shape.at(-1)!.x).toBe(1);
      for (const p of t.shape) {
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(1);
        // every plotted point IS the core sample at that phase (no UI re-derivation)
        expect(p.y).toBeCloseTo(Math.min(1, Math.max(0, voice.sampleEnvelope(env('decay'), p.x))), 10);
      }
    });

    it('cursor loops over PREVIEW_LOOP_MS and value tracks the shape at the cursor', () => {
      const e = env('decay');
      expect(envelopeTrace(e, 0).cursor).toBeCloseTo(0, 10);
      expect(envelopeTrace(e, PREVIEW_LOOP_MS / 4).cursor).toBeCloseTo(0.25, 10);
      // one full loop later ⇒ identical cursor (replayed hit)
      expect(envelopeTrace(e, 137 + PREVIEW_LOOP_MS).cursor).toBeCloseTo(envelopeTrace(e, 137).cursor, 10);
      const mid = envelopeTrace(e, PREVIEW_LOOP_MS / 2);
      expect(mid.value).toBeCloseTo(Math.min(1, Math.max(0, voice.sampleEnvelope(e, 0.5))), 10);
    });

    it('is deterministic — same tMs ⇒ same trace', () => {
      expect(envelopeTrace(env(), 500)).toEqual(envelopeTrace(env(), 500));
    });
  });

  describe('lfoTrace', () => {
    it('value equals sampleLfo at tMs (the moving cursor sits on the drawn curve)', () => {
      const s = lfo({ waveform: 'sine', rateMode: 'hz', rateHz: 1 });
      for (const t of [0, 125, 250, 500, 900]) {
        expect(lfoTrace(s, t, 120).value).toBeCloseTo(voice.sampleLfo(s, t, 120), 10);
      }
    });

    it('cursor = frac(t / period); a 1Hz LFO wraps every 1000ms', () => {
      const s = lfo({ rateMode: 'hz', rateHz: 1 });
      expect(lfoTrace(s, 0, 120).cursor).toBeCloseTo(0, 10);
      expect(lfoTrace(s, 250, 120).cursor).toBeCloseTo(0.25, 10);
      expect(lfoTrace(s, 1000, 120).cursor).toBeCloseTo(0, 10);
    });

    it('a frozen LFO (rate 0) is a flat shape and a static cursor, never NaN', () => {
      const s = lfo({ rateMode: 'hz', rateHz: 0, phase: 0.3 });
      const t = lfoTrace(s, 777, 120);
      expect(t.cursor).toBeCloseTo(0.3, 10);
      const first = t.shape[0]!.y;
      for (const p of t.shape) {
        expect(Number.isNaN(p.y)).toBe(false);
        expect(p.y).toBeCloseTo(first, 10); // flat
      }
    });

    it('beats-mode period tracks bpm (division sync)', () => {
      const s = lfo({ rateMode: 'beats', division: '1/4' });
      // 1/4 at 120bpm = 500ms period ⇒ cursor 0.5 at 250ms
      expect(lfoTrace(s, 250, 120).cursor).toBeCloseTo(0.5, 10);
      // at 240bpm the period halves ⇒ cursor wraps to 0 at 250ms
      expect(lfoTrace(s, 250, 240).cursor).toBeCloseTo(0, 10);
    });
  });

  describe('ccPreviewValue / formatCcReadout', () => {
    it('reads the live 0..1 level from the CC table (omni + per-channel)', () => {
      const table = new Map<string, number>();
      table.set(voice.ccKey(7, null), 0.5);
      table.set(voice.ccKey(7, 3), 1);
      expect(ccPreviewValue(table, 7, null)).toBeCloseTo(0.5, 10);
      expect(ccPreviewValue(table, 7, 3)).toBeCloseTo(1, 10);
      expect(ccPreviewValue(table, 7, 9)).toBe(0); // unheard channel
      expect(ccPreviewValue(undefined, 7, null)).toBe(0); // no table yet
    });

    it('formats a level as its raw MIDI 0..127 value', () => {
      expect(formatCcReadout(0)).toBe('0');
      expect(formatCcReadout(1)).toBe('127');
      expect(formatCcReadout(0.5)).toBe('64');
    });
  });

  describe('paramRowSignal', () => {
    const decaySrc: voice.ModSource = { kind: 'envelope', env: env('decay') };
    const ctx = previewCtx(0, 120, undefined);

    it('no wires ⇒ 0', () => {
      expect(paramRowSignal([], ctx)).toBe(0);
    });

    it('single source ⇒ its post-invert signal', () => {
      const raw = voice.sampleSource(decaySrc, ctx);
      expect(paramRowSignal([{ source: decaySrc, invert: false }], ctx)).toBeCloseTo(raw, 10);
      expect(paramRowSignal([{ source: decaySrc, invert: true }], ctx)).toBeCloseTo(1 - raw, 10);
    });

    it('multiple sources ⇒ mean of post-invert signals, clamped 0..1', () => {
      const cc: voice.ModSource = { kind: 'cc', controller: 1, channel: null };
      const table = new Map([[voice.ccKey(1, null), 1]]);
      const c = previewCtx(0, 120, table);
      const a = voice.sampleSource(decaySrc, c);
      const out = paramRowSignal(
        [
          { source: decaySrc, invert: false },
          { source: cc, invert: false },
        ],
        c,
      );
      expect(out).toBeCloseTo((a + 1) / 2, 10);
      expect(out).toBeGreaterThanOrEqual(0);
      expect(out).toBeLessThanOrEqual(1);
    });

    it('LFO source ticks off ctx.timeMs (continuous), not phase', () => {
      const src: voice.ModSource = { kind: 'lfo', lfo: lfo({ rateMode: 'hz', rateHz: 1 }) };
      const at0 = paramRowSignal([{ source: src, invert: false }], previewCtx(0, 120, undefined));
      const at250 = paramRowSignal([{ source: src, invert: false }], previewCtx(250, 120, undefined));
      expect(at0).not.toBeCloseTo(at250, 5);
    });
  });

  describe('previewCtx / reduced-motion policy', () => {
    it('envelope phase loops over PREVIEW_LOOP_MS', () => {
      expect(previewCtx(0, 120, undefined).phase).toBeCloseTo(0, 10);
      expect(previewCtx(PREVIEW_LOOP_MS / 2, 120, undefined).phase).toBeCloseTo(0.5, 10);
    });

    it('the reduced-motion static frame is a stable, representative point in the loop', () => {
      // no animation: both previews sampled at PREVIEW_STATIC_MS are deterministic + mid-shape
      expect(PREVIEW_STATIC_MS).toBeGreaterThan(0);
      expect(PREVIEW_STATIC_MS).toBeLessThan(PREVIEW_LOOP_MS);
      const a = envelopeTrace(env(), PREVIEW_STATIC_MS);
      const b = envelopeTrace(env(), PREVIEW_STATIC_MS);
      expect(a).toEqual(b);
      expect(a.cursor).toBeCloseTo(0.25, 10);
    });
  });
});

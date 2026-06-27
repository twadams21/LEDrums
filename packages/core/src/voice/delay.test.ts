import { describe, expect, it } from 'vitest';
import { computeDelayMs, DELAY_DIVISIONS } from './delay';

// ---- absolute time mode -------------------------------------------------------

describe('computeDelayMs — absolute time mode', () => {
  it('returns ms directly regardless of division and bpm', () => {
    expect(computeDelayMs('time', 300, '1/8', 120)).toBe(300);
    expect(computeDelayMs('time', 0, '1/4', 60)).toBe(0);
    expect(computeDelayMs('time', -50, '1/16', 140)).toBe(-50);
    expect(computeDelayMs('time', 1000, 'dotted-1/4', 120)).toBe(1000);
  });
});

// ---- beats mode at 120 bpm ----------------------------------------------------

describe('computeDelayMs — beats mode at 120 bpm', () => {
  const bpm = 120;

  it('resolves bare note values: 1/4 = 500ms, 1/8 = 250ms, 1/16 = 125ms', () => {
    expect(computeDelayMs('beats', 0, '1/4', bpm)).toBeCloseTo(500, 6);
    expect(computeDelayMs('beats', 0, '1/8', bpm)).toBeCloseTo(250, 6);
    expect(computeDelayMs('beats', 0, '1/16', bpm)).toBeCloseTo(125, 6);
  });

  it('resolves dotted values (base × 1.5)', () => {
    expect(computeDelayMs('beats', 0, 'dotted-1/4', bpm)).toBeCloseTo(750, 6);
    expect(computeDelayMs('beats', 0, 'dotted-1/8', bpm)).toBeCloseTo(375, 6);
    expect(computeDelayMs('beats', 0, 'dotted-1/16', bpm)).toBeCloseTo(187.5, 6);
  });

  it('resolves triplet values (base × 2/3)', () => {
    expect(computeDelayMs('beats', 0, 'triplet-1/4', bpm)).toBeCloseTo(500 * (2 / 3), 6);
    expect(computeDelayMs('beats', 0, 'triplet-1/8', bpm)).toBeCloseTo(250 * (2 / 3), 6);
    expect(computeDelayMs('beats', 0, 'triplet-1/16', bpm)).toBeCloseTo(125 * (2 / 3), 6);
  });
});

// ---- beats mode at 60 bpm ----------------------------------------------------

describe('computeDelayMs — beats mode at 60 bpm', () => {
  const bpm = 60;

  it('doubles the 120bpm values: 1/4 = 1000ms, 1/8 = 500ms, 1/16 = 250ms', () => {
    expect(computeDelayMs('beats', 0, '1/4', bpm)).toBeCloseTo(1000, 6);
    expect(computeDelayMs('beats', 0, '1/8', bpm)).toBeCloseTo(500, 6);
    expect(computeDelayMs('beats', 0, '1/16', bpm)).toBeCloseTo(250, 6);
  });

  it('dotted-1/4 = 1500ms; triplet-1/8 = 500 × (2/3) = 333.33ms', () => {
    expect(computeDelayMs('beats', 0, 'dotted-1/4', bpm)).toBeCloseTo(1500, 6);
    // eighth at 60bpm = 500ms; triplet × 2/3 = 333.33ms (NOT 1000×(2/3))
    expect(computeDelayMs('beats', 0, 'triplet-1/8', bpm)).toBeCloseTo(500 * (2 / 3), 6);
  });
});

// ---- beats mode at 140 bpm ---------------------------------------------------

describe('computeDelayMs — beats mode at 140 bpm', () => {
  const bpm = 140;
  const q = 60000 / 140;

  it('resolves quarter, eighth, and sixteenth correctly', () => {
    expect(computeDelayMs('beats', 0, '1/4', bpm)).toBeCloseTo(q, 6);
    expect(computeDelayMs('beats', 0, '1/8', bpm)).toBeCloseTo(q / 2, 6);
    expect(computeDelayMs('beats', 0, '1/16', bpm)).toBeCloseTo(q / 4, 6);
  });

  it('resolves dotted-1/8 and triplet-1/16 at 140bpm', () => {
    expect(computeDelayMs('beats', 0, 'dotted-1/8', bpm)).toBeCloseTo((q / 2) * 1.5, 6);
    expect(computeDelayMs('beats', 0, 'triplet-1/16', bpm)).toBeCloseTo((q / 4) * (2 / 3), 6);
  });
});

// ---- DELAY_DIVISIONS coverage -------------------------------------------------

describe('computeDelayMs — DELAY_DIVISIONS coverage', () => {
  it('resolves every canonical division at 120bpm without throwing and returns > 0', () => {
    for (const div of DELAY_DIVISIONS) {
      expect(() => computeDelayMs('beats', 0, div, 120)).not.toThrow();
      expect(computeDelayMs('beats', 0, div, 120)).toBeGreaterThan(0);
    }
  });

  it('unknown division falls back to quarter note duration', () => {
    expect(computeDelayMs('beats', 0, 'unknown', 120)).toBeCloseTo(500, 6);
    expect(computeDelayMs('beats', 0, '', 120)).toBeCloseTo(500, 6);
  });
});

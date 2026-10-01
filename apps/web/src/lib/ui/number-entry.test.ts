import { describe, expect, it } from 'vitest';
import { clampEntry, entryText, parseEntry } from './number-entry';

/* Typing an exact value into a slider's box (Tim, 2026-10-02). */
describe('parseEntry', () => {
  it('reads plain numbers, with a comma or a stray space', () => {
    expect(parseEntry('250')).toBe(250);
    expect(parseEntry(' 0,5 ')).toBe(0.5);
    expect(parseEntry('-3')).toBe(-3);
    expect(parseEntry('abc')).toBeNull();
    expect(parseEntry('')).toBeNull();
  });
  it('a millisecond param accepts seconds', () => {
    expect(parseEntry('1.5s', { unit: 'ms' })).toBe(1500);
    expect(parseEntry('250ms', { unit: 'ms' })).toBe(250);
  });
  it('a beats param accepts a division: straight, dotted, triplet', () => {
    expect(parseEntry('1/8', { unit: 'beats' })).toBe(0.5);
    expect(parseEntry('1/4.', { unit: 'beats' })).toBe(1.5);
    expect(parseEntry('1/8t', { unit: 'beats' })).toBeCloseTo(1 / 3, 6);
    expect(parseEntry('2', { unit: 'beats' })).toBe(2);
  });
  it('a percent is typed as shown — 25 or 25% means 0.25', () => {
    expect(parseEntry('25', { factor: 100, unit: '%' })).toBe(0.25);
    expect(parseEntry('25%', { factor: 100, unit: '%' })).toBe(0.25);
  });
});

describe('entryText / clampEntry', () => {
  it('starts the box with the value as shown, without needless decimals', () => {
    expect(entryText(0.25, { factor: 100 })).toBe('25');
    expect(entryText(8)).toBe('8');
    expect(entryText(0.1 + 0.2)).toBe('0.3');
  });
  it('clamps to the range; whole-number params stay whole; exact values are NOT snapped to the step', () => {
    expect(clampEntry(999, 0, 100, 1)).toBe(100);
    expect(clampEntry(12.6, 0, 100, 1)).toBe(13);
    expect(clampEntry(0.333, 0, 1, 0.05)).toBe(0.333);
  });
});

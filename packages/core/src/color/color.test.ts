import { describe, expect, it } from 'vitest';
import { hexToRgb, hsvToRgb, rgbToHsv, toByte } from './color';

describe('color', () => {
  it('hsv hue=0 sat=1 val=1 -> red', () => {
    const rgb = hsvToRgb(0, 1, 1);
    expect(rgb).toEqual({ r: 1, g: 0, b: 0 });
  });

  it('round-trips hsv -> rgb -> hsv for representative hues', () => {
    for (const h of [0, 60, 120, 200, 280, 359]) {
      const rgb = hsvToRgb(h, 0.8, 0.7);
      const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
      expect(hsv.h).toBeCloseTo(h, 4);
      expect(hsv.s).toBeCloseTo(0.8, 6);
      expect(hsv.v).toBeCloseTo(0.7, 6);
    }
  });

  it('parses hex colors', () => {
    expect(hexToRgb('#ff0000')).toEqual({ r: 1, g: 0, b: 0 });
    expect(hexToRgb('#000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb('nonsense')).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('quantizes to bytes and clamps', () => {
    expect(toByte(0)).toBe(0);
    expect(toByte(1)).toBe(255);
    expect(toByte(2)).toBe(255);
    expect(toByte(0.5)).toBe(128);
  });
});

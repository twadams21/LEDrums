import { describe, expect, it } from 'vitest';
import { hexToHsv, hexToRgb, hsvToHex, hsvToRgb, rgbToHex, rgbToHsv, toByte } from './color';

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

  it('formats normalized rgb as #rrggbb', () => {
    expect(rgbToHex(1, 0, 0)).toBe('#ff0000');
    expect(rgbToHex(0, 0, 0)).toBe('#000000');
    expect(rgbToHex(1, 1, 1)).toBe('#ffffff');
    expect(rgbToHex(0.5, 0.5, 0.5)).toBe('#808080');
  });

  it('hsvToHex ↔ hexToHsv round-trips for the swatch write-through', () => {
    // saturation 0 → a pure grey the picker can represent; hue is undefined so 0.
    expect(hsvToHex(0, 0, 1)).toBe('#ffffff');
    expect(hsvToHex(0, 1, 1)).toBe('#ff0000');
    for (const [h, s, v] of [
      [30, 1, 1],
      [200, 0.8, 0.6],
      [280, 0.5, 0.9],
    ] as const) {
      const hsv = hexToHsv(hsvToHex(h, s, v));
      // 8-bit quantization tolerance: within ~1.5° hue / 0.01 s·v after the byte round-trip.
      expect(hsv.h).toBeCloseTo(h, 0);
      expect(hsv.s).toBeCloseTo(s, 1);
      expect(hsv.v).toBeCloseTo(v, 1);
    }
  });

  it('hexToHsv reports saturation 0 for greys (white/black)', () => {
    expect(hexToHsv('#ffffff').s).toBe(0);
    expect(hexToHsv('#000000').v).toBe(0);
  });
});

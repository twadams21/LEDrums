import { describe, expect, it } from 'vitest';
import { clampPopoverPosition } from './popover-placement';

const SIZE = { w: 280, h: 360 };
const CANVAS = { w: 1000, h: 700 };

describe('clampPopoverPosition', () => {
  it('opens forward from the invoke point when it fits', () => {
    expect(clampPopoverPosition(100, 120, SIZE, CANVAS)).toEqual({ x: 100, y: 120 });
  });

  it('flips leftwards when the box would overflow the right edge', () => {
    // 900 + 280 + 8 > 1000 → open backwards from the invoke point.
    expect(clampPopoverPosition(900, 120, SIZE, CANVAS).x).toBe(620);
  });

  it('flips upwards when the box would overflow the bottom edge', () => {
    expect(clampPopoverPosition(100, 600, SIZE, CANVAS).y).toBe(240);
  });

  it('clamps instead of flipping when the flip would leave the near edge', () => {
    // A narrow canvas: neither direction fits, so it pins inside the far edge.
    expect(clampPopoverPosition(100, 40, SIZE, { w: 300, h: 700 }).x).toBe(12);
  });

  it('pins to the near edge when the popover is larger than the canvas', () => {
    expect(clampPopoverPosition(40, 40, SIZE, { w: 200, h: 200 })).toEqual({ x: 8, y: 8 });
  });

  it('never places the box past the leading margin', () => {
    expect(clampPopoverPosition(-50, -50, SIZE, CANVAS)).toEqual({ x: 8, y: 8 });
  });

  it('honours a custom margin', () => {
    expect(clampPopoverPosition(0, 0, SIZE, CANVAS, 24)).toEqual({ x: 24, y: 24 });
  });
});

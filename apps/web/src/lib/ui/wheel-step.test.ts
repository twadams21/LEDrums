import { describe, expect, it } from 'vitest';
import { wheelStep } from './wheel-step';

/* One tick = one step, whatever the hardware reports. These lock the rule the numeric
   controls share: sign-only reading, clamping, and the no-op cases that keep a resting
   control from republishing its own value. */

describe('wheelStep', () => {
  it('moves one step up on a scroll up, one down on a scroll down', () => {
    expect(wheelStep({ value: 7, deltaY: -100 })).toBe('8');
    expect(wheelStep({ value: 7, deltaY: 100 })).toBe('6');
  });

  it('reads only the sign — a trackpad nudge and a mouse notch move the same amount', () => {
    expect(wheelStep({ value: 7, deltaY: -3 })).toBe('8');
    expect(wheelStep({ value: 7, deltaY: -960 })).toBe('8');
  });

  it('honours a fractional step without floating-point litter', () => {
    expect(wheelStep({ value: 0.2, deltaY: -1, step: 0.1 })).toBe('0.3');
  });

  it('clamps to min and max', () => {
    expect(wheelStep({ value: 1, deltaY: 100, min: 0 })).toBe('0');
    expect(wheelStep({ value: 119, deltaY: -1, max: 120 })).toBe('120');
  });

  it('is a no-op at the clamp it is pushed against (no pointless commit)', () => {
    expect(wheelStep({ value: 0, deltaY: 100, min: 0 })).toBeNull();
    expect(wheelStep({ value: 120, deltaY: -1, max: 120 })).toBeNull();
  });

  it('is a no-op for a zero delta', () => {
    expect(wheelStep({ value: 4, deltaY: 0 })).toBeNull();
  });

  it('starts an empty field at min (or zero) instead of refusing to move', () => {
    expect(wheelStep({ value: '', deltaY: -1, min: 1 })).toBe('2');
    expect(wheelStep({ value: '', deltaY: -1 })).toBe('1');
    expect(wheelStep({ value: '', deltaY: 1, min: 0 })).toBe('0');
  });

  it('recovers from a non-numeric value rather than producing NaN', () => {
    expect(wheelStep({ value: 'dense', deltaY: -1, min: 0 })).toBe('1');
  });
});

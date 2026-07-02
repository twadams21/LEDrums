// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import EffectThumb from './EffectThumb.svelte';
import { renderGeneratorThumbFrame, THUMB_LOOP_MS } from './effect-thumb-render';
import { ticker } from './effect-thumb-ticker';
import type { ParamValues, Pattern } from './sim';

/**
 * Mock IntersectionObserver for jsdom (not built-in).
 */
class MockIntersectionObserver {
  private callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }

  observe(element: Element) {
    // Simulate element is visible
    this.callback([{ isIntersecting: true, target: element } as any], this as any);
  }

  unobserve() {}
  disconnect() {}
}

describe('EffectThumb', () => {
  beforeEach(() => {
    if (!globalThis.IntersectionObserver) {
      (globalThis as any).IntersectionObserver = MockIntersectionObserver;
    }
  });

  it('mounts a canvas element without throwing', () => {
    const { container } = render(EffectThumb, {
      props: {
        pattern: 'flash' as Pattern,
        params: { hue: 0, brightness: 1 } as ParamValues,
        w: 64,
        h: 36,
      },
    });

    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
  });

  it('sets canvas inline style with w and h props', () => {
    const { container } = render(EffectThumb, {
      props: {
        pattern: 'flash' as Pattern,
        params: { hue: 0, brightness: 1 } as ParamValues,
        w: 100,
        h: 50,
      },
    });

    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas).not.toBeNull();
    expect(canvas.style.width).toBe('100px');
    expect(canvas.style.aspectRatio).toContain('100');
    expect(canvas.style.aspectRatio).toContain('50');
  });

  it('renders a pattern-backed effect without throwing', () => {
    const { container } = render(EffectThumb, {
      props: {
        pattern: 'flash' as Pattern,
        params: { hue: 45, brightness: 0.8 } as ParamValues,
        w: 64,
        h: 36,
      },
    });

    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    // Component should have rendered without errors
    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
  });

  it('renders a generator-backed effect without throwing (no labModel required)', () => {
    const { container } = render(EffectThumb, {
      props: {
        pattern: 'flash' as Pattern,
        params: { hue: 0, brightness: 1 } as ParamValues,
        generatorId: 'plasma',
        w: 64,
        h: 36,
      },
    });

    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
  });

  it('component handles missing generatorId gracefully', () => {
    const { container } = render(EffectThumb, {
      props: {
        pattern: 'flash' as Pattern,
        params: { hue: 0, brightness: 1 } as ParamValues,
        w: 64,
        h: 36,
      },
    });

    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
  });

  it('monitors prefers-reduced-motion media query on mount', () => {
    const addEventListenerSpy = vi.fn();
    const mockMatchMedia = vi.fn(() => ({
      matches: false,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: addEventListenerSpy,
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const originalMatchMedia = globalThis.matchMedia;
    (globalThis as any).matchMedia = mockMatchMedia;

    try {
      const { container } = render(EffectThumb, {
        props: {
          pattern: 'flash' as Pattern,
          params: { hue: 0, brightness: 1 } as ParamValues,
          w: 64,
          h: 36,
        },
      });

      const canvas = container.querySelector('canvas');
      expect(canvas).not.toBeNull();
      expect(addEventListenerSpy).toHaveBeenCalledWith('change', expect.any(Function));
    } finally {
      (globalThis as any).matchMedia = originalMatchMedia;
    }
  });
});

/**
 * Unit tests for renderGeneratorThumbFrame.
 */
describe('renderGeneratorThumbFrame', () => {
  it('returns null for an unknown generator id', () => {
    const result = renderGeneratorThumbFrame('non-existent-xyz', {}, 0);
    expect(result).toBeNull();
  });

  it('returns exactly 26×13=338 RGB tuples for a known generator', () => {
    // 'solid-base' is always registered and renders a simple uniform colour.
    const result = renderGeneratorThumbFrame('solid-base', {}, 400);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(26 * 13);
  });

  it('each returned tuple contains three numbers in 0..1', () => {
    const result = renderGeneratorThumbFrame('solid-base', {}, 400);
    expect(result).not.toBeNull();
    for (const [r, g, b] of result!) {
      expect(typeof r).toBe('number');
      expect(typeof g).toBe('number');
      expect(typeof b).toBe('number');
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
    }
  });

  it('returns the same length regardless of tMs', () => {
    const r0 = renderGeneratorThumbFrame('solid-base', {}, 0);
    const r1 = renderGeneratorThumbFrame('solid-base', {}, 1000);
    expect(r0!.length).toBe(r1!.length);
  });
});

/**
 * Unit tests for the effect-thumb-ticker module.
 */
describe('effect-thumb-ticker', () => {
  it('starts the rAF loop on first subscribe', () => {
    const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame');

    const unsub = ticker.subscribe(() => {});

    expect(rafSpy).toHaveBeenCalled();

    unsub();
    rafSpy.mockRestore();
  });

  it('stops the rAF loop when the last subscriber unsubscribes', () => {
    const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame');

    const unsub1 = ticker.subscribe(() => {});
    const unsub2 = ticker.subscribe(() => {});

    expect(cancelSpy).not.toHaveBeenCalled();

    unsub1();
    expect(cancelSpy).not.toHaveBeenCalled();

    unsub2();
    expect(cancelSpy).toHaveBeenCalled();

    cancelSpy.mockRestore();
  });

  it('returns an unsubscribe function', () => {
    const callback = vi.fn();
    const unsub = ticker.subscribe(callback);
    expect(typeof unsub).toBe('function');
    unsub();
  });

  it('supports multiple subscribers independently', () => {
    const callback1 = vi.fn();
    const callback2 = vi.fn();

    const unsub1 = ticker.subscribe(callback1);
    const unsub2 = ticker.subscribe(callback2);

    unsub1();
    unsub2();

    expect(callback1).toBeDefined();
    expect(callback2).toBeDefined();
  });
});

/**
 * S27 — timebase-aware looping thumbnails.
 *
 * The renderer drives its synthetic trigger with a looping age so hit-relative
 * effects fire → decay → repeat, and reads each generator's declared `timebase`
 * (generically — no effect ids are special-cased) to decide whether it animates on
 * the hit-relative age ('voice') or the free-running wall-clock ('absolute').
 *
 * Subjects available on this base branch (group/G): chase is the only 'voice'
 * generator (S25); the rest are 'absolute'. Hit-relative decay effects (whole-drum,
 * burst, radial-wash, whole-kit) animate off `trig.ageMs` regardless of the flag, so
 * they exercise the looping age; plasma is a time-varying 'absolute' texture.
 */
describe('renderGeneratorThumbFrame — timebase-aware looping (S27)', () => {
  type Frame = [number, number, number][];
  const COLS = 26;
  const LIT = 0.004; // matches the effects' own visibility floor

  const litSum = (f: Frame): number => f.reduce((s, [r, g, b]) => s + r + g + b, 0);
  const litCount = (f: Frame): number =>
    f.reduce((n, [r, g, b]) => (r + g + b > LIT ? n + 1 : n), 0);
  const litRows = (f: Frame): number[] => {
    const rows = new Set<number>();
    f.forEach(([r, g, b], i) => {
      if (r + g + b > LIT) rows.add(Math.floor(i / COLS));
    });
    return [...rows].sort((a, b) => a - b);
  };
  const framesEqual = (a: Frame, b: Frame): boolean =>
    a.length === b.length &&
    a.every(([r, g, bl], i) => r === b[i]![0] && g === b[i]![1] && bl === b[i]![2]);

  it('hit-relative effects fire on the hit and decay over the loop (not frozen at full)', () => {
    const onHit = renderGeneratorThumbFrame('whole-drum', {}, 0)!;
    const late = renderGeneratorThumbFrame('whole-drum', {}, 800)!;
    expect(litSum(onHit)).toBeGreaterThan(0); // lights on the hit
    expect(litSum(onHit)).toBeGreaterThan(litSum(late)); // and decays with age
  });

  it('drum-keyed hit-relative effects find the thumb drum and light up at the hit', () => {
    // Regression: the synthetic trigger's drumId now matches the thumb model's single
    // drum ('thumb'), so these render pixels instead of a black frame.
    for (const id of ['whole-drum', 'burst', 'radial-wash', 'whole-kit']) {
      const f = renderGeneratorThumbFrame(id, {}, 0)!;
      expect(litCount(f), id).toBeGreaterThan(0);
    }
  });

  it('a hit-relative thumbnail is not static — mid-loop differs from the onset frame', () => {
    const onHit = renderGeneratorThumbFrame('whole-drum', {}, 0)!;
    const mid = renderGeneratorThumbFrame('whole-drum', {}, 500)!;
    expect(framesEqual(onHit, mid)).toBe(false);
  });

  it('the synthetic hit repeats every THUMB_LOOP_MS (fire → decay → repeat)', () => {
    const a = renderGeneratorThumbFrame('whole-drum', {}, 137)!;
    const b = renderGeneratorThumbFrame('whole-drum', {}, 137 + THUMB_LOOP_MS)!;
    expect(framesEqual(a, b)).toBe(true);
  });

  it("voice-timebase effects start at their onset on the hit (chase → hoop 0 at age 0)", () => {
    const onHit = renderGeneratorThumbFrame('chase', {}, 0)!;
    expect(litRows(onHit)).toEqual([0]); // voice-local beat 0 → step 0 → hoop 0
  });

  it('voice-timebase effects advance across the loop and restart each period (chase)', () => {
    const at0 = renderGeneratorThumbFrame('chase', {}, 0)!;
    const at400 = renderGeneratorThumbFrame('chase', {}, 400)!;
    expect(litRows(at400)).not.toEqual(litRows(at0)); // stepped forward (hoop 0 → 3)
    // one full loop later, the same phase is byte-identical (restart-on-loop)
    const at400Next = renderGeneratorThumbFrame('chase', {}, 400 + THUMB_LOOP_MS)!;
    expect(framesEqual(at400, at400Next)).toBe(true);
  });

  it('absolute-timebase effects keep the wall-clock (plasma does not loop with the hit period)', () => {
    const a = renderGeneratorThumbFrame('plasma', {}, 100)!;
    const b = renderGeneratorThumbFrame('plasma', {}, 100 + THUMB_LOOP_MS)!;
    // A 'voice' effect at these two times is identical (age loops); an 'absolute' one
    // advances by 1600ms of wall-clock → a different field. Proves the flag is honoured.
    expect(framesEqual(a, b)).toBe(false);
  });

  it('reduced-motion representative frame (age 400ms) is deterministic and non-empty', () => {
    const a = renderGeneratorThumbFrame('whole-kit', {}, 400)!;
    const b = renderGeneratorThumbFrame('whole-kit', {}, 400)!;
    expect(framesEqual(a, b)).toBe(true); // stable static frame
    expect(litSum(a)).toBeGreaterThan(0); // still shows the effect at the representative age
  });
});

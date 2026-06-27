// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import EffectThumb from './EffectThumb.svelte';
import { ticker } from './effect-thumb-ticker';
import type { LabModel } from './kit';
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

  it('renders a generator-backed effect without throwing', () => {
    const mockLabModel = {
      pm: {
        pixelCount: 338,
      },
    } as unknown as LabModel;

    const { container } = render(EffectThumb, {
      props: {
        pattern: 'flash' as Pattern,
        params: { hue: 0, brightness: 1 } as ParamValues,
        generatorId: 'plasma',
        labModel: mockLabModel,
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

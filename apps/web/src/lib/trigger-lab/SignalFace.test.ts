// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/svelte';
import SignalFace from './SignalFace.svelte';
import { ticker } from './effect-thumb-ticker';

/** Visible-by-default IntersectionObserver stub (jsdom has none). */
class MockIntersectionObserver {
  private cb: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
  }
  observe(el: Element) {
    this.cb([{ isIntersecting: true, target: el } as unknown as IntersectionObserverEntry], this as never);
  }
  unobserve() {}
  disconnect() {}
}

function mockMatchMedia(matches: boolean) {
  (globalThis as unknown as { matchMedia: unknown }).matchMedia = vi.fn(() => ({
    matches,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

/** jsdom canvases return null from getContext('2d') — stub a no-op 2D context so the drawing
    effect runs (the tests care about ticker wiring, not pixels). */
function stubCanvas2d() {
  const g = new Proxy({}, { get: () => () => {} }) as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(g as never);
}

describe('SignalFace (S38)', () => {
  beforeEach(() => {
    if (!globalThis.IntersectionObserver) {
      (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = MockIntersectionObserver;
    }
    mockMatchMedia(false);
    stubCanvas2d();
  });
  afterEach(() => vi.restoreAllMocks());

  it('mounts a sized canvas with an accessible label', () => {
    const { container } = render(SignalFace, { props: { draw: () => {}, w: 56, h: 32, ariaLabel: 'sig' } });
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(canvas.style.width).toBe('56px');
    expect(canvas.getAttribute('aria-label')).toBe('sig');
  });

  it('drives the SHARED ticker — one subscription, no per-face rAF loop of its own', () => {
    const subscribeSpy = vi.spyOn(ticker, 'subscribe');
    const draw = vi.fn();

    const { unmount } = render(SignalFace, { props: { draw, w: 40, h: 12 } });

    // it subscribes to the ONE shared ticker (the ticker owns the single rAF loop); the draw
    // fires with the ticker's clock — a face never opens its own requestAnimationFrame.
    expect(subscribeSpy).toHaveBeenCalledTimes(1);
    const cb = subscribeSpy.mock.calls[0]![0] as (t: number) => void;
    cb(123);
    expect(draw).toHaveBeenCalledWith(expect.any(Object), 123);

    unmount();
    subscribeSpy.mockRestore();
  });

  it('reduced-motion: draws ONE static frame and does NOT subscribe to the ticker', () => {
    mockMatchMedia(true);
    const subscribeSpy = vi.spyOn(ticker, 'subscribe');
    const draw = vi.fn();

    render(SignalFace, { props: { draw, w: 40, h: 12, staticMs: 400 } });

    expect(subscribeSpy).not.toHaveBeenCalled(); // no animation subscription
    expect(draw).toHaveBeenCalledTimes(1); // exactly one static frame
    expect(draw).toHaveBeenCalledWith(expect.any(Object), 400); // at the static time

    subscribeSpy.mockRestore();
  });
});

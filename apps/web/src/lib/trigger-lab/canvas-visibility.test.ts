// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
// The helpers call $state/$effect, so they only run inside a component — driven here through
// canvas-visibility.fixture.svelte (precedent: MasterDetail.fixture.svelte), which calls them at
// init exactly as EffectThumb and SignalFace do.
import Fixture from './canvas-visibility.fixture.svelte';

/** Captures the observer callback so a test can fire entries by hand, in a chosen order.
 *
 *  `fire` THROWS if the helper's $effect has not constructed the observer yet. That is
 *  deliberate: the effect runs after `render()` returns, so a fire issued too early would be
 *  silently dropped and every assertion after it would pass vacuously. Verified by mutation —
 *  with a lost first fire, removing the `hasBeenVisible` guard did not turn the pre-layout test
 *  red. Await `ready()` before firing. */
function stubIntersectionObserver(): {
  fire: (isIntersecting: boolean) => void;
  ready: () => boolean;
  disconnected: () => number;
} {
  let cb: IntersectionObserverCallback | undefined;
  let disconnects = 0;
  class Stub {
    constructor(callback: IntersectionObserverCallback) {
      cb = callback;
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {
      disconnects += 1;
    }
  }
  vi.stubGlobal('IntersectionObserver', Stub);
  return {
    fire: (isIntersecting: boolean) => {
      if (!cb) throw new Error('IntersectionObserver not constructed yet — await ready() before firing');
      cb([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver);
    },
    ready: () => cb !== undefined,
    disconnected: () => disconnects,
  };
}

function stubMatchMedia(matches: boolean): { change: (next: boolean) => void; removed: () => number } {
  let handler: (() => void) | undefined;
  let removals = 0;
  let current = matches;
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return current;
    },
    addEventListener: (_: string, h: () => void) => {
      handler = h;
    },
    removeEventListener: () => {
      removals += 1;
    },
  }));
  return {
    change: (next: boolean) => {
      current = next;
      handler?.();
    },
    removed: () => removals,
  };
}

/** Let Svelte flush its effects + DOM so a "value must NOT have changed" assertion is honest. */
async function settle(): Promise<void> {
  await tick();
  await new Promise((resolve) => setTimeout(resolve, 20));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('elementVisibility', () => {
  it('starts visible before the observer has said anything', () => {
    stubIntersectionObserver();
    const { getByTestId } = render(Fixture);
    expect(getByTestId('visible').textContent).toBe('true');
  });

  // THE PRE-LAYOUT TRAP. A portaled panel fires isIntersecting:false before layout; honouring it
  // would kill the ticker subscription of a preview that is about to be visible. This assertion
  // did not exist anywhere before — it is the whole reason `hasBeenVisible` is in the helper.
  it('IGNORES an isIntersecting:false that arrives before any true', async () => {
    const io = stubIntersectionObserver();
    const { getByTestId } = render(Fixture);
    await waitFor(() => expect(io.ready()).toBe(true));

    io.fire(false);
    // SETTLE, then assert ONCE. Not `waitFor(... 'true')`: the DOM updates asynchronously, so
    // waitFor would pass on its first pre-flush attempt and never observe a later flip to
    // 'false'. Proven by mutation — with waitFor here, deleting `hasBeenVisible` left this test
    // green. A "must not change" assertion has to look after the change would have landed.
    await settle();
    expect(getByTestId('visible').textContent).toBe('true');
  });

  it('honours an isIntersecting:false that arrives AFTER a true', async () => {
    const io = stubIntersectionObserver();
    const { getByTestId } = render(Fixture);
    await waitFor(() => expect(io.ready()).toBe(true));

    io.fire(true);
    await waitFor(() => expect(getByTestId('visible').textContent).toBe('true'));
    io.fire(false);
    await waitFor(() => expect(getByTestId('visible').textContent).toBe('false'));
  });

  it('comes back visible after going hidden', async () => {
    const io = stubIntersectionObserver();
    const { getByTestId } = render(Fixture);
    await waitFor(() => expect(io.ready()).toBe(true));

    io.fire(true);
    io.fire(false);
    await waitFor(() => expect(getByTestId('visible').textContent).toBe('false'));
    io.fire(true);
    await waitFor(() => expect(getByTestId('visible').textContent).toBe('true'));
  });

  it('disconnects the observer when the component unmounts', async () => {
    const io = stubIntersectionObserver();
    const { unmount } = render(Fixture);
    unmount();
    await waitFor(() => expect(io.disconnected()).toBeGreaterThan(0));
  });

  it('stays visible where IntersectionObserver does not exist', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const { getByTestId } = render(Fixture);
    expect(getByTestId('visible').textContent).toBe('true');
  });
});

describe('prefersReducedMotion', () => {
  it('seeds from the current media query value', async () => {
    stubIntersectionObserver();
    stubMatchMedia(true);
    const { getByTestId } = render(Fixture);
    await waitFor(() => expect(getByTestId('reduced').textContent).toBe('true'));
  });

  it('tracks a change made mid-session', async () => {
    stubIntersectionObserver();
    const mq = stubMatchMedia(false);
    const { getByTestId } = render(Fixture);
    await waitFor(() => expect(getByTestId('reduced').textContent).toBe('false'));

    mq.change(true);
    await waitFor(() => expect(getByTestId('reduced').textContent).toBe('true'));
  });

  it('drops its listener when the component unmounts', async () => {
    stubIntersectionObserver();
    const mq = stubMatchMedia(false);
    const { unmount } = render(Fixture);
    unmount();
    await waitFor(() => expect(mq.removed()).toBeGreaterThan(0));
  });

  it('reports no preference where matchMedia does not exist', () => {
    stubIntersectionObserver();
    vi.stubGlobal('matchMedia', undefined);
    const { getByTestId } = render(Fixture);
    expect(getByTestId('reduced').textContent).toBe('false');
  });
});

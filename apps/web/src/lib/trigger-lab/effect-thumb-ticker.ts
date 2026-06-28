/**
 * Shared ticker for all EffectThumb instances.
 *
 * A module-level singleton that manages ONE requestAnimationFrame loop and broadcasts
 * the current time (via performance.now()) to all subscribed components.
 *
 * Benefits:
 * - ~40 thumbnails share a single rAF loop instead of 40 separate loops
 * - Subscribes can be gated by IntersectionObserver (pause offscreen thumbs)
 * - Subscribes can respect prefers-reduced-motion (static frame, no animation)
 *
 * API:
 *   const unsub = ticker.subscribe((tMs: number) => { draw })
 *   unsub() unsubscribe
 */

type Callback = (tMs: number) => void;

interface Ticker {
  subscribe(cb: Callback): () => void;
}

let subscribers: Set<Callback> = new Set();
let rafId: number | null = null;

function tick() {
  const now = performance.now();

  subscribers.forEach((cb) => {
    cb(now);
  });

  if (subscribers.size > 0) {
    rafId = requestAnimationFrame(tick);
  } else {
    rafId = null;
  }
}

export const ticker: Ticker = {
  subscribe(cb: Callback): () => void {
    subscribers.add(cb);

    if (subscribers.size === 1) {
      rafId = requestAnimationFrame(tick);
    }

    return () => {
      subscribers.delete(cb);

      if (subscribers.size === 0 && rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };
  },
};

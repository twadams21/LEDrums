import { describe, expect, it } from 'vitest';
import { StatusLatch } from './status-latch';

interface S {
  state: string;
  code?: string;
  error?: string;
}

/** Fake clock: every test here is fully deterministic — no wall time anywhere. */
function clock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

describe('StatusLatch', () => {
  it('emits the first status immediately — a bind failure is never delayed', () => {
    const c = clock();
    const latch = new StatusLatch<S>({ now: c.now });
    const seen: S[] = [];
    latch.subscribe((s) => seen.push(s));
    latch.set({ state: 'error', code: 'EADDRNOTAVAIL' });
    expect(seen).toEqual([{ state: 'error', code: 'EADDRNOTAVAIL' }]);
  });

  it('dedupes on (state, code), never the message: 1000 same-key sets with differing errors emit once', () => {
    const c = clock();
    const latch = new StatusLatch<S>({ now: c.now });
    let emits = 0;
    latch.subscribe(() => emits++);
    for (let i = 0; i < 1000; i++) {
      latch.set({ state: 'error', code: 'EPERM', error: `message variant ${i}` });
      c.advance(2000); // even with the floor long elapsed, an unchanged key never re-emits
    }
    expect(emits).toBe(1);
  });

  it('an error/ready flap cannot defeat the floor: 1000 alternating sets inside one fake second emit exactly once', () => {
    const c = clock();
    const latch = new StatusLatch<S>({ now: c.now });
    let emits = 0;
    latch.subscribe(() => emits++);
    // The flap attack: alternating keys reset a latch-based limiter; the time floor
    // is unconditional, so within one second only the first set may emit.
    for (let i = 0; i < 1000; i++) {
      latch.set(i % 2 === 0 ? { state: 'error', code: 'EHOSTUNREACH' } : { state: 'ready' });
      c.advance(0.999); // ~44Hz-and-faster flapping, all inside the 1000ms floor
    }
    expect(emits).toBe(1);
  });

  it('replays the latched status exactly once to a subscriber attaching after the fact', () => {
    const latch = new StatusLatch<S>({ now: clock().now });
    latch.set({ state: 'ready' });
    const seen: S[] = [];
    latch.subscribe((s) => seen.push(s));
    expect(seen).toEqual([{ state: 'ready' }]);
  });

  it('a throwing handler escapes neither set() nor subscribe(), and the remaining handlers still run', () => {
    const latch = new StatusLatch<S>({ now: clock().now });
    const seen: S[] = [];
    latch.subscribe(() => {
      throw new Error('bad subscriber');
    });
    latch.subscribe((s) => seen.push(s));
    expect(() => latch.set({ state: 'error', code: 'X' })).not.toThrow();
    expect(seen).toEqual([{ state: 'error', code: 'X' }]);
    expect(() =>
      latch.subscribe(() => {
        throw new Error('bad late subscriber');
      }),
    ).not.toThrow();
  });

  it('a change suppressed by the floor is emitted by the next set once the interval elapses', () => {
    const c = clock();
    const latch = new StatusLatch<S>({ now: c.now });
    const seen: S[] = [];
    latch.subscribe((s) => seen.push(s));
    latch.set({ state: 'error', code: 'EPERM' }); // emits (first)
    c.advance(500);
    latch.set({ state: 'ready' }); // suppressed by the floor
    expect(seen).toHaveLength(1);
    c.advance(600); // floor elapsed
    latch.set({ state: 'ready' }); // key differs from last EMITTED key -> emits now
    expect(seen).toEqual([{ state: 'error', code: 'EPERM' }, { state: 'ready' }]);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { guardFlowCallback } from './flow-guard';

describe('guardFlowCallback — xyflow callback error boundary (incident 09)', () => {
  it('passes arguments through and does not call onFault when the callback succeeds', () => {
    const fn = vi.fn();
    const onFault = vi.fn();
    const wrapped = guardFlowCallback('connect', fn, onFault);

    wrapped('a', 2, { source: 'x' });

    expect(fn).toHaveBeenCalledWith('a', 2, { source: 'x' });
    expect(onFault).not.toHaveBeenCalled();
  });

  it('catches a throw and routes it to onFault (where + error) instead of propagating', () => {
    const boom = new Error('kaboom');
    const onFault = vi.fn();
    const wrapped = guardFlowCallback('reconnect', () => {
      throw boom;
    }, onFault);

    expect(() => wrapped()).not.toThrow();
    expect(onFault).toHaveBeenCalledTimes(1);
    expect(onFault).toHaveBeenCalledWith('reconnect', boom);
  });

  it('routes non-Error throws too (a string, an object)', () => {
    const onFault = vi.fn();
    guardFlowCallback('drag', () => {
      throw 'raw string';
    }, onFault)();
    guardFlowCallback('delete', () => {
      throw { code: 500 };
    }, onFault)();

    expect(onFault).toHaveBeenNthCalledWith(1, 'drag', 'raw string');
    expect(onFault).toHaveBeenNthCalledWith(2, 'delete', { code: 500 });
  });

  it('isolates each invocation — a throw on one call never blocks a later successful call', () => {
    const onFault = vi.fn();
    let calls = 0;
    const wrapped = guardFlowCallback('connect', () => {
      calls++;
      if (calls === 1) throw new Error('first only');
    }, onFault);

    wrapped(); // throws → caught
    wrapped(); // succeeds

    expect(calls).toBe(2);
    expect(onFault).toHaveBeenCalledTimes(1);
  });
});

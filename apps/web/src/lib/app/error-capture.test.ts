import { describe, expect, it, vi } from 'vitest';
import { installErrorCapture, type WebErrorReport } from './error-capture';

/** A minimal fake `window` that records listeners and lets a test fire synthetic events. */
function fakeWindow() {
  const listeners = new Map<string, Set<EventListener>>();
  return {
    addEventListener(type: string, cb: EventListener): void {
      (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(cb);
    },
    removeEventListener(type: string, cb: EventListener): void {
      listeners.get(type)?.delete(cb);
    },
    fire(type: string, event: unknown): void {
      for (const cb of listeners.get(type) ?? []) cb(event as Event);
    },
    count(type: string): number {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

function harness() {
  const win = fakeWindow();
  const original = vi.fn();
  const con = { error: original as unknown as Console['error'] };
  const reports: WebErrorReport[] = [];
  const uninstall = installErrorCapture((r) => reports.push(r), { windowRef: win, consoleRef: con });
  return { win, con, original, reports, uninstall };
}

describe('installErrorCapture (#122)', () => {
  it('captures an uncaught window error with message + stack', () => {
    const { win, reports } = harness();
    const err = new Error('boom');
    win.fire('error', { error: err, message: 'boom' });
    expect(reports).toEqual([{ origin: 'window.onerror', message: 'boom', stack: err.stack }]);
  });

  it('falls back to event.message when no Error object is present', () => {
    const { win, reports } = harness();
    win.fire('error', { error: null, message: 'Script error.' });
    expect(reports[0]).toMatchObject({ origin: 'window.onerror', message: 'Script error.' });
    expect(reports[0]!.stack).toBeUndefined();
  });

  it('captures an unhandled promise rejection', () => {
    const { win, reports } = harness();
    const reason = new Error('rejected');
    win.fire('unhandledrejection', { reason });
    expect(reports[0]).toMatchObject({ origin: 'unhandledrejection', message: 'rejected', stack: reason.stack });
  });

  it('captures a non-Error rejection reason', () => {
    const { win, reports } = harness();
    win.fire('unhandledrejection', { reason: 'nope' });
    expect(reports[0]).toEqual({ origin: 'unhandledrejection', message: 'nope', stack: undefined });
  });

  it('taps console.error, ALWAYS calling through to the original, then forwarding', () => {
    const { con, original, reports } = harness();
    con.error('a failure', 42);
    expect(original).toHaveBeenCalledWith('a failure', 42);
    expect(reports[0]).toMatchObject({ origin: 'console.error', message: 'a failure 42' });
  });

  it('lifts a stack off an Error argument to console.error', () => {
    const { con, reports } = harness();
    const err = new Error('logged');
    con.error('context', err);
    expect(reports[0]!.stack).toBe(err.stack);
  });

  it('a throwing sink never propagates into the calling code path', () => {
    const win = fakeWindow();
    const uninstall = installErrorCapture(
      () => {
        throw new Error('sink blew up');
      },
      { windowRef: win, consoleRef: { error: vi.fn() as unknown as Console['error'] } },
    );
    expect(() => win.fire('error', { error: new Error('x'), message: 'x' })).not.toThrow();
    uninstall();
  });

  it('does not recurse when the sink itself calls console.error', () => {
    const win = fakeWindow();
    const original = vi.fn();
    const con = { error: original as unknown as Console['error'] };
    let sinkCalls = 0;
    const uninstall = installErrorCapture(
      () => {
        sinkCalls++;
        con.error('sink logging'); // would re-enter the tap without the re-entry guard
      },
      { windowRef: win, consoleRef: con },
    );
    con.error('trigger');
    expect(sinkCalls).toBe(1); // exactly one forward — no capture→log→capture loop
    uninstall();
  });

  it('uninstall removes listeners and restores the original console.error', () => {
    const { win, con, original, reports, uninstall } = harness();
    uninstall();
    expect(win.count('error')).toBe(0);
    expect(win.count('unhandledrejection')).toBe(0);
    con.error('after uninstall');
    expect(original).toHaveBeenCalledWith('after uninstall');
    expect(reports).toHaveLength(0);
  });
});

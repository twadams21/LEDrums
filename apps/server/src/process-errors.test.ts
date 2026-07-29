import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { installProcessErrorCapture } from './process-errors';

describe('installProcessErrorCapture (#122)', () => {
  function harness() {
    const proc = new EventEmitter();
    const monitor = vi.fn();
    const exit = vi.fn();
    const log = vi.fn();
    const onFatal = vi.fn();
    const uninstall = installProcessErrorCapture({ monitor, exit, log, onFatal, proc });
    return { proc, monitor, exit, log, onFatal, uninstall };
  }

  it('reports an uncaughtException as an error event, runs onFatal, then exits non-zero', () => {
    const { proc, monitor, exit, onFatal } = harness();
    proc.emit('uncaughtException', new Error('kaboom'));
    expect(monitor).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        source: 'server',
        destination: 'uncaughtException',
        label: 'kaboom',
      }),
    );
    // onFatal (the synchronous queue flush) runs BEFORE the process dies.
    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(onFatal.mock.invocationCallOrder[0]!).toBeLessThan(exit.mock.invocationCallOrder[0]!);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('reports an unhandledRejection but does NOT exit (non-fatal — the show keeps running)', () => {
    const { proc, monitor, exit, onFatal } = harness();
    proc.emit('unhandledRejection', new Error('later'));
    expect(monitor).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', destination: 'unhandledRejection', label: 'later' }),
    );
    expect(exit).not.toHaveBeenCalled();
    expect(onFatal).not.toHaveBeenCalled();
  });

  it('an onFatal that throws never masks the exit', () => {
    const proc = new EventEmitter();
    const exit = vi.fn();
    const uninstall = installProcessErrorCapture({
      monitor: vi.fn(),
      exit,
      log: vi.fn(),
      onFatal: () => {
        throw new Error('flush failed');
      },
      proc,
    });
    proc.emit('uncaughtException', new Error('kaboom'));
    expect(exit).toHaveBeenCalledWith(1);
    uninstall();
  });

  it('with drainMs, onFatal runs synchronously but exit(1) is deferred by exactly the drain window', () => {
    vi.useFakeTimers();
    try {
      const proc = new EventEmitter();
      const exit = vi.fn();
      const onFatal = vi.fn();
      installProcessErrorCapture({ monitor: vi.fn(), exit, log: vi.fn(), onFatal, proc, drainMs: 100 });
      proc.emit('uncaughtException', new Error('kaboom'));
      // The fatal callback (darken + flush) ran inline; the exit did NOT.
      expect(onFatal).toHaveBeenCalledTimes(1);
      expect(exit).not.toHaveBeenCalled();
      vi.advanceTimersByTime(99);
      expect(exit).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(exit).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('handles non-Error rejection values', () => {
    const { proc, monitor } = harness();
    proc.emit('unhandledRejection', 'a plain string reason');
    expect(monitor).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'a plain string reason' }),
    );
  });

  it('uninstall removes both listeners', () => {
    const { proc, monitor, uninstall } = harness();
    uninstall();
    proc.emit('uncaughtException', new Error('after uninstall'));
    proc.emit('unhandledRejection', new Error('after uninstall'));
    expect(monitor).not.toHaveBeenCalled();
  });
});

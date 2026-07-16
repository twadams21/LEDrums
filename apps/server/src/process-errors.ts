import type { MonitorDraft } from './monitor';

/**
 * Server process fault capture (observability #122).
 *
 * Taps `uncaughtException` and `unhandledRejection` and re-emits each onto the Monitor bus as an
 * `error` event — the same single fault stream the web-error capture and the server's existing
 * error emitters feed, so the Reporter picks all of them up uniformly.
 *
 * `unhandledRejection` is logged + reported but NOT fatal (Node's default is a warning; the show
 * keeps running). `uncaughtException` leaves the process in an undefined state, so after reporting
 * we run `onFatal` (e.g. a synchronous Reporter flush so the crash report reaches disk) and exit
 * non-zero — preserving crash semantics while still capturing the fault. Everything is injected
 * (process emitter, exit, clock-free) so it is unit-testable without killing the test runner.
 */
export interface ProcessErrorDeps {
  /** Append an event to the Monitor bus. */
  monitor: (event: MonitorDraft) => void;
  /** Run after reporting an `uncaughtException`, before exit — e.g. persist the queue synchronously. */
  onFatal?: () => void;
  /** The emitter to tap; defaults to the real `process`. Injected in tests. */
  proc?: NodeJS.EventEmitter;
  /** Terminate after a fatal fault; defaults to `process.exit`. Injected in tests. */
  exit?: (code: number) => void;
  /** Local-only logger; defaults to `console.error`. */
  log?: (message: string) => void;
}

function faultDetail(value: unknown): { message: string; stack?: string } {
  if (value instanceof Error) {
    return { message: value.message || value.name || 'Error', stack: value.stack };
  }
  return { message: typeof value === 'string' ? value : String(value) };
}

/** Install the process-fault taps. Returns an idempotent uninstall that removes both listeners. */
export function installProcessErrorCapture(deps: ProcessErrorDeps): () => void {
  const proc = deps.proc ?? process;
  const exit = deps.exit ?? ((code: number): void => process.exit(code));
  const log = deps.log ?? ((message: string): void => console.error(message));

  const onUncaught = (err: unknown): void => {
    const { message, stack } = faultDetail(err);
    deps.monitor({
      type: 'error',
      direction: 'local',
      source: 'server',
      destination: 'uncaughtException',
      label: message,
      detail: stack,
    });
    log(`[process] uncaught exception: ${message}`);
    try {
      deps.onFatal?.();
    } catch {
      /* never let cleanup mask the exit */
    }
    exit(1);
  };

  const onRejection = (reason: unknown): void => {
    const { message, stack } = faultDetail(reason);
    deps.monitor({
      type: 'error',
      direction: 'local',
      source: 'server',
      destination: 'unhandledRejection',
      label: message,
      detail: stack,
    });
    log(`[process] unhandled rejection: ${message}`);
  };

  proc.on('uncaughtException', onUncaught);
  proc.on('unhandledRejection', onRejection);

  let uninstalled = false;
  return (): void => {
    if (uninstalled) return;
    uninstalled = true;
    proc.off('uncaughtException', onUncaught);
    proc.off('unhandledRejection', onRejection);
  };
}

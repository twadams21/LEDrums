/**
 * Global web-error capture (observability #122).
 *
 * Installs three taps on the browser environment and forwards every error-shaped event to a sink
 * (in practice `store.client.send({ t: 'webError', … })`, which rides the socket the app already
 * holds):
 *
 *  - `window.onerror` (uncaught synchronous errors) via an `'error'` listener,
 *  - `unhandledrejection` (rejected promises with no `.catch`),
 *  - a `console.error` monkey-patch (defensive logging + framework warnings — Svelte, xyflow).
 *
 * The capture is pure over its environment (window + console are injected) so it is unit-testable
 * with fakes, and fully fire-and-forget: a throw inside the sink is swallowed, and the patched
 * `console.error` ALWAYS calls the original first, so console output is never lost and a fault in
 * forwarding can never suppress or recurse into the very logging it taps. {@link installErrorCapture}
 * returns an idempotent uninstall that removes both listeners and restores the original `console.error`.
 */

export type WebErrorOrigin = 'window.onerror' | 'unhandledrejection' | 'console.error';

export interface WebErrorReport {
  origin: WebErrorOrigin;
  message: string;
  stack?: string;
}

/** The forward sink — receives each captured fault. Must never throw back into the caller (guarded). */
export type WebErrorSink = (report: WebErrorReport) => void;

export interface ErrorCaptureEnv {
  /** Defaults to the global `window`; injected in tests. */
  windowRef?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  /** Defaults to the global `console`; injected in tests. */
  consoleRef?: Pick<Console, 'error'>;
}

/** Best-effort message from an unknown thrown/logged value. Never throws. */
function messageOf(value: unknown): string {
  if (value instanceof Error) return value.message || value.name || 'Error';
  if (typeof value === 'string') return value;
  try {
    return String(value);
  } catch {
    return 'Unknown error';
  }
}

/** Best-effort stack from an unknown thrown value. */
function stackOf(value: unknown): string | undefined {
  return value instanceof Error && typeof value.stack === 'string' ? value.stack : undefined;
}

/** Join the arguments of a `console.error(...args)` call into one message string. */
function consoleArgsMessage(args: unknown[]): string {
  return args.map(messageOf).join(' ');
}

/**
 * Install the three error taps. Returns an idempotent uninstall fn. Safe to call in a non-DOM
 * environment: if no `window` is available (SSR / a headless test without a global window) the
 * listener taps are skipped, but the `console.error` tap still installs when a console exists.
 */
export function installErrorCapture(sink: WebErrorSink, env: ErrorCaptureEnv = {}): () => void {
  const win =
    env.windowRef ?? (typeof window !== 'undefined' ? window : undefined);
  const con = env.consoleRef ?? (typeof console !== 'undefined' ? console : undefined);

  // Guard the sink so a fault in forwarding never propagates into the throwing code path, and never
  // re-enters console.error (which we tap) to avoid a capture→log→capture loop.
  let inSink = false;
  const forward = (report: WebErrorReport): void => {
    if (inSink) return;
    inSink = true;
    try {
      sink(report);
    } catch {
      /* fire-and-forget: reporting must never affect the app */
    } finally {
      inSink = false;
    }
  };

  const onError = (event: ErrorEvent): void => {
    // Prefer the thrown value's message; fall back to the event's own `message` (e.g. a cross-origin
    // "Script error." with no error object attached).
    forward({
      origin: 'window.onerror',
      message: event.error != null ? messageOf(event.error) : event.message || 'Uncaught error',
      stack: stackOf(event.error),
    });
  };

  const onRejection = (event: PromiseRejectionEvent): void => {
    forward({
      origin: 'unhandledrejection',
      message: messageOf(event.reason),
      stack: stackOf(event.reason),
    });
  };

  win?.addEventListener('error', onError as EventListener);
  win?.addEventListener('unhandledrejection', onRejection as EventListener);

  // console.error tap — always call through to the original so nothing is lost, then forward.
  const originalError = con?.error.bind(con);
  if (con && originalError) {
    con.error = (...args: unknown[]): void => {
      originalError(...args);
      const stack =
        args.map(stackOf).find((s): s is string => s !== undefined);
      forward({ origin: 'console.error', message: consoleArgsMessage(args), stack });
    };
  }

  let uninstalled = false;
  return (): void => {
    if (uninstalled) return;
    uninstalled = true;
    win?.removeEventListener('error', onError as EventListener);
    win?.removeEventListener('unhandledrejection', onRejection as EventListener);
    if (con && originalError) con.error = originalError;
  };
}

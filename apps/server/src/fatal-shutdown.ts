/**
 * Fatal-path shutdown policy (resilience-hole-0001, INIT-04 S3).
 *
 * On an uncaught exception the process is about to die; the one thing that must
 * not survive it is a lit rig. The handler darkens FIRST (rig before telemetry —
 * process-errors wraps the whole callback in one try/catch, so a throwing flush
 * must never abort the blackout), then flushes the report queues. Each step is
 * isolated in its own try/catch: a fault in either never prevents the other and
 * never rethrows into the process-error handler.
 *
 * `darken` must NOT close the output transport: packages/io sends datagrams
 * asynchronously, and closing the socket before they flush discards the very
 * blackout this exists to send. The bounded exit drain lives in process-errors
 * (`drainMs`), not here.
 */
export interface FatalHandlerDeps {
  /** Stop the render loop and send the blackout frame (without closing the transport). */
  darken: () => void;
  /** Synchronously persist the telemetry/backup queues to disk. */
  flushReports: () => void;
  /** Local-only logger; defaults to `console.error`. */
  log?: (message: string) => void;
}

/** Build the `onFatal` callback main.ts hands to `installProcessErrorCapture`. */
export function createFatalHandler(deps: FatalHandlerDeps): () => void {
  const log = deps.log ?? ((message: string): void => console.error(message));
  return (): void => {
    try {
      deps.darken();
    } catch (err) {
      log(`[fatal] darken failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      deps.flushReports();
    } catch (err) {
      log(`[fatal] report flush failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
}

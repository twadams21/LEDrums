/** WS close code for an evicted client (4000–4999 is the application private-use range). */
export const SUPERSEDED_CODE = 4000;
export const SUPERSEDED_REASON = 'superseded by a new connection';

/** Minimal socket surface the lock needs — just a graceful close. Keeps the lock
 * decoupled from `ws` so it is trivially unit-testable. */
export interface CloseableSocket {
  close(code?: number, reason?: string): void;
}

/**
 * Single-client lock with a **newest-wins** policy: only one live socket is ever held.
 * Admitting a new socket cleanly closes the previous one (a clear close code/reason), so
 * a reconnect after a crash replaces the dead socket instead of wedging on a stale one.
 *
 * The engine/output loop is intentionally NOT referenced here — transmission is driven by
 * the host's own timer and keeps running regardless of how many clients are connected
 * (including zero). The lock only governs which socket receives broadcasts.
 *
 * Iterable so it drops into the existing `for (const ws of clients)` broadcast loops.
 */
export class SingleClientLock<S extends CloseableSocket> {
  private current: S | null = null;

  /** Admit `socket` as the live client, evicting any previous one. Returns the evicted
   * socket (or `null` if there was none / it was already this socket). */
  admit(socket: S): S | null {
    const prev = this.current;
    this.current = socket;
    if (prev && prev !== socket) {
      try {
        prev.close(SUPERSEDED_CODE, SUPERSEDED_REASON);
      } catch {
        // Socket already closing/closed — eviction is a no-op.
      }
      return prev;
    }
    return null;
  }

  /** Drop `socket` if it is the live one (its `close`/`error`). A stale socket whose slot
   * was already taken by a newer connection is ignored, so eviction never clears the new
   * client. */
  remove(socket: S): void {
    if (this.current === socket) this.current = null;
  }

  /** The live client, or `null`. */
  get(): S | null {
    return this.current;
  }

  /** 0 or 1 — the lock holds at most one client. */
  get size(): number {
    return this.current ? 1 : 0;
  }

  *[Symbol.iterator](): Iterator<S> {
    if (this.current) yield this.current;
  }
}

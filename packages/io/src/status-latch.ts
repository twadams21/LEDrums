/**
 * Package-private status latch shared by ArtNetOutput and SacnOutput — the pure
 * (no socket, no dgram, no IO) half of the transport-status seam. Deliberately NOT
 * exported from the package barrel: an implementation detail with two internal callers.
 *
 * Contract:
 * - `set` always updates the latched value; a subscriber attaching later is replayed
 *   the latched status immediately (latch-and-replay, mirroring OscInput's pattern).
 * - Emission is deduped on the (state, code) pair — never on the message string,
 *   which dgram varies freely — and rate-floored to at most one emit per
 *   `minIntervalMs`, on an unconditional time floor so an error/ready flap cannot
 *   reset it. The first status of any kind emits immediately: a bind failure is
 *   never delayed.
 * - A change suppressed by the floor is emitted by the next `set` once the interval
 *   has elapsed. Handlers run inside try/catch; a throwing subscriber cannot escape.
 */
export class StatusLatch<T extends { state: string; code?: string }> {
  private readonly now: () => number;
  private readonly minIntervalMs: number;
  private readonly handlers: Array<(s: T) => void> = [];
  private latchedValue: T | null = null;
  private lastEmittedKey: string | null = null;
  private lastEmitMs = -Infinity;

  constructor(opts?: { now?: () => number; minIntervalMs?: number }) {
    this.now = opts?.now ?? Date.now;
    this.minIntervalMs = opts?.minIntervalMs ?? 1000;
  }

  get latched(): T | null {
    return this.latchedValue;
  }

  subscribe(h: (s: T) => void): void {
    this.handlers.push(h);
    if (this.latchedValue !== null) {
      try {
        h(this.latchedValue);
      } catch {
        /* a throwing subscriber must not escape */
      }
    }
  }

  set(status: T): void {
    this.latchedValue = status;
    const key = `${status.state}|${status.code ?? ''}`;
    const t = this.now();
    if (key === this.lastEmittedKey || t - this.lastEmitMs < this.minIntervalMs) return;
    this.lastEmittedKey = key;
    this.lastEmitMs = t;
    for (const h of this.handlers) {
      try {
        h(status);
      } catch {
        /* a throwing subscriber must not escape */
      }
    }
  }
}

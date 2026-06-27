/** Save-status state machine — the timing logic behind the TopBar "Saving… → Saved"
    indicator, kept pure so it can be unit-tested without the DOM or Svelte runes.

    The store drives it with two events: `saving()` when an autosave is scheduled/in
    flight, and `saved()` when that write actually flushes (localStorage cache + server
    write). The controller turns those into a visible status with two guarantees:

      1. **A minimum visible 'saving' window** ({@link MIN_SAVING_MS}). Even when the
         flush is effectively instant, 'saving' stays on screen long enough to be
         perceived — the feedback must read as real, not a blip.
      2. **A brief 'saved' hold** ({@link SAVED_HOLD_MS}) before settling back to 'idle',
         so the confirmation is legible before it fades.

    All wall-clock access (now / timers) is injected via {@link SaveStatusClock} so tests
    drive a deterministic fake clock; the default uses real `Date.now`/`setTimeout`. */

export type SaveStatus = 'idle' | 'saving' | 'saved';

/** Minimum time 'saving' stays visible once shown, even if the write finished sooner. */
export const MIN_SAVING_MS = 150;
/** How long 'saved' lingers before returning to 'idle'. */
export const SAVED_HOLD_MS = 1000;

/** The wall-clock + timer surface the controller depends on — injected so tests can
    run it against a deterministic fake. */
export interface SaveStatusClock {
  now(): number;
  setTimer(cb: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

const realClock: SaveStatusClock = {
  now: () => Date.now(),
  setTimer: (cb, ms) => setTimeout(cb, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface SaveStatusOptions {
  clock?: SaveStatusClock;
  minSavingMs?: number;
  savedHoldMs?: number;
}

export class SaveStatusController {
  private _status: SaveStatus = 'idle';
  /** When the current 'saving' window started (clock time), to enforce the floor. */
  private startedAt = 0;
  /** The single pending transition timer (deferred-saved OR saved→idle hold). */
  private timer: unknown = null;
  /** True while a flush has arrived but we're holding 'saving' to honour the floor. */
  private settling = false;

  private readonly clock: SaveStatusClock;
  private readonly minSavingMs: number;
  private readonly savedHoldMs: number;

  constructor(
    private readonly onChange: (status: SaveStatus) => void,
    options: SaveStatusOptions = {},
  ) {
    this.clock = options.clock ?? realClock;
    this.minSavingMs = options.minSavingMs ?? MIN_SAVING_MS;
    this.savedHoldMs = options.savedHoldMs ?? SAVED_HOLD_MS;
  }

  get status(): SaveStatus {
    return this._status;
  }

  /** An autosave was scheduled / is in flight. Enters 'saving' (starting the min-visible
      window) and supersedes any pending settle/hold from a prior cycle — so a fresh edit
      during the 'saved' hold or the floor wait correctly returns to 'saving'. Repeated
      calls while already 'saving' are no-ops (the window keeps running from its start). */
  saving(): void {
    this.clearTimer();
    this.settling = false;
    if (this._status !== 'saving') {
      this.startedAt = this.clock.now();
      this.setStatus('saving');
    }
  }

  /** The scheduled write flushed. Transitions to 'saved' — but never before 'saving' has
      been visible for at least {@link minSavingMs}; if the floor isn't met yet, the
      transition is deferred until it is. A flush that arrives outside an active 'saving'
      window (e.g. the initial mount save, or a duplicate flush) is ignored. */
  saved(): void {
    if (this._status !== 'saving' || this.settling) return;
    const remaining = this.minSavingMs - (this.clock.now() - this.startedAt);
    if (remaining <= 0) {
      this.enterSaved();
      return;
    }
    this.settling = true;
    this.timer = this.clock.setTimer(() => {
      this.timer = null;
      this.settling = false;
      this.enterSaved();
    }, remaining);
  }

  /** Cancel any pending transition (on teardown). Leaves the visible status untouched. */
  dispose(): void {
    this.clearTimer();
    this.settling = false;
  }

  private enterSaved(): void {
    this.clearTimer();
    this.setStatus('saved');
    this.timer = this.clock.setTimer(() => {
      this.timer = null;
      this.setStatus('idle');
    }, this.savedHoldMs);
  }

  private setStatus(next: SaveStatus): void {
    if (this._status === next) return;
    this._status = next;
    this.onChange(next);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.clock.clearTimer(this.timer);
      this.timer = null;
    }
  }
}

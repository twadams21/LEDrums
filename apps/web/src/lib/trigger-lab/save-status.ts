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

    A third event, `failed()`, breaks both guarantees ON PURPOSE — see below. All wall-clock
    access (now / timers) is injected via {@link SaveStatusClock} so tests drive a deterministic
    fake clock; the default uses real `Date.now`/`setTimeout`. */

/** `'error'` is the honest state: the write did NOT land. It is not a phase of a save cycle —
    it is a condition that persists until a later save actually succeeds. */
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

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

  /** Why the last write failed — the text the indicator's tooltip names. Null unless 'error'. */
  private _error: string | null = null;

  constructor(
    private readonly onChange: (status: SaveStatus, error: string | null) => void,
    options: SaveStatusOptions = {},
  ) {
    this.clock = options.clock ?? realClock;
    this.minSavingMs = options.minSavingMs ?? MIN_SAVING_MS;
    this.savedHoldMs = options.savedHoldMs ?? SAVED_HOLD_MS;
  }

  get status(): SaveStatus {
    return this._status;
  }

  /** The reason behind an 'error' status, for the indicator's tooltip. Null in every other state. */
  get error(): string | null {
    return this._error;
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
    // A success arriving while the indicator is stuck on 'error' clears it — that is the ONLY
    // thing that does. There is no saving window to honour, so it lands immediately.
    if (this._status === 'error') {
      this.enterSaved();
      return;
    }
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

  /** The write did NOT land. Goes to 'error' IMMEDIATELY — the min-visible 'saving' floor exists
      to make success feel real, and there is nothing here to make feel real; a user who has lost
      bytes should not watch a reassuring spinner first. Unlike {@link saved} it does NOT
      auto-settle back to 'idle': the state is a standing condition, not a phase, and it stays on
      screen until a later `saved()` clears it. Any pending settle/hold from the cycle it
      interrupts is cancelled, so a deferred 'saved' cannot land on top of the failure. */
  failed(reason: string): void {
    this.clearTimer();
    this.settling = false;
    this._error = reason;
    this.setStatus('error', true); // re-announce even when already 'error': the reason may differ
  }

  /** Cancel any pending transition (on teardown). Leaves the visible status untouched. */
  dispose(): void {
    this.clearTimer();
    this.settling = false;
  }

  private enterSaved(): void {
    this.clearTimer();
    this.setStatus('saved'); // setStatus clears the error text on any non-error status
    this.timer = this.clock.setTimer(() => {
      this.timer = null;
      this.setStatus('idle');
    }, this.savedHoldMs);
  }

  private setStatus(next: SaveStatus, force = false): void {
    if (this._status === next && !force) return;
    if (next !== 'error') this._error = null;
    this._status = next;
    this.onChange(next, this._error);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.clock.clearTimer(this.timer);
      this.timer = null;
    }
  }
}

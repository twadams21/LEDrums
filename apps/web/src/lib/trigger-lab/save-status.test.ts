import { describe, expect, it } from 'vitest';
import {
  MIN_SAVING_MS,
  SAVED_HOLD_MS,
  SaveStatusController,
  type SaveStatus,
  type SaveStatusClock,
} from './save-status';

/** Deterministic fake clock: virtual time + an in-order timer queue, so the min-duration
    logic is tested as a pure timer with no real `setTimeout`/`Date` and no DOM. Timers
    scheduled from within a firing callback are picked up by the same `advance` pass. */
function makeClock(): { clock: SaveStatusClock; advance: (ms: number) => void } {
  let t = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; cb: () => void }>();
  const clock: SaveStatusClock = {
    now: () => t,
    setTimer: (cb, ms) => {
      const id = nextId++;
      timers.set(id, { at: t + ms, cb });
      return id;
    },
    clearTimer: (handle) => {
      timers.delete(handle as number);
    },
  };
  function advance(ms: number): void {
    const target = t + ms;
    for (;;) {
      let dueId: number | null = null;
      let dueAt = Infinity;
      for (const [id, timer] of timers) {
        if (timer.at <= target && timer.at < dueAt) {
          dueAt = timer.at;
          dueId = id;
        }
      }
      if (dueId === null) break;
      const timer = timers.get(dueId)!;
      timers.delete(dueId);
      t = timer.at;
      timer.cb();
    }
    t = target;
  }
  return { clock, advance };
}

/** Build a controller wired to a fresh fake clock, capturing the emitted status sequence. */
function setup() {
  const { clock, advance } = makeClock();
  const changes: SaveStatus[] = [];
  const ctl = new SaveStatusController((s) => changes.push(s), { clock });
  return { ctl, advance, changes };
}

describe('SaveStatusController', () => {
  it('starts idle and emits nothing', () => {
    const { ctl, changes } = setup();
    expect(ctl.status).toBe('idle');
    expect(changes).toEqual([]);
  });

  it('enters saving immediately when an autosave is scheduled', () => {
    const { ctl, changes } = setup();
    ctl.saving();
    expect(ctl.status).toBe('saving');
    expect(changes).toEqual(['saving']);
  });

  it('holds saving for the minimum window even when the flush is instant', () => {
    const { ctl, advance } = setup();
    ctl.saving();
    ctl.saved(); // flush arrives ~instantly (t=0)
    // Must still read 'saving' right up to the floor…
    advance(MIN_SAVING_MS - 1);
    expect(ctl.status).toBe('saving');
    // …and only flip to 'saved' once the floor is met.
    advance(1);
    expect(ctl.status).toBe('saved');
  });

  it('flips to saved at exactly the floor boundary', () => {
    const { ctl, advance, changes } = setup();
    ctl.saving();
    advance(MIN_SAVING_MS); // a slow-enough save: floor already satisfied
    ctl.saved();
    expect(ctl.status).toBe('saved');
    expect(changes).toEqual(['saving', 'saved']);
  });

  it('flips to saved immediately when the floor is already exceeded', () => {
    const { ctl, advance, changes } = setup();
    ctl.saving();
    advance(MIN_SAVING_MS + 50);
    ctl.saved();
    expect(ctl.status).toBe('saved');
    expect(changes).toEqual(['saving', 'saved']);
  });

  it('walks idle → saving → saved → idle, holding saved before settling', () => {
    const { ctl, advance, changes } = setup();
    ctl.saving();
    ctl.saved();
    advance(MIN_SAVING_MS); // reach 'saved'
    expect(ctl.status).toBe('saved');
    advance(SAVED_HOLD_MS - 1);
    expect(ctl.status).toBe('saved'); // still holding
    advance(1);
    expect(ctl.status).toBe('idle');
    expect(changes).toEqual(['saving', 'saved', 'idle']);
  });

  it('ignores a flush with no active saving window (mount / duplicate)', () => {
    const { ctl, changes } = setup();
    ctl.saved(); // e.g. the initial mount autosave, never shown
    expect(ctl.status).toBe('idle');
    expect(changes).toEqual([]);
  });

  it('keeps a single saving window across rapid re-schedules', () => {
    const { ctl, advance, changes } = setup();
    ctl.saving();
    advance(40);
    ctl.saving(); // continued editing — still one window
    advance(40);
    ctl.saving();
    expect(changes).toEqual(['saving']); // no flicker
    advance(200);
    ctl.saved();
    expect(ctl.status).toBe('saved');
  });

  it('returns to saving when an edit lands during the saved hold', () => {
    const { ctl, advance, changes } = setup();
    ctl.saving();
    ctl.saved();
    advance(MIN_SAVING_MS); // 'saved'
    expect(ctl.status).toBe('saved');
    advance(200); // mid-hold
    ctl.saving(); // a new edit
    expect(ctl.status).toBe('saving');
    expect(changes).toEqual(['saving', 'saved', 'saving']);
    // and the earlier saved→idle timer must not fire under us
    advance(SAVED_HOLD_MS);
    expect(ctl.status).toBe('saving');
  });

  it('supersedes a deferred saved when a new edit arrives during the floor wait', () => {
    const { ctl, advance, changes } = setup();
    ctl.saving();
    ctl.saved(); // deferred — floor not met
    advance(50);
    ctl.saving(); // new edit cancels the pending 'saved'
    advance(MIN_SAVING_MS); // the old deferred-saved timer must NOT fire
    expect(ctl.status).toBe('saving');
    expect(changes).toEqual(['saving']);
    ctl.saved();
    expect(ctl.status).toBe('saved');
  });

  it('cancels pending transitions on dispose', () => {
    const { ctl, advance, changes } = setup();
    ctl.saving();
    ctl.saved();
    ctl.dispose(); // tear down before the floor elapses
    advance(SAVED_HOLD_MS * 2);
    expect(ctl.status).toBe('saving'); // frozen — no further emissions
    expect(changes).toEqual(['saving']);
  });

  it('respects custom min/hold durations', () => {
    const { clock, advance } = makeClock();
    const changes: SaveStatus[] = [];
    const ctl = new SaveStatusController((s) => changes.push(s), {
      clock,
      minSavingMs: 80,
      savedHoldMs: 300,
    });
    ctl.saving();
    ctl.saved();
    advance(79);
    expect(ctl.status).toBe('saving');
    advance(1);
    expect(ctl.status).toBe('saved');
    advance(300);
    expect(ctl.status).toBe('idle');
  });
});

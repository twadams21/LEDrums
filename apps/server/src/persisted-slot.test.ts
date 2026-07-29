import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPersistedSlot } from './persisted-slot';
import type { MonitorDraft } from './monitor';

type Blob = { version: number; data: string };

interface Harness {
  monitored: MonitorDraft[];
  saved: Blob[];
  slot: ReturnType<typeof createPersistedSlot<Blob, { path: string; source: string }>>;
  failNext: (message: string) => void;
}

function harness(initial: Blob | null = null, label = 'Show library', destination = 'show-library'): Harness {
  const monitored: MonitorDraft[] = [];
  const saved: Blob[] = [];
  let failure: string | null = null;
  const slot = createPersistedSlot<Blob, { path: string; source: string }>({
    label,
    destination,
    inspect: () => ({ path: '/projects/show-library.json', source: 'file' }),
    load: () => initial,
    save: async (value) => {
      if (failure) {
        const message = failure;
        failure = null;
        throw new Error(message);
      }
      saved.push(value);
    },
    monitor: (event) => monitored.push(event),
    delayMs: 10,
  });
  return {
    monitored,
    saved,
    slot,
    failNext: (message) => {
      failure = message;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Let the debounce fire and the (async) write chain settle. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(20);
}

describe('createPersistedSlot — boot recovery', () => {
  it('seeds the live value from load() and exposes inspect() verbatim', () => {
    const h = harness({ version: 1, data: 'boot' });
    expect(h.slot.get()).toEqual({ version: 1, data: 'boot' });
    expect(h.slot.loadInfo).toEqual({ path: '/projects/show-library.json', source: 'file' });
  });

  it('is null when nothing was recovered', () => {
    expect(harness(null).slot.get()).toBeNull();
  });

  it('does not write or emit anything at construction', () => {
    const h = harness({ version: 1, data: 'boot' });
    expect(h.saved).toEqual([]);
    expect(h.monitored).toEqual([]);
  });
});

describe('createPersistedSlot — set()', () => {
  it('replaces the live value', () => {
    const h = harness(null);
    h.slot.set({ version: 2, data: 'pushed' });
    expect(h.slot.get()).toEqual({ version: 2, data: 'pushed' });
  });

  it('marks the autosaver dirty exactly once per call — one scheduled row per burst', async () => {
    const h = harness(null);
    h.slot.set({ version: 1, data: 'a' });
    h.slot.set({ version: 1, data: 'b' });
    h.slot.set({ version: 1, data: 'c' });
    // A burst debounces into ONE scheduled row and ONE write of the LAST value.
    expect(h.monitored.filter((e) => e.label === 'Show library autosave scheduled')).toHaveLength(1);
    await settle();
    expect(h.saved).toEqual([{ version: 1, data: 'c' }]);
    // A second burst after the write schedules again.
    h.slot.set({ version: 1, data: 'd' });
    expect(h.monitored.filter((e) => e.label === 'Show library autosave scheduled')).toHaveLength(2);
  });

  it('persists the value current at write time, not at set time', async () => {
    const h = harness(null);
    h.slot.set({ version: 1, data: 'stale' });
    h.slot.set({ version: 1, data: 'fresh' });
    await settle();
    expect(h.saved).toEqual([{ version: 1, data: 'fresh' }]);
  });
});

describe('createPersistedSlot — null slot', () => {
  it('save is a no-op and emits NO saved row', async () => {
    const h = harness({ version: 1, data: 'boot' });
    h.slot.set(null);
    await settle();
    expect(h.saved).toEqual([]);
    expect(h.monitored.map((e) => e.label)).toEqual(['Show library autosave scheduled']);
  });

  it('flush on a null slot writes nothing and emits no saved row', async () => {
    const h = harness(null);
    await h.slot.autosaver.flush();
    expect(h.saved).toEqual([]);
    expect(h.monitored).toEqual([]);
  });

  it('recovers once a real value is pushed after a null', async () => {
    const h = harness(null);
    h.slot.set(null);
    await settle();
    h.slot.set({ version: 3, data: 'later' });
    await settle();
    expect(h.saved).toEqual([{ version: 3, data: 'later' }]);
    expect(h.monitored.some((e) => e.label === 'Show library autosave saved')).toBe(true);
  });
});

describe('createPersistedSlot — monitor rows (wire-visible)', () => {
  it('pins the show-library scheduled + saved rows', async () => {
    const h = harness(null);
    h.slot.set({ version: 1, data: 'a' });
    await settle();
    expect(h.monitored).toEqual([
      { type: 'persistence', direction: 'local', source: 'server', destination: 'show-library', label: 'Show library autosave scheduled' },
      { type: 'persistence', direction: 'local', source: 'server', destination: 'show-library', label: 'Show library autosave saved' },
    ]);
  });

  it('pins the failed row as an error carrying the destination + detail', async () => {
    const h = harness(null);
    h.failNext('EACCES: permission denied');
    h.slot.set({ version: 1, data: 'a' });
    await settle();
    expect(h.monitored[1]).toEqual({
      type: 'error',
      direction: 'local',
      source: 'server/autosave',
      destination: 'show-library',
      label: 'Show library autosave failed',
      detail: 'EACCES: permission denied',
    });
    // A failed write leaves the slot dirty, so the next flush retries.
    await h.slot.autosaver.flush();
    expect(h.saved).toEqual([{ version: 1, data: 'a' }]);
  });

  it('pins the song-library rows off the same primitive', async () => {
    const h = harness(null, 'Song library', 'song-library');
    h.slot.set({ version: 1, data: 'a' });
    await settle();
    expect(h.monitored).toEqual([
      { type: 'persistence', direction: 'local', source: 'server', destination: 'song-library', label: 'Song library autosave scheduled' },
      { type: 'persistence', direction: 'local', source: 'server', destination: 'song-library', label: 'Song library autosave saved' },
    ]);
  });
});

import { createAutosaver, type Autosaver } from './autosave';
import type { MonitorDraft } from './monitor';

/** Default autosave debounce for a persisted slot — the same 400ms the libraries have always used. */
const DEFAULT_DELAY_MS = 400;

/**
 * One server-authoritative, file-persisted value: boot-recovered on construction,
 * replaced by client pushes, debounce-autosaved, flushed on shutdown.
 */
export interface PersistedSlot<T, Info> {
  /** The live value, or `null` when nothing has been recovered or pushed yet. */
  get(): T | null;
  /** Replace the live value and schedule a debounced save. */
  set(value: T | null): void;
  /** The slot's autosaver — flushed on clean shutdown. */
  readonly autosaver: Autosaver;
  /** Whatever the slot's `inspect` reported at boot (path + load source), for the diagnostics surface. */
  readonly loadInfo: Info;
}

export interface PersistedSlotDeps<T, Info> {
  /**
   * Human label, sentence-cased and singular — e.g. `'Show library'`. The Monitor rows the
   * drummer sees are `` `${label} autosave scheduled|saved|failed` ``, so this string is
   * wire-visible: changing it changes the Monitor panel.
   */
  label: string;
  /** Monitor `destination` tag for this slot's rows — e.g. `'show-library'`. Also wire-visible. */
  destination: string;
  /** Boot recovery: the seed value (already resolved from snapshot bundle / file / nothing). */
  load: () => T | null;
  /** Boot inspection: path + load source, surfaced verbatim as {@link PersistedSlot.loadInfo}. */
  inspect: () => Info;
  /** Persist a non-null value. Never called for a null slot. */
  save: (value: T) => Promise<void>;
  /** Monitor sink (main.ts's `monitor`, which also feeds the error Reporter). */
  monitor: (event: MonitorDraft) => void;
  delayMs?: number;
}

/**
 * Build a {@link PersistedSlot}.
 *
 * This collapses what used to be five separate main.ts edits per persisted value (loader,
 * live `let`, autosaver plus its three near-identical monitor hooks, state field, shutdown
 * flush) into a single registration. The save sink reads the CURRENT value at call time, so
 * the latest push is what lands on disk; a null slot's save is a no-op that emits no `saved`
 * event — exactly the previous `live ? saveAsync(live) : Promise.resolve()` behaviour.
 *
 * Only opaque blob slots belong here. A value whose live copy is engine state (the project,
 * mutated in place by the voice host) must NOT be a slot: a slot-owned get/set would either
 * become a second source of truth or a lying accessor.
 */
export function createPersistedSlot<T, Info>(deps: PersistedSlotDeps<T, Info>): PersistedSlot<T, Info> {
  const { label, destination, load, inspect, save, monitor, delayMs = DEFAULT_DELAY_MS } = deps;

  const loadInfo = inspect();
  let value = load();

  // `wrote` gates the `saved` row: a null slot's sink writes nothing, so claiming "saved"
  // in the Monitor panel would be a lie about disk state. The sink itself stays exactly the
  // old `value ? save(value) : Promise.resolve()` no-op.
  let wrote = false;
  const autosaver = createAutosaver(
    async () => {
      wrote = false;
      if (!value) return;
      await save(value);
      wrote = true;
    },
    delayMs,
    {
      onScheduled: () =>
        monitor({ type: 'persistence', direction: 'local', source: 'server', destination, label: `${label} autosave scheduled` }),
      onSaved: () => {
        if (!wrote) return;
        monitor({ type: 'persistence', direction: 'local', source: 'server', destination, label: `${label} autosave saved` });
      },
      onError: (message) =>
        monitor({ type: 'error', direction: 'local', source: 'server/autosave', destination, label: `${label} autosave failed`, detail: message }),
    },
  );

  return {
    get: () => value,
    set(next: T | null): void {
      value = next;
      autosaver.markDirty();
    },
    autosaver,
    loadInfo,
  };
}

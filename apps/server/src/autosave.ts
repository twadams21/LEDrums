/**
 * Debounced, fire-and-forget project autosave.
 *
 * Every authoritative mutation calls {@link Autosaver.markDirty}; a burst of edits is
 * coalesced into a single write `delayMs` after the *last* one (a true debounce — the
 * timer resets on each edit). Writes are async and serialized through one promise chain,
 * so disk IO never blocks the engine loop and two writes never overlap. A failed write
 * keeps the project dirty so the next edit (or {@link Autosaver.flush}) retries.
 *
 * {@link Autosaver.flush} forces an immediate write and resolves once it is durable; it
 * is awaited on a clean shutdown so no edit is lost.
 */
export interface Autosaver {
  /** Note that the persisted project changed; (re)schedules a debounced write. */
  markDirty(): void;
  /** Write any pending change now; resolves when the write is durable (never rejects). */
  flush(): Promise<void>;
  /** Cancel a pending debounce timer without writing. */
  dispose(): void;
}

const DEFAULT_DELAY_MS = 400;

export interface AutosaverHooks {
  onScheduled?(): void;
  onSaved?(): void;
  onError?(message: string): void;
}

/**
 * Build an {@link Autosaver} over a `save` sink (typically a project write). `save` is
 * called at most once per coalesced burst; it should read the *current* project at call
 * time so the latest snapshot is always persisted.
 */
export function createAutosaver(
  save: () => Promise<void>,
  delayMs: number = DEFAULT_DELAY_MS,
  hooks: AutosaverHooks = {},
): Autosaver {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;
  // All writes run on this single chain → strictly serialized, never overlapping.
  let chain: Promise<void> = Promise.resolve();

  function clearTimer(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  /** Append one write to the serial chain. The body no-ops unless something is dirty. */
  function enqueue(): Promise<void> {
    chain = chain.then(async () => {
      if (!dirty) return;
      dirty = false;
      try {
        await save();
        hooks.onSaved?.();
      } catch (err) {
        dirty = true; // failed — stay dirty so a later edit/flush retries
        const message = err instanceof Error ? err.message : String(err);
        hooks.onError?.(message);
        console.error('[autosave] write failed:', message);
      }
    });
    return chain;
  }

  return {
    markDirty(): void {
      const wasDirty = dirty || timer !== null;
      dirty = true;
      clearTimer();
      if (!wasDirty) hooks.onScheduled?.();
      timer = setTimeout(() => {
        timer = null;
        void enqueue();
      }, delayMs);
      // Don't let a pending autosave timer keep the process alive on its own.
      (timer as { unref?: () => void }).unref?.();
    },
    flush(): Promise<void> {
      clearTimer();
      return enqueue();
    },
    dispose(): void {
      clearTimer();
    },
  };
}

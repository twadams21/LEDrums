import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { SerialQueue } from '../serial-queue';
import { writeFileAtomic } from '../atomic-file';
import { createSnapshotSerializer, SnapshotRefusal, type SerializerOptions } from './serializer-worker';

/** Count admission precedes readCurrent/postMessage, NOT an exact pre-clone byte budget. */
export const DEFAULT_SNAPSHOT_ADMISSION = { maxPendingSnapshots: 2, maxPendingRestores: 2, maxPendingReads: 2 };

/**
 * The SnapshotStore (#123): point-in-time backups of the drummer's entire authored work — the
 * project, the show library, and the song library — bundled at ONE instant so a restore is always
 * referentially coherent (sections never end up pointing at graphs from a different moment). It owns
 * bundling, local rotation, listing, and restore over an injected backups directory + clock, writing
 * every bundle through the existing atomic-write helper. A pure factory in the same style as the
 * autosaver and the Reporter — no singletons, fully testable over temp dirs + a fake clock.
 *
 * A bundle is one gzipped JSON envelope `{ version, createdAt, reason, files }`; `files` holds the
 * three persisted blobs exactly as the server holds them. Snapshots live as `<createdAt>-<reason>.json.gz`
 * in the backups directory, so listing reads only filenames (no gunzip per row) and the newest-first
 * order is the numeric createdAt prefix.
 *
 * Isolation: reading a corrupt/absent bundle returns null rather than throwing, and rotation only
 * ever deletes bundles the retention policy excludes — a snapshot the policy keeps is never at risk.
 */

/** Why a snapshot was taken. `boot`/`cadence` rotate on the generous local window; `pre-risk` is
 * kept on its own fixed budget regardless of age, so cadence churn can never rotate away the
 * snapshot taken right before the operation that broke something. */
export type SnapshotReason = 'boot' | 'cadence' | 'pre-risk';

/** The three persisted blobs captured at one instant. `project` is the validated Project as the
 * engine holds it; the two libraries are the opaque web-owned versioned blobs (or null when the
 * machine has none yet). Stored + restored verbatim, so a restore reproduces them byte-for-byte. */
export interface SnapshotFiles {
  project: unknown;
  showLibrary: unknown;
  songLibrary: unknown;
}

/** The current schema version of a snapshot bundle — bump only on a breaking envelope change. */
export const SNAPSHOT_VERSION = 1;

/** A snapshot bundle as written to disk (gzipped) and shipped off-site (as JSON). */
export interface SnapshotBundle {
  version: number;
  createdAt: number;
  reason: SnapshotReason;
  files: SnapshotFiles;
}

/** Listing metadata for one snapshot — parsed from the filename alone (no gunzip). */
export interface SnapshotMeta {
  /** Stable id = the filename stem `<createdAt>-<reason>`; the WS restore + off-site key use it. */
  id: string;
  createdAt: number;
  reason: SnapshotReason;
}

export interface SnapshotStore {
  /** Take a snapshot of the CURRENT blobs, stamped with `reason`, rotate, and (fire-and-forget) hand
   * it off-site. Returns the created snapshot's meta, or null when skipped: `cadence` self-gates on a
   * serialized-content signature (unchanged since the last snapshot → no snapshot), so an idle session never churns
   * retention. `boot` and `pre-risk` never deduplicate. Busy/oversize/worker/closed refusals
   * reject; disk-write failure returns null. Required safety callers must abort on either. */
  snapshot(reason: SnapshotReason): Promise<SnapshotMeta | null>;
  drain(): Promise<void>;
  close(): Promise<void>;
  /** All local snapshots, newest first (the Backups dialog list + the local read path). */
  list(): Promise<SnapshotMeta[]>;
  /** Read + decode a bundle by id, or null when absent/unreadable. New reads reject when the
   * store is closed or its read admission is full; close never resurrects a worker. */
  read(id: string): Promise<SnapshotBundle | null>;
  /**
   * Restore a local snapshot: take a `pre-risk` snapshot of the CURRENT state first (so an unwanted
   * restore is itself recoverable), then apply the target bundle's three files via the injected sink
   * (which replaces the live blobs + reloads the engine/clients like a cold load). Returns the target
   * meta on success, or null when `id` is unknown/corrupt — in which case NOTHING is applied, so a
   * bad restore leaves current state intact.
   *
   * Fail-closed: if the pre-risk safety snapshot cannot be written (disk full, perms, rotation
   * error), restore THROWS and applies nothing — refusing to overwrite the live project when no
   * recovery point exists. The throw (distinct from the `null` "unknown id" return) lets the caller
   * surface a clear error while the live state stays untouched.
   */
  restore(id: string): Promise<SnapshotMeta | null>;
}

export interface SnapshotStoreDeps {
  /** The backups directory (beside the project files). Injected so tests use a temp dir. */
  dir: string;
  /** Injected clock (epoch ms) — the createdAt stamp + retention "now". */
  now: () => number;
  /** Read the three live blobs at snapshot time. */
  readCurrent: () => SnapshotFiles;
  /** Apply a restored bundle's files: replace the live blobs + reload engine/clients (cold load).
   * Kept injected so the store stays free of engine/WS plumbing and unit-testable with a fake. */
  applyRestored: (files: SnapshotFiles) => void | Promise<void>;
  /** Production coordinator owns validation and the safety snapshot for restore. */
  restoreOwnsSafety?: boolean;
  /** Local retention knobs (defaults per the spec). */
  retention?: Partial<RetentionPolicy>;
  admission?: Partial<typeof DEFAULT_SNAPSHOT_ADMISSION>;
  serializer?: SerializerOptions;
  /** Testable disk boundary; production uses the atomic async writer. */
  write?: typeof writeFileAtomic;
  /** Fire-and-forget off-site hand-off for each new snapshot (the disk-backed backups queue). */
  onSnapshot?: (meta: SnapshotMeta, bundle: SnapshotBundle) => void;
  /** Local-only logger for the store's own faults (default console.error). */
  log?: (message: string) => void;
}

export interface RetentionPolicy {
  /** Newest boot/cadence snapshots always kept (the recent window). */
  recent: number;
  /** Days of one-per-day thinning applied to boot/cadence snapshots beyond the recent window. */
  dailyDays: number;
  /** Newest pre-risk snapshots kept, regardless of age (their own fixed budget). */
  preRiskBudget: number;
}

const DEFAULT_RETENTION: RetentionPolicy = { recent: 48, dailyDays: 30, preRiskBudget: 20 };
const DAY_MS = 86_400_000;
const FILE_SUFFIX = '.json.gz';

/** Filename stem for a snapshot: `<createdAt>-<reason>`. createdAt is a fixed-width-ish epoch-ms
 * prefix (digits only, so it sorts lexically = chronologically), and `reason` may contain a dash
 * (`pre-risk`) — parsing splits on the FIRST dash only, which is unambiguous. */
function stemFor(createdAt: number, reason: SnapshotReason): string {
  return `${createdAt}-${reason}`;
}

/** Parse a `<createdAt>-<reason>` stem back to meta, or null when it is not a snapshot stem. */
function parseStem(stem: string): SnapshotMeta | null {
  if (!/^\d+-(boot|cadence|pre-risk)$/.test(stem)) return null;
  const dash = stem.indexOf('-');
  if (dash <= 0) return null;
  const createdAt = Number(stem.slice(0, dash));
  const reason = stem.slice(dash + 1);
  if (!Number.isSafeInteger(createdAt)) return null;
  if (reason !== 'boot' && reason !== 'cadence' && reason !== 'pre-risk') return null;
  return { id: stem, createdAt, reason };
}

export function createSnapshotStore(deps: SnapshotStoreDeps): SnapshotStore {
  const policy: RetentionPolicy = { ...DEFAULT_RETENTION, ...deps.retention };
  const log = deps.log ?? ((m: string): void => console.error(m));

  const pathFor = (id: string): string => join(deps.dir, `${id}${FILE_SUFFIX}`);

  const queue = new SerialQueue();
  const restores = new SerialQueue();
  let lastStamp = 0;
  // SHA-256 of JSON files, not retained full JSON. Key order remains significant. A hash
  // collision can skip cadence only; boot/pre-risk NEVER deduplicate.
  let lastContent: string | undefined;
  const serializer = createSnapshotSerializer(deps.serializer);
  const admission = { ...DEFAULT_SNAPSHOT_ADMISSION, ...deps.admission };
  for (const [key, value] of Object.entries(admission)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid snapshot admission: ${key}`);
  }
  let pendingSnapshots = 0, pendingRestores = 0, pendingReads = 0;
  const reads = new Set<Promise<SnapshotBundle | null>>();
  let accepting = true;
  let closeCompletion: Promise<void> | null = null;

  async function list(): Promise<SnapshotMeta[]> {
    const names = await readdir(deps.dir).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    const metas: SnapshotMeta[] = [];
    for (const name of names) {
      if (!name.endsWith(FILE_SUFFIX)) continue;
      const meta = parseStem(name.slice(0, -FILE_SUFFIX.length));
      if (meta) metas.push(meta);
    }
    // Newest first; a createdAt tie (same-ms boot + pre-risk) is broken by id for a stable order.
    metas.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
    return metas;
  }

  async function read(id: string): Promise<SnapshotBundle | null> {
    if (!/^\d+-(boot|cadence|pre-risk)$/.test(id)) return null;
    const file = pathFor(id);
    try {
      return await serializer.read(file, id);
    } catch (err) {
      log(`[snapshot-store] read ${id} failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /** Ids to KEEP under the retention policy, computed from the full listing. Everything else rotates.
   * pre-risk and boot/cadence are budgeted independently (pre-risk churn can't evict a daily). */
  function keepIds(metas: SnapshotMeta[]): Set<string> {
    const keep = new Set<string>();
    const preRisk = metas.filter((m) => m.reason === 'pre-risk'); // already newest-first from list()
    const regular = metas.filter((m) => m.reason !== 'pre-risk');

    for (const m of preRisk.slice(0, policy.preRiskBudget)) keep.add(m.id);

    // The recent window is always kept.
    for (const m of regular.slice(0, policy.recent)) keep.add(m.id);

    // Beyond the recent window, thin to one-per-day for the last `dailyDays` days (newest wins per
    // day); anything older than the window is dropped.
    const today = Math.floor(deps.now() / DAY_MS);
    const seenDay = new Set<number>();
    for (const m of regular) {
      const day = Math.floor(m.createdAt / DAY_MS);
      if (day > today) {
        // Future stamp (clock skew) — treat as current, never rotate it away.
        keep.add(m.id);
        continue;
      }
      if (day < today - (policy.dailyDays - 1)) continue; // older than the daily window
      if (!seenDay.has(day)) {
        seenDay.add(day);
        keep.add(m.id);
      }
    }
    return keep;
  }

  async function rotate(): Promise<void> {
    const metas = await list();
    const keep = keepIds(metas);
    for (const m of metas) {
      if (keep.has(m.id)) continue;
      try {
        await rm(pathFor(m.id), { force: true });
      } catch (err) {
        log(`[snapshot-store] rotate ${m.id} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  /** postMessage synchronously clones call-time data (including later in-place edits' targets).
   * JSON stringify/hash/gzip live entirely in the persistent worker. Never queue live references. */
  function snapshot(reason: SnapshotReason): Promise<SnapshotMeta | null> {
    if (pendingSnapshots >= admission.maxPendingSnapshots) {
      return Promise.reject(new SnapshotRefusal('busy', 'Snapshot store is busy; safety checkpoint refused, retry the operation'));
    }
    pendingSnapshots++;
    let capture: ReturnType<typeof serializer.capture>;
    try { capture = serializer.capture(deps.readCurrent()); }
    catch (error) { pendingSnapshots--; return Promise.reject(error); }
    // Observe capture rejection NOW, even while an earlier disk write holds the FIFO. No lost or
    // unhandled promises on worker crash/oversize. Report refusal before the risk operation commits.
    const ready = capture.ready.then(value => ({ value }), error => ({ error }));
    return queue.run(async () => {
      try {
        const result = await ready;
        if ('error' in result) throw result.error;
        const newest = (await list())[0];
        if (lastContent === undefined && newest && reason === 'cadence') {
          try { lastContent = await serializer.digest(pathFor(newest.id), newest.id); }
          catch { /* unreadable previous backup cannot suppress a new checkpoint */ }
        }
        if (reason === 'cadence' && result.value.digest === lastContent) return null;
        const createdAt = Math.max(deps.now(), lastStamp + 1, (newest?.createdAt ?? 0) + 1);
        lastStamp = createdAt;
        const meta = { id: stemFor(createdAt, reason), createdAt, reason };
        // Compressed bytes and the optional off-site text are independent: the local write
        // never waits on, or fails with, bundle preparation for an optional consumer.
        const packed = await serializer.pack(capture.key, meta, !!deps.onSnapshot);
        try {
          await (deps.write ?? writeFileAtomic)(pathFor(meta.id), packed.compressed);
        } catch (err) {
          log(`[snapshot-store] write ${meta.id} failed: ${String(err)}`);
          return null;
        }
        lastContent = result.value.digest;
        await rotate();
        // Off-site preparation runs AFTER the local snapshot is committed and inside its own
        // guard: the text is the call-time revision (worker-retained capture), so a live source
        // that mutated meanwhile still hands off coherent data; a parse or callback failure is
        // logged and never turns the successful local snapshot into a failure.
        try {
          if (packed.text !== undefined) deps.onSnapshot?.(meta, JSON.parse(packed.text) as SnapshotBundle);
        } catch (err) {
          log(`[snapshot-store] off-site hand-off ${meta.id} failed: ${String(err)}`);
        }
        return meta;
      } finally {
        // Also releases skipped cadence and list/write failures. Worker loss already dropped its
        // captures; failure to release must not hide the original operation result.
        await serializer.release(capture.key).catch(() => {});
        pendingSnapshots--;
      }
    });
  }

  async function applyRestore(id: string): Promise<SnapshotMeta | null> {
    // Read + decode FIRST: an unknown/corrupt id is rejected before ANY state is touched, so a bad
    // restore leaves current state intact.
    const bundle = await read(id);
    if (!bundle) return null;
    const meta = parseStem(id);
    if (!meta) return null;
    // Safety net (fail-closed): capture current state as a pre-risk snapshot BEFORE overwriting it,
    // so even a correct-but-unwanted restore is itself recoverable. pre-risk never self-gates, so a
    // null here means the snapshot WRITE failed — REFUSE the restore rather than destroy the live
    // project with no recovery point. Throwing (vs the `null` "unknown id" return) lets the WS seam
    // surface a clear error; applyRestored is never reached, so live state is untouched.
    const pre = deps.restoreOwnsSafety ? true : await snapshot('pre-risk');
    if (!pre) {
      throw new Error(`pre-risk safety snapshot failed; restore of ${id} refused (live state untouched)`);
    }
    await deps.applyRestored(bundle.files);
    return meta;
  }

  async function drain() {
    await restores.drain(); await queue.drain(); await Promise.allSettled([...reads]);
  }
  return {
    list,
    read: (id) => {
      if (!accepting) return Promise.reject(new SnapshotRefusal('closed', 'Snapshot store is closed'));
      if (pendingReads >= admission.maxPendingReads) return Promise.reject(new SnapshotRefusal('busy', 'Snapshot reads are busy; retry the operation'));
      pendingReads++;
      const work = read(id).finally(() => { pendingReads--; reads.delete(work); });
      reads.add(work); return work;
    },
    snapshot: (reason) => accepting ? snapshot(reason) : Promise.reject(new SnapshotRefusal('closed', 'Snapshot store is closed')),
    restore: (id) => {
      if (!accepting) return Promise.reject(new SnapshotRefusal('closed', 'Snapshot store is closed'));
      if (pendingRestores >= admission.maxPendingRestores) return Promise.reject(new SnapshotRefusal('busy', 'Snapshot restores are busy; retry the operation'));
      pendingRestores++;
      return restores.run(() => applyRestore(id)).finally(() => { pendingRestores--; });
    },
    drain,
    close: () => {
      accepting = false;
      return closeCompletion ??= (async () => {
        try { await restores.close(); await queue.close(); await Promise.allSettled([...reads]); }
        finally { await serializer.dispose(); }
      })();
    },
  };
}

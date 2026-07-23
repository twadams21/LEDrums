import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { writeFileAtomicSync } from '../atomic-file';

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
   * content hash (unchanged since the last snapshot → no snapshot), so an idle session never churns
   * retention. `boot` and `pre-risk` always take. */
  snapshot(reason: SnapshotReason): SnapshotMeta | null;
  /** All local snapshots, newest first (the Backups dialog list + the local read path). */
  list(): SnapshotMeta[];
  /** Read + decode a bundle by id, or null when it is absent or unreadable. */
  read(id: string): SnapshotBundle | null;
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
  restore(id: string): SnapshotMeta | null;
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
  applyRestored: (files: SnapshotFiles) => void;
  /** Local retention knobs (defaults per the spec). */
  retention?: Partial<RetentionPolicy>;
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
  const dash = stem.indexOf('-');
  if (dash <= 0) return null;
  const createdAt = Number(stem.slice(0, dash));
  const reason = stem.slice(dash + 1);
  if (!Number.isFinite(createdAt)) return null;
  if (reason !== 'boot' && reason !== 'cadence' && reason !== 'pre-risk') return null;
  return { id: stem, createdAt, reason };
}

export function createSnapshotStore(deps: SnapshotStoreDeps): SnapshotStore {
  const policy: RetentionPolicy = { ...DEFAULT_RETENTION, ...deps.retention };
  const log = deps.log ?? ((m: string): void => console.error(m));

  const pathFor = (id: string): string => join(deps.dir, `${id}${FILE_SUFFIX}`);

  function list(): SnapshotMeta[] {
    if (!existsSync(deps.dir)) return [];
    const metas: SnapshotMeta[] = [];
    for (const name of readdirSync(deps.dir)) {
      if (!name.endsWith(FILE_SUFFIX)) continue;
      const meta = parseStem(name.slice(0, -FILE_SUFFIX.length));
      if (meta) metas.push(meta);
    }
    // Newest first; a createdAt tie (same-ms boot + pre-risk) is broken by id for a stable order.
    metas.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
    return metas;
  }

  function read(id: string): SnapshotBundle | null {
    const file = pathFor(id);
    if (!existsSync(file)) return null;
    try {
      const bundle = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8')) as SnapshotBundle;
      return bundle;
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

  function rotate(): void {
    const metas = list();
    const keep = keepIds(metas);
    for (const m of metas) {
      if (keep.has(m.id)) continue;
      try {
        rmSync(pathFor(m.id), { force: true });
      } catch (err) {
        log(`[snapshot-store] rotate ${m.id} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  /** Stable, order-independent content signature of the three blobs (cadence gating). */
  function contentKey(files: SnapshotFiles): string {
    return JSON.stringify(files);
  }

  function snapshot(reason: SnapshotReason): SnapshotMeta | null {
    const files = deps.readCurrent();

    // Cadence self-gates: an idle session (content unchanged since the last snapshot of ANY reason)
    // takes nothing, so retention isn't churned. boot + pre-risk always take.
    if (reason === 'cadence') {
      const newest = list()[0];
      if (newest) {
        const prev = read(newest.id);
        if (prev && contentKey(prev.files) === contentKey(files)) return null;
      }
    }

    const createdAt = deps.now();
    const bundle: SnapshotBundle = { version: SNAPSHOT_VERSION, createdAt, reason, files };
    const meta: SnapshotMeta = { id: stemFor(createdAt, reason), createdAt, reason };
    try {
      writeFileAtomicSync(pathFor(meta.id), gzipSync(Buffer.from(JSON.stringify(bundle), 'utf8')));
    } catch (err) {
      log(`[snapshot-store] write ${meta.id} failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
    rotate();
    // Off-site hand-off is fire-and-forget: a shipping fault must never affect the local snapshot.
    try {
      deps.onSnapshot?.(meta, bundle);
    } catch (err) {
      log(`[snapshot-store] off-site hand-off ${meta.id} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return meta;
  }

  function restore(id: string): SnapshotMeta | null {
    // Read + decode FIRST: an unknown/corrupt id is rejected before ANY state is touched, so a bad
    // restore leaves current state intact.
    const bundle = read(id);
    if (!bundle) return null;
    const meta = parseStem(id);
    if (!meta) return null;
    // Safety net (fail-closed): capture current state as a pre-risk snapshot BEFORE overwriting it,
    // so even a correct-but-unwanted restore is itself recoverable. pre-risk never self-gates, so a
    // null here means the snapshot WRITE failed — REFUSE the restore rather than destroy the live
    // project with no recovery point. Throwing (vs the `null` "unknown id" return) lets the WS seam
    // surface a clear error; applyRestored is never reached, so live state is untouched.
    const pre = snapshot('pre-risk');
    if (!pre) {
      throw new Error(`pre-risk safety snapshot failed; restore of ${id} refused (live state untouched)`);
    }
    deps.applyRestored(bundle.files);
    return meta;
  }

  return { snapshot, list, read, restore };
}

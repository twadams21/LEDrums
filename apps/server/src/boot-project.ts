import { existsSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertProjectIntegrity,
  defaultProject,
  parseProject,
  reconcileOutputs,
  ReferentialIntegrityError,
  type Project,
} from '@ledrums/core';
import { projectFilePath } from './projects';
import { createSnapshotReader } from './backups/snapshot-store';

/**
 * Boot-recovery ladder for the live project (resilience-hole-0002, INIT-04 S10).
 *
 * `initialProject()` used to call `loadProject` unconditionally at module scope: a
 * ZodError / ReferentialIntegrityError (e.g. an autosaved inputMap naming a drum that
 * no longer exists) killed the process before the WS server existed — and the snapshot
 * restore path needs a connected client, which by definition cannot exist at boot.
 *
 * The ladder: file → newest readable snapshot bundle → seed. Two hard rules:
 *
 * 1. ERROR-CLASS DISCRIMINATION. Only genuine corruption (SyntaxError / ZodError /
 *    ReferentialIntegrityError) quarantines the file. An IO-class fault (EACCES,
 *    EMFILE, a locked file) retries once and then THROWS without renaming — renaming a
 *    perfectly good project aside on a transient fault and letting the autosaver seed
 *    over its name would be a data-loss bug introduced by a data-loss fix.
 *
 * 2. WHOLE-BUNDLE RECOVERY. A snapshot bundle carries project + showLibrary +
 *    songLibrary captured at ONE instant; recovering only the project would pair a
 *    rolled-back project with current on-disk libraries — a state the existing restore
 *    path never produces. The snapshot rung returns the whole bundle (its project
 *    member re-validated through the SAME parse/reconcile/integrity pipeline as
 *    loadProject); the boot wiring seeds the library slots from the same bundle.
 */

export type BootProjectSource = 'seed' | 'file' | 'snapshot' | 'recovered-seed';

export interface BootProjectRecovery {
  /** The error that made the live file unloadable (class name + message). */
  reason: string;
  /** Where the corrupt file was renamed to (absent when there was nothing to quarantine). */
  quarantinedTo?: string;
  /** The snapshot bundle id the project was recovered from (snapshot rung only). */
  bundleId?: string;
}

export interface BootProjectResult {
  project: Project;
  source: BootProjectSource;
  name: string;
  path: string;
  /** Library blobs from the SAME snapshot bundle as the recovered project (snapshot rung
   * only) — the boot wiring must seed its live slots from these, never mix a rolled-back
   * project with current on-disk libraries. */
  showLibrary?: unknown;
  songLibrary?: unknown;
  /** Present iff the live file was unloadable (source 'snapshot' | 'recovered-seed'). */
  recovery?: BootProjectRecovery;
}

export interface BootProjectDeps {
  /** Live project slot name (e.g. 'default.local'). */
  name: string;
  /** The projects directory (snapshots live in `<dir>/backups`). */
  dir: string;
  /** Clock for the quarantine filename stamp. */
  now?: () => number;
  /** Injected file reader (IO-fault tests). Defaults to `readFileSync`. */
  readFile?: (path: string) => string;
  /** Injected quarantine rename (rename-fault tests). Defaults to `renameSync`. */
  rename?: (from: string, to: string) => void;
  log?: (message: string) => void;
}

/** Corruption = the FILE is bad (quarantine + recover). Anything else is an IO fault. */
function isCorruptionError(err: unknown): boolean {
  return (
    err instanceof SyntaxError ||
    err instanceof ReferentialIntegrityError ||
    (err instanceof Error && err.name === 'ZodError')
  );
}

function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

/** Parse + reconcile + integrity-check a raw project value — the SAME pipeline as
 * `loadProject` (projects.ts), applied to both the live file and snapshot bundles. */
function validateProject(value: unknown): Project {
  const parsed = parseProject(value);
  const project: Project = { ...parsed, kit: reconcileOutputs(parsed.kit) };
  assertProjectIntegrity(project);
  return project;
}

/**
 * Resolve the project the server boots with. Never throws on corruption (it recovers);
 * throws only on a persistent IO fault, where failing loudly WITHOUT touching the file
 * is the only safe move.
 */
export function resolveInitialProject(deps: BootProjectDeps): BootProjectResult {
  const now = deps.now ?? Date.now;
  const readFile = deps.readFile ?? ((p: string): string => readFileSync(p, 'utf8'));
  const log = deps.log ?? ((m: string): void => console.error(m));
  const path = projectFilePath(deps.name, deps.dir);

  // Rung 0: fresh machine — seed from the canonical in-code definition, reconciled to
  // the canonical port count (mirrors the old initialProject seed branch exactly).
  if (!existsSync(path)) {
    const seed = defaultProject();
    return { project: { ...seed, kit: reconcileOutputs(seed.kit) }, source: 'seed', name: deps.name, path };
  }

  // Rung 1: the live file.
  let corruption: unknown = null;
  try {
    return { project: loadFrom(readFile, path), source: 'file', name: deps.name, path };
  } catch (err) {
    if (!isCorruptionError(err)) {
      // IO-class fault: retry once, then fail loudly WITHOUT renaming anything.
      log(`[boot-project] IO fault reading ${path} (${describeError(err)}); retrying once`);
      try {
        return { project: loadFrom(readFile, path), source: 'file', name: deps.name, path };
      } catch (err2) {
        if (!isCorruptionError(err2)) {
          log(`[boot-project] IO fault persists reading ${path}; refusing to quarantine or seed`);
          throw err2;
        }
        corruption = err2;
      }
    } else {
      corruption = err;
    }
  }

  // The file is genuinely corrupt: quarantine it so the autosaver can never write a
  // fresh seed over the drummer's (recoverable-by-hand) original.
  const quarantinedTo = join(deps.dir, `${deps.name}.corrupt-${now()}.json`);
  const reason = describeError(corruption);
  const rename = deps.rename ?? renameSync;
  try {
    rename(path, quarantinedTo);
  } catch (err) {
    // FAIL CLOSED (review N6): if the corrupt original cannot be moved aside, the
    // ladder must NOT continue — proceeding would return a recovered project whose
    // autosaver then overwrites the drummer's (recoverable-by-hand) original, the
    // exact loss the quarantine exists to prevent. Boot fails loudly instead.
    log(`[boot-project] quarantine rename failed (${describeError(err)}); refusing to recover over an unquarantined original`);
    throw err;
  }
  log(`[boot-project] live project unloadable (${reason}); quarantined to ${quarantinedTo}`);

  // Rung 2: newest readable snapshot bundle whose project survives the same pipeline.
  const reader = createSnapshotReader({ dir: join(deps.dir, 'backups'), log });
  for (const meta of reader.list()) {
    const bundle = reader.read(meta.id);
    if (!bundle) continue;
    try {
      const project = validateProject(bundle.files.project);
      return {
        project,
        source: 'snapshot',
        name: deps.name,
        path,
        showLibrary: bundle.files.showLibrary,
        songLibrary: bundle.files.songLibrary,
        recovery: { reason, quarantinedTo, bundleId: meta.id },
      };
    } catch (err) {
      log(`[boot-project] snapshot ${meta.id} project invalid (${describeError(err)}); trying older`);
    }
  }

  // Rung 3: seed — the app must boot; the quarantined original is still on disk.
  const seed = defaultProject();
  return {
    project: { ...seed, kit: reconcileOutputs(seed.kit) },
    source: 'recovered-seed',
    name: deps.name,
    path,
    recovery: { reason, quarantinedTo },
  };
}

function loadFrom(readFile: (path: string) => string, path: string): Project {
  return validateProject(JSON.parse(readFile(path)));
}

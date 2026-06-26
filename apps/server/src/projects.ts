import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertProjectIntegrity, parseProject, type Project } from '@ledrums/core';

const here = dirname(fileURLToPath(import.meta.url));
export const PROJECTS_DIR = join(here, '..', 'projects');

/** Monotonic suffix so two writers (e.g. an explicit save + a debounced autosave)
 * never collide on the same temp file. */
let tmpSeq = 0;

/** Validate + serialize a project to its on-disk JSON form. Throws on invalid input. */
function serializeProject(project: Project): string {
  return JSON.stringify(parseProject(project), null, 2);
}

/** Resolve the final + a unique temp path for an atomic `<name>.json` write. */
function writePaths(name: string, dir: string): { final: string; tmp: string } {
  const final = join(dir, `${name}.json`);
  return { final, tmp: `${final}.${process.pid}.${tmpSeq++}.tmp` };
}

/** List saved project names (filenames without the `.json` extension). */
export function listProjects(dir: string = PROJECTS_DIR): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

/** True when a saved project file exists for `name`. */
export function projectExists(name: string, dir: string = PROJECTS_DIR): boolean {
  return existsSync(join(dir, `${name}.json`));
}

/**
 * Load + validate a project by name. Throws on missing file or invalid JSON, and —
 * reusing the core referential-integrity guard (#3) — throws
 * {@link ReferentialIntegrityError} when a saved project references drums not in its
 * own kit, so a drifted/dangling project fails loudly at load instead of silently
 * going dark downstream.
 */
export function loadProject(name: string, dir: string = PROJECTS_DIR): Project {
  const raw = readFileSync(join(dir, `${name}.json`), 'utf8');
  const project = parseProject(JSON.parse(raw));
  assertProjectIntegrity(project);
  return project;
}

/**
 * Validate then atomically persist a project as `<name>.json` — write to a unique temp
 * file and `rename` into place, so a crash never leaves a half-written project. The
 * rename is atomic because the temp lives in the same directory (same filesystem) as the
 * target. Synchronous; used for explicit saves and the shutdown flush.
 */
export function saveProject(name: string, project: Project, dir: string = PROJECTS_DIR): void {
  const data = serializeProject(project);
  mkdirSync(dir, { recursive: true });
  const { final, tmp } = writePaths(name, dir);
  try {
    writeFileSync(tmp, data, 'utf8');
    renameSync(tmp, final);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

/**
 * Async, atomic project write (temp file + `rename`). Same validation + atomicity as
 * {@link saveProject}, but the disk IO is off the main tick — used by the debounced
 * autosaver so persistence never blocks the engine/render loop. Validation runs
 * synchronously (cheap) on the caller; only the file IO is deferred.
 */
export async function saveProjectAsync(
  name: string,
  project: Project,
  dir: string = PROJECTS_DIR,
): Promise<void> {
  const data = serializeProject(project);
  await mkdir(dir, { recursive: true });
  const { final, tmp } = writePaths(name, dir);
  try {
    await writeFile(tmp, data, 'utf8');
    await rename(tmp, final);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

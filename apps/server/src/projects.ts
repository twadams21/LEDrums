import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertProjectIntegrity, parseProject, type Project } from '@ledrums/core';
import { writeFileAtomic, writeFileAtomicSync } from './atomic-file';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the projects directory. An explicit `LEDRUMS_PROJECTS_DIR` wins — the packaged
 * desktop shell (S4) sets it to redirect persistence into the OS app-data dir, where a
 * sandboxed binary can actually write. Unset (plain `pnpm dev`/`pnpm start`) falls back to
 * the in-repo `apps/server/projects` dir alongside this module, so today's behavior is
 * unchanged. Pure over `env` so it is unit-testable without reaching into `process.env`.
 */
export function resolveProjectsDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.LEDRUMS_PROJECTS_DIR?.trim();
  return override ? override : join(here, '..', 'projects');
}

export const PROJECTS_DIR = resolveProjectsDir();

/** Validate + serialize a project to its on-disk JSON form. Throws on invalid input. */
function serializeProject(project: Project): string {
  return JSON.stringify(parseProject(project), null, 2);
}

/** Resolve the final path for a persisted `<name>.json` project. */
function projectPath(name: string, dir: string): string {
  return join(dir, `${name}.json`);
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
  return existsSync(projectPath(name, dir));
}

/**
 * Load + validate a project by name. Throws on missing file or invalid JSON, and —
 * reusing the core referential-integrity guard (#3) — throws
 * {@link ReferentialIntegrityError} when a saved project references drums not in its
 * own kit, so a drifted/dangling project fails loudly at load instead of silently
 * going dark downstream.
 */
export function loadProject(name: string, dir: string = PROJECTS_DIR): Project {
  const raw = readFileSync(projectPath(name, dir), 'utf8');
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
  writeFileAtomicSync(projectPath(name, dir), serializeProject(project));
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
  await writeFileAtomic(projectPath(name, dir), serializeProject(project));
}

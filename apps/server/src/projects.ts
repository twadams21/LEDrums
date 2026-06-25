import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertProjectIntegrity, parseProject, type Project } from '@ledrums/core';

const here = dirname(fileURLToPath(import.meta.url));
export const PROJECTS_DIR = join(here, '..', 'projects');

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

/** Validate then persist a project as `<name>.json`. */
export function saveProject(name: string, project: Project, dir: string = PROJECTS_DIR): void {
  const validated = parseProject(project);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(validated, null, 2), 'utf8');
}

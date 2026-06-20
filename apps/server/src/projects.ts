import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseProject, type Project } from '@ledrums/core';

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

/** Load + validate a project by name. Throws on missing file or invalid JSON. */
export function loadProject(name: string, dir: string = PROJECTS_DIR): Project {
  const raw = readFileSync(join(dir, `${name}.json`), 'utf8');
  return parseProject(JSON.parse(raw));
}

/** Validate then persist a project as `<name>.json`. */
export function saveProject(name: string, project: Project, dir: string = PROJECTS_DIR): void {
  const validated = parseProject(project);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(validated, null, 2), 'utf8');
}

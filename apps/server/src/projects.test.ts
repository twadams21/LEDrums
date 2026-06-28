import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  assertProjectIntegrity,
  buildDmxMap,
  buildPixelModel,
  defaultProject,
  ReferentialIntegrityError,
} from '@ledrums/core';
import {
  listProjects,
  loadProject,
  projectExists,
  resolveProjectsDir,
  saveProject,
  saveProjectAsync,
} from './projects';

const tmp = mkdtempSync(join(tmpdir(), 'ledrums-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('projects', () => {
  it('round-trips save -> load', () => {
    const p = defaultProject();
    saveProject('show', p, tmp);
    expect(listProjects(tmp)).toContain('show');
    expect(loadProject('show', tmp)).toEqual(p);
  });

  it('surfaces a validation error for invalid JSON rather than crashing', () => {
    writeFileSync(join(tmp, 'broken.json'), '{ "kit": { "drums": [] } }', 'utf8');
    expect(() => loadProject('broken', tmp)).toThrow();
  });

  // Seed-from-core (#2): the canonical default project comes from defaultProject()
  // (→ DEFAULT_KIT), not a hand-edited default.json. It is self-consistent and its
  // pixel model + DMX map build cleanly.
  it('the canonical default project is integrity-clean and builds a DMX map', () => {
    const p = defaultProject();
    expect(() => assertProjectIntegrity(p)).not.toThrow();
    const model = buildPixelModel(p.kit);
    expect(model.pixelCount).toBeGreaterThan(0);
    expect(() => buildDmxMap(p.kit, model)).not.toThrow();
  });

  it('reports no saved default in a fresh projects dir (server falls back to core)', () => {
    expect(projectExists('default', tmp)).toBe(false);
  });

  // The load path reuses the #3 referential-integrity guard: a saved project that
  // is schema-valid but references a drum absent from its kit fails loudly at load.
  it('loadProject throws ReferentialIntegrityError on a dangling drum reference', () => {
    const base = defaultProject();
    const dangling = {
      ...base,
      inputMap: { ...base.inputMap, midiNotes: [{ note: 99, drumId: 'ghost', slot: 0 }] },
    };
    saveProject('dangling', dangling, tmp);
    expect(() => loadProject('dangling', tmp)).toThrow(ReferentialIntegrityError);
    expect(() => loadProject('dangling', tmp)).toThrow(/drum "ghost"/);
  });
});

describe('resolveProjectsDir (S4 env override)', () => {
  // The packaged desktop shell sets LEDRUMS_PROJECTS_DIR to redirect persistence into the OS
  // app-data dir; an explicit value wins verbatim.
  it('honors an explicit LEDRUMS_PROJECTS_DIR', () => {
    expect(resolveProjectsDir({ LEDRUMS_PROJECTS_DIR: '/var/data/ledrums/projects' })).toBe(
      '/var/data/ledrums/projects',
    );
  });

  // Unset → the in-repo default (apps/server/projects) so plain dev/start is unchanged. We
  // don't pin the absolute path (it is machine-relative), only that it lands on .../projects.
  it('falls back to the in-repo default when unset', () => {
    const resolved = resolveProjectsDir({});
    expect(resolved.endsWith(join('server', 'projects'))).toBe(true);
  });

  // A blank/whitespace value is treated as unset (not a request to persist into "").
  it('treats a blank override as unset', () => {
    expect(resolveProjectsDir({ LEDRUMS_PROJECTS_DIR: '   ' })).toBe(resolveProjectsDir({}));
  });
});

describe('atomic writes (temp + rename)', () => {
  it('saveProject leaves only the final file — no temp residue', () => {
    saveProject('atomic', defaultProject(), tmp);
    expect(readdirSync(tmp).filter((f) => f.startsWith('atomic'))).toEqual(['atomic.json']);
    expect(loadProject('atomic', tmp)).toEqual(defaultProject());
  });

  it('saveProjectAsync writes atomically and round-trips', async () => {
    await saveProjectAsync('atomic-async', defaultProject(), tmp);
    expect(readdirSync(tmp).filter((f) => f.startsWith('atomic-async'))).toEqual(['atomic-async.json']);
    expect(loadProject('atomic-async', tmp)).toEqual(defaultProject());
  });

  it('overwriting an existing project leaves a single valid file', async () => {
    saveProject('over', defaultProject(), tmp);
    await saveProjectAsync('over', { ...defaultProject(), name: 'Edited' }, tmp);
    expect(readdirSync(tmp).filter((f) => f.startsWith('over'))).toEqual(['over.json']);
    expect(loadProject('over', tmp).name).toBe('Edited');
  });

  // Acceptance: a routing/geometry/output mutation survives a save + reload (the disk
  // round-trip behind live persistence).
  it('restores a routing/geometry/output mutation after save + reload', async () => {
    const p = defaultProject();
    p.output.host = '10.0.0.7';
    p.output.priority = 175;
    p.kit.drums[0]!.pixelsPerHoop = 244;
    p.kit.drums[0]!.startAngleDeg = 33;
    p.kit.outputs = [...p.kit.outputs].reverse(); // reorder the transmit topology
    await saveProjectAsync('mutated', p, tmp);

    const reloaded = loadProject('mutated', tmp);
    expect(reloaded).toEqual(p);
    expect(reloaded.kit.drums[0]!.pixelsPerHoop).toBe(244);
    expect(reloaded.output.priority).toBe(175);
  });
});

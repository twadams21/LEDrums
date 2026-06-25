import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
import { listProjects, loadProject, projectExists, saveProject } from './projects';

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

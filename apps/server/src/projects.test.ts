import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildDmxMap, buildPixelModel, defaultProject } from '@ledrums/core';
import { listProjects, loadProject, PROJECTS_DIR, saveProject } from './projects';

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

  it('ships a valid default.json whose output map respects the 304px/output limit', () => {
    const p = loadProject('default', PROJECTS_DIR);
    const model = buildPixelModel(p.kit);
    // buildDmxMap throws if any output exceeds maxPixelsPerOutput; reaching here means it passed.
    expect(() => buildDmxMap(p.kit, model)).not.toThrow();
    expect(model.pixelCount).toBeGreaterThan(0);
  });
});

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultProject, parseProject, reconcileOutputs } from '@ledrums/core';
import { loadProject } from './projects';
import { resolveInitialProject } from './boot-project';

/* The ladder is filesystem behaviour; faking the fs would prove nothing. Every case
   runs against a real temp projects dir (snapshots under <dir>/backups). */

const NAME = 'default.local';
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledrums-boot-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeLiveProject(value: unknown): void {
  writeFileSync(join(dir, `${NAME}.json`), typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

function writeSnapshot(id: string, files: { project: unknown; showLibrary?: unknown; songLibrary?: unknown }): void {
  mkdirSync(join(dir, 'backups'), { recursive: true });
  const bundle = {
    version: 1,
    createdAt: Number(id.split('-')[0]),
    reason: id.slice(id.indexOf('-') + 1),
    files: { showLibrary: null, songLibrary: null, ...files },
  };
  writeFileSync(join(dir, 'backups', `${id}.json.gz`), gzipSync(Buffer.from(JSON.stringify(bundle), 'utf8')));
}

function resolve(overrides: Parameters<typeof resolveInitialProject>[0] extends infer D ? Partial<D> : never = {}) {
  return resolveInitialProject({ name: NAME, dir, log: () => {}, ...overrides });
}

describe('resolveInitialProject (S10)', () => {
  it('no file → seed, outputs reconciled to the canonical port count', () => {
    const r = resolve();
    expect(r.source).toBe('seed');
    const seed = defaultProject();
    expect(r.project.kit.outputs).toEqual(reconcileOutputs(seed.kit).outputs);
    expect(r.project.kit.outputs.length).toBeGreaterThan(0);
  });

  it('valid file → file, byte-identical to loadProject', () => {
    writeLiveProject(defaultProject());
    const r = resolve();
    expect(r.source).toBe('file');
    expect(JSON.stringify(r.project)).toBe(JSON.stringify(loadProject(NAME, dir)));
  });

  it('truncated JSON + one valid snapshot → snapshot rung, quarantined, whole bundle adopted', () => {
    writeLiveProject('{"version": 1, "kit": {');
    const show = { version: 3, shows: ['from-bundle'] };
    const song = { version: 2, songs: ['from-bundle'] };
    writeSnapshot('1000000000000-boot', { project: defaultProject(), showLibrary: show, songLibrary: song });
    const r = resolve({ now: () => 1234 });
    expect(r.source).toBe('snapshot');
    expect(r.recovery?.bundleId).toBe('1000000000000-boot');
    // Bad file renamed aside; the original filename is gone.
    expect(existsSync(join(dir, `${NAME}.json`))).toBe(false);
    expect(existsSync(join(dir, `${NAME}.corrupt-1234.json`))).toBe(true);
    // showLibrary/songLibrary come from the SAME bundle as the project.
    expect(r.showLibrary).toEqual(show);
    expect(r.songLibrary).toEqual(song);
    expect(JSON.stringify(r.project)).toBe(JSON.stringify({ ...parseProject(defaultProject()), kit: reconcileOutputs(parseProject(defaultProject()).kit) }));
  });

  it('schema-valid but dangling drum ref + NO snapshot → recovered-seed naming ReferentialIntegrityError', () => {
    const p = defaultProject();
    p.inputMap.midiNotes = [{ note: 36, drumId: 'nope', slot: 0 }];
    writeLiveProject(p);
    const r = resolve({ now: () => 99 });
    expect(r.source).toBe('recovered-seed');
    expect(r.recovery?.reason).toContain('ReferentialIntegrityError');
    expect(existsSync(join(dir, `${NAME}.corrupt-99.json`))).toBe(true);
  });

  it('corrupt snapshot + corrupt file → still recovered-seed, never a throw', () => {
    writeLiveProject('not json at all');
    mkdirSync(join(dir, 'backups'), { recursive: true });
    writeFileSync(join(dir, 'backups', '1000000000000-boot.json.gz'), Buffer.from([0x1f, 0x8b, 0x00]));
    const r = resolve();
    expect(r.source).toBe('recovered-seed');
  });

  it('IO fault (EACCES twice) → NO rename, original stays on disk, ladder throws the fault', () => {
    writeLiveProject(defaultProject());
    let calls = 0;
    const readFile = (): string => {
      calls++;
      const err = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
      err.code = 'EACCES';
      throw err;
    };
    expect(() => resolve({ readFile })).toThrow('EACCES');
    expect(calls).toBe(2); // retried exactly once
    expect(existsSync(join(dir, `${NAME}.json`))).toBe(true); // never quarantined
    expect(readdirSync(dir).filter((f) => f.includes('corrupt'))).toEqual([]);
  });
});

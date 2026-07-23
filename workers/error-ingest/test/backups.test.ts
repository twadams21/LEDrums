import { describe, expect, it } from 'vitest';
import { getBackup, ingestBackups, listBackups } from '../src/handlers';
import { parseBackupBatch, ValidationError } from '../src/validate';
import { backupKey } from '../src/backups';
import { fakeBackupStore } from './fake-backup-store';
import type { WireBackup } from '../src/types';

const backup = (over: Partial<WireBackup> = {}): WireBackup => ({
  machine: 'studio-mac',
  key: '1000000000000-boot',
  createdAt: 1_000_000_000_000,
  reason: 'boot',
  bundle: { version: 1, files: { project: { name: 'p' } } },
  ...over,
});

describe('parseBackupBatch (#123 — worker trust boundary)', () => {
  it('accepts a well-formed batch under the `reports` key (the transport is payload-agnostic)', () => {
    const parsed = parseBackupBatch({ reports: [backup()], dropped: 2 });
    expect(parsed.backups).toHaveLength(1);
    expect(parsed.dropped).toBe(2);
  });

  it('rejects a machine with a path separator (no traversal out of backups/)', () => {
    expect(() => parseBackupBatch({ reports: [backup({ machine: '../etc' })] })).toThrow(ValidationError);
    expect(() => parseBackupBatch({ reports: [backup({ machine: 'a/b' })] })).toThrow(ValidationError);
  });

  it('rejects a key with dot-dot or a separator', () => {
    expect(() => parseBackupBatch({ reports: [backup({ key: '..' })] })).toThrow(ValidationError);
    expect(() => parseBackupBatch({ reports: [backup({ key: 'a/b' })] })).toThrow(ValidationError);
  });

  it('rejects a missing bundle', () => {
    const b = backup();
    delete (b as { bundle?: unknown }).bundle;
    expect(() => parseBackupBatch({ reports: [b] })).toThrow(ValidationError);
  });

  it('rejects too many backups in one batch', () => {
    const many = Array.from({ length: 101 }, (_, i) => backup({ key: `${i}-boot` }));
    expect(() => parseBackupBatch({ reports: many })).toThrow(ValidationError);
  });
});

describe('ingestBackups', () => {
  it('stores each bundle under backups/<machine>/<key>, verbatim', async () => {
    const store = fakeBackupStore();
    const res = await ingestBackups(store, { backups: [backup(), backup({ machine: 'laptop', key: '2-cadence' })], dropped: 0 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ accepted: 2 });
    expect(store.objects.get(backupKey('studio-mac', '1000000000000-boot'))).toBe(
      JSON.stringify({ version: 1, files: { project: { name: 'p' } } }),
    );
    expect(store.objects.has(backupKey('laptop', '2-cadence'))).toBe(true);
  });
});

describe('listBackups', () => {
  it('lists only the requested machine, newest first', async () => {
    const store = fakeBackupStore();
    await ingestBackups(store, {
      backups: [
        backup({ key: 'a-boot' }),
        backup({ key: 'b-cadence' }),
        backup({ machine: 'other', key: 'c-boot' }),
      ],
      dropped: 0,
    });
    const res = await listBackups(store, new URL('https://w/backups?machine=studio-mac'));
    expect(res.status).toBe(200);
    const body = res.body as { objects: { key: string }[]; count: number };
    expect(body.count).toBe(2);
    expect(body.objects[0]!.key).toBe(backupKey('studio-mac', 'b-cadence')); // newest upload first
    expect(body.objects.every((o) => o.key.startsWith('backups/studio-mac/'))).toBe(true);
  });

  it('400s when machine is omitted (a listing never spans machines)', async () => {
    const res = await listBackups(fakeBackupStore(), new URL('https://w/backups'));
    expect(res.status).toBe(400);
  });
});

describe('getBackup', () => {
  it('returns the stored bundle body by full key', async () => {
    const store = fakeBackupStore();
    await ingestBackups(store, { backups: [backup()], dropped: 0 });
    const key = backupKey('studio-mac', '1000000000000-boot');
    const res = await getBackup(store, new URL(`https://w/backups/object?key=${encodeURIComponent(key)}`));
    expect(res.status).toBe(200);
    expect(res.body).toBe(JSON.stringify({ version: 1, files: { project: { name: 'p' } } }));
  });

  it('404s an absent key', async () => {
    const res = await getBackup(fakeBackupStore(), new URL('https://w/backups/object?key=backups/x/y-boot'));
    expect(res.status).toBe(404);
  });

  it('400s a key outside the backups/ prefix (read trust boundary)', async () => {
    const res = await getBackup(fakeBackupStore(), new URL('https://w/backups/object?key=secrets/token'));
    expect(res.status).toBe(400);
  });

  it('400s a key containing dot-dot', async () => {
    const res = await getBackup(fakeBackupStore(), new URL('https://w/backups/object?key=backups/../x'));
    expect(res.status).toBe(400);
  });
});

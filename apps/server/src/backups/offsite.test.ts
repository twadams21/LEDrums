import { describe, expect, it } from 'vitest';
import { backupsEndpoint, toBackupRecord } from './offsite';
import { SNAPSHOT_VERSION, type SnapshotBundle, type SnapshotMeta } from './snapshot-store';

describe('off-site backup shaping (#123)', () => {
  const meta: SnapshotMeta = { id: '1000000000000-boot', createdAt: 1_000_000_000_000, reason: 'boot' };
  const bundle: SnapshotBundle = {
    version: SNAPSHOT_VERSION,
    createdAt: 1_000_000_000_000,
    reason: 'boot',
    files: { project: { name: 'p' }, showLibrary: null, songLibrary: null },
  };

  it('shapes a record keyed by machine + snapshot id, carrying the full bundle', () => {
    expect(toBackupRecord('studio-mac', meta, bundle)).toEqual({
      machine: 'studio-mac',
      key: '1000000000000-boot',
      createdAt: 1_000_000_000_000,
      reason: 'boot',
      bundle,
    });
  });

  describe('backupsEndpoint', () => {
    it('rewrites the ingest path to /backups on the same origin', () => {
      expect(backupsEndpoint('https://ledrums-error-ingest.acme.workers.dev/ingest')).toBe(
        'https://ledrums-error-ingest.acme.workers.dev/backups',
      );
    });

    it('drops any query string from the source endpoint', () => {
      expect(backupsEndpoint('https://w.example/ingest?x=1')).toBe('https://w.example/backups');
    });

    it('returns null for an unparseable endpoint', () => {
      expect(backupsEndpoint('not a url')).toBeNull();
    });
  });
});

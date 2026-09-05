import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { d1Store } from '../src/store';
import { row } from './report-fixture';
import { sqliteD1 } from './sqlite-d1';

const NOW = 1_000_000;
const budget = { sinceMs: NOW - 60_000, maxNewKeys: 1 };
const migration = readFileSync(new URL('../migrations/0001-notification-claims.sql', import.meta.url), 'utf8');
const databases: ReturnType<typeof sqliteD1>[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function open(path?: string) {
  const db = sqliteD1(path);
  databases.push(db);
  return db;
}

describe('D1 admission SQL and migration — real SQLite', () => {
  it('rolls back the claim/budget charge if report persistence fails', async () => {
    const local = open();
    const store = d1Store(local.db);
    local.sqlite.exec(`CREATE TRIGGER fail_report BEFORE INSERT ON reports
      BEGIN SELECT RAISE(ABORT, 'injected storage failure'); END;`);
    await expect(store.admit(row(), budget)).rejects.toThrow('injected storage failure');
    expect(local.sqlite.prepare('SELECT * FROM notification_claims').all()).toHaveLength(0);
    expect(await store.list({ limit: 100 })).toHaveLength(0);
    local.sqlite.exec('DROP TRIGGER fail_report');
    expect(await store.admit(row(), budget)).toEqual({ accepted: true, claimed: true });
  });

  it('denial persists neither a claim nor a report; retry after expiry can claim', async () => {
    const local = open();
    const store = d1Store(local.db);
    await store.admit(row(), budget);
    expect(await store.admit(row(NOW, 'other'), budget)).toEqual({ accepted: false, claimed: false });
    expect(local.sqlite.prepare('SELECT * FROM notification_claims').all()).toHaveLength(1);
    // Inclusive lower boundary: a claim at exactly sinceMs still charges the budget.
    expect(await store.admit(row(NOW + 60_000, 'other'), { ...budget, sinceMs: NOW }))
      .toEqual({ accepted: false, claimed: false });
    expect(await store.admit(row(NOW + 60_001, 'other'), { ...budget, sinceMs: NOW + 1 }))
      .toEqual({ accepted: true, claimed: true });
    // Aged-out claims remain permanent dedup markers, even when budget is zero.
    expect(await store.admit(row(NOW + 60_002), { sinceMs: NOW + 2, maxNewKeys: 0 }))
      .toEqual({ accepted: true, claimed: false });
    expect(await store.list({ limit: 100 })).toHaveLength(2);
  });

  it('overlapping independent connections share the budget and unique claim', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledrums-ingest-'));
    directories.push(dir);
    const path = join(dir, 'reports.sqlite');
    const stores = [d1Store(open(path).db), d1Store(open(path).db)];
    const outcomes = await Promise.all(Array.from({ length: 20 }, (_, i) =>
      stores[i % 2]!.admit(row(NOW, `key-${i % 5}`, `session-${i}`), { ...budget, maxNewKeys: 2 })));
    expect(outcomes.filter((r) => r.claimed)).toHaveLength(2);
    expect(outcomes.filter((r) => r.accepted)).toHaveLength(8); // 2 admitted identities × 4 sessions
    expect(await stores[0]!.list({ limit: 100 })).toHaveLength(8);
  });

  it('backfills all legacy identities at earliest arrival, is rerunnable and preserves reports', async () => {
    const local = open();
    // Build legacy reports through production SQL, then remove the NEW table to model an old DB.
    const store = d1Store(local.db);
    await store.admit(row(NOW - 120_000), { sinceMs: 0, maxNewKeys: 10 });
    await store.admit(row(NOW, 'boom', 'new-session'), { sinceMs: 0, maxNewKeys: 10 });
    await store.admit(row(NOW, 'recent'), { sinceMs: 0, maxNewKeys: 10 });
    await store.admit({ ...row(NOW, 'boom'), machine: 'rig-2' }, { sinceMs: 0, maxNewKeys: 10 });
    await store.admit({ ...row(NOW, 'boom'), version: '2' }, { sinceMs: 0, maxNewKeys: 10 });
    const before = await store.list({ limit: 100 });
    local.sqlite.exec('DROP TABLE notification_claims');
    local.sqlite.exec(migration);
    local.sqlite.exec(migration);
    expect(await store.list({ limit: 100 })).toEqual(before);
    const claims = local.sqlite.prepare('SELECT * FROM notification_claims ORDER BY machine, version, dedup_key').all();
    expect(claims).toHaveLength(4);
    expect(claims[0]).toMatchObject({ machine: 'rig-1', version: '1', dedup_key: 'boom', claimed_at: NOW - 120_000 });
    expect(await store.admit(row(NOW, 'boom', 'third-session'), { ...budget, maxNewKeys: 0 }))
      .toEqual({ accepted: true, claimed: false });
    expect(await store.admit(row(NOW, 'fresh'), { ...budget, maxNewKeys: 2 }))
      .toEqual({ accepted: false, claimed: false }); // recent + version 2 consume two, not repeat sessions
    expect(await store.admit(row(NOW, 'fresh'), { ...budget, maxNewKeys: 3 }))
      .toEqual({ accepted: true, claimed: true });
    local.sqlite.exec(migration);
    expect(await store.admit(row(NOW, 'fresh'), budget)).toEqual({ accepted: true, claimed: false });
  });

  it('fresh schema and upgraded schema have the same claims table/index', () => {
    const local = open();
    const definitions = () => local.sqlite.prepare(`SELECT type, name, sql FROM sqlite_master
      WHERE tbl_name = 'notification_claims' ORDER BY name`).all();
    const fresh = definitions();
    local.sqlite.exec('DROP TABLE notification_claims');
    local.sqlite.exec(migration);
    expect(definitions()).toEqual(fresh);
  });
});

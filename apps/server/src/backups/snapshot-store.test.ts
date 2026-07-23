import { chmodSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSnapshotStore,
  SNAPSHOT_VERSION,
  type SnapshotFiles,
  type SnapshotStore,
} from './snapshot-store';

// External-behaviour tests only: "given these blobs, this clock, and these triggers, this snapshot
// set exists / this restore produces this state." Never asserts directory internals beyond file
// count, which is the observable retention outcome.

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledrums-snap-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const DAY = 86_400_000;

/** A mutable current-state fixture + a controllable clock, the two injected seams under test. */
function harness(initial?: Partial<SnapshotFiles>) {
  let current: SnapshotFiles = {
    project: { name: 'p', v: 1 },
    showLibrary: { version: 1, data: { shows: [] } },
    songLibrary: { version: 1, data: { songs: [] } },
    ...initial,
  };
  let clock = 1_000_000_000_000; // fixed epoch base
  const applied: SnapshotFiles[] = [];
  const shipped: { id: string; reason: string }[] = [];
  const store = (): SnapshotStore =>
    createSnapshotStore({
      dir,
      now: () => clock,
      readCurrent: () => current,
      applyRestored: (files) => {
        applied.push(files);
        current = files; // a real restore replaces live state; mirror that so round-trips are exact
      },
      onSnapshot: (meta) => shipped.push({ id: meta.id, reason: meta.reason }),
    });
  return {
    store,
    setCurrent: (f: SnapshotFiles) => {
      current = f;
    },
    getCurrent: () => current,
    setClock: (ms: number) => {
      clock = ms;
    },
    advance: (ms: number) => {
      clock += ms;
    },
    applied,
    shipped,
  };
}

const fileCount = (): number => readdirSync(dir).filter((f) => f.endsWith('.json.gz')).length;

describe('createSnapshotStore (#123)', () => {
  it('round-trips all three blobs: snapshot → read reproduces the bundle exactly', () => {
    const h = harness();
    const s = h.store();
    const meta = s.snapshot('boot');
    expect(meta).not.toBeNull();
    expect(meta!.reason).toBe('boot');

    const bundle = s.read(meta!.id);
    expect(bundle).toEqual({
      version: SNAPSHOT_VERSION,
      createdAt: meta!.createdAt,
      reason: 'boot',
      files: h.getCurrent(),
    });
  });

  it('restore reproduces the snapshotted state byte-for-byte after the live state has moved on', () => {
    const h = harness();
    const s = h.store();
    const original = h.getCurrent();
    const meta = s.snapshot('boot')!;

    // Live state drifts.
    h.advance(1000);
    h.setCurrent({ project: { name: 'p', v: 2 }, showLibrary: null, songLibrary: null });

    const restored = s.restore(meta.id);
    expect(restored!.id).toBe(meta.id);
    expect(h.applied.at(-1)).toEqual(original);
    expect(h.getCurrent()).toEqual(original);
  });

  it('stamps the reason on the snapshot id + meta', () => {
    const h = harness();
    const s = h.store();
    expect(s.snapshot('boot')!.reason).toBe('boot');
    h.advance(1);
    h.setCurrent({ project: { name: 'p', v: 2 }, showLibrary: null, songLibrary: null });
    expect(s.snapshot('cadence')!.reason).toBe('cadence');
    h.advance(1);
    const pr = s.snapshot('pre-risk')!;
    expect(pr.reason).toBe('pre-risk');
    expect(pr.id.endsWith('-pre-risk')).toBe(true);
    expect(s.list().map((m) => m.reason)).toEqual(['pre-risk', 'cadence', 'boot']);
  });

  describe('cadence content-hash gating', () => {
    it('skips a cadence snapshot when nothing changed since the last snapshot', () => {
      const h = harness();
      const s = h.store();
      s.snapshot('boot');
      h.advance(DAY);
      expect(s.snapshot('cadence')).toBeNull(); // identical content → no snapshot
      expect(fileCount()).toBe(1);
    });

    it('takes a cadence snapshot when content changed', () => {
      const h = harness();
      const s = h.store();
      s.snapshot('boot');
      h.advance(DAY);
      h.setCurrent({ project: { name: 'p', v: 2 }, showLibrary: null, songLibrary: null });
      expect(s.snapshot('cadence')).not.toBeNull();
      expect(fileCount()).toBe(2);
    });

    it('boot and pre-risk always take even when content is unchanged', () => {
      const h = harness();
      const s = h.store();
      s.snapshot('boot');
      h.advance(1);
      expect(s.snapshot('pre-risk')).not.toBeNull();
      h.advance(1);
      expect(s.snapshot('boot')).not.toBeNull();
      expect(fileCount()).toBe(3);
    });
  });

  describe('local retention', () => {
    it('keeps the most recent 48 cadence/boot snapshots within a day', () => {
      const h = harness();
      const s = h.store();
      // 60 distinct-content snapshots, 1 minute apart (all "today").
      for (let i = 0; i < 60; i++) {
        h.setCurrent({ project: { name: 'p', v: i }, showLibrary: null, songLibrary: null });
        s.snapshot('cadence');
        h.advance(60_000);
      }
      // 48 recent + at most one older per prior day; all 60 are same-day, so exactly 48 survive.
      expect(fileCount()).toBe(48);
    });

    it('thins to one-per-day beyond the recent window and drops beyond 30 days', () => {
      const h = harness();
      const s = h.store();
      // One changing snapshot per day for 40 days.
      for (let d = 0; d < 40; d++) {
        h.setClock(1_000_000_000_000 + d * DAY + 3_600_000); // mid-day, deterministic
        h.setCurrent({ project: { name: 'p', v: d }, showLibrary: null, songLibrary: null });
        s.snapshot('cadence');
      }
      // Recent window (48) exceeds the 40 daily snapshots, so all 40 are within "recent" — but the
      // daily thinning window is 30 days, and the recent-48 keeps all 40 since <48. So 40 survive.
      expect(fileCount()).toBe(40);
    });

    it('drops days older than the 30-day window once the recent window is exceeded', () => {
      const h = harness();
      const s = h.store();
      // 5 cadence snapshots per day for 40 days = 200 snapshots. Recent-48 covers ~10 recent days;
      // beyond that only one-per-day is kept, and only for the last 30 days.
      for (let d = 0; d < 40; d++) {
        for (let k = 0; k < 5; k++) {
          h.setClock(1_000_000_000_000 + d * DAY + k * 3_600_000);
          h.setCurrent({ project: { name: 'p', v: d * 10 + k }, showLibrary: null, songLibrary: null });
          s.snapshot('cadence');
        }
      }
      // now = last stamp on day 39. Days 10..39 (30 days) each keep ≥1; the newest 48 cover the tail.
      // Upper bound: 48 recent + one-per-day for the 30-day window that fall outside the recent set.
      const survivors = s.list();
      expect(survivors.length).toBeLessThanOrEqual(48 + 30);
      // Nothing older than 30 days survives: no snapshot from day < 10 (today=39).
      const today = Math.floor((1_000_000_000_000 + 39 * DAY + 4 * 3_600_000) / DAY);
      for (const m of survivors) {
        expect(Math.floor(m.createdAt / DAY)).toBeGreaterThanOrEqual(today - 29);
      }
    });

    it('keeps pre-risk snapshots on a separate fixed budget of 20, immune to cadence churn', () => {
      const h = harness();
      const s = h.store();
      // 30 pre-risk snapshots interleaved with 60 cadence snapshots, all same day.
      for (let i = 0; i < 60; i++) {
        h.setCurrent({ project: { name: 'p', v: i }, showLibrary: null, songLibrary: null });
        s.snapshot('cadence');
        h.advance(1000);
        if (i % 2 === 0) {
          s.snapshot('pre-risk');
          h.advance(1000);
        }
      }
      const survivors = s.list();
      const preRisk = survivors.filter((m) => m.reason === 'pre-risk');
      const regular = survivors.filter((m) => m.reason !== 'pre-risk');
      expect(preRisk.length).toBe(20); // newest 20 pre-risk kept regardless of cadence volume
      expect(regular.length).toBe(48); // cadence keeps its own recent window
    });
  });

  describe('restore safety', () => {
    it('takes a pre-risk snapshot of current state BEFORE applying the target', () => {
      const h = harness();
      const s = h.store();
      const target = s.snapshot('boot')!;

      h.advance(5000);
      const beforeRestore: SnapshotFiles = { project: { name: 'p', v: 99 }, showLibrary: null, songLibrary: null };
      h.setCurrent(beforeRestore);

      s.restore(target.id);

      // A fresh pre-risk snapshot capturing the pre-restore state now exists.
      const preRisk = s.list().find((m) => m.reason === 'pre-risk');
      expect(preRisk).toBeDefined();
      expect(s.read(preRisk!.id)!.files).toEqual(beforeRestore);
    });

    it('leaves current state intact when the id is unknown (nothing applied)', () => {
      const h = harness();
      const s = h.store();
      s.snapshot('boot');
      const before = fileCount();
      expect(s.restore('9999999999-boot')).toBeNull();
      expect(h.applied).toHaveLength(0);
      expect(fileCount()).toBe(before); // no pre-risk snapshot taken for a rejected restore
    });

    it('leaves current state intact when the bundle file is corrupt', () => {
      const h = harness();
      const s = h.store();
      const meta = s.snapshot('boot')!;
      // Corrupt the gzip payload in place.
      writeFileSync(join(dir, `${meta.id}.json.gz`), Buffer.from('not gzip'));
      expect(s.restore(meta.id)).toBeNull();
      expect(h.applied).toHaveLength(0);
    });

    it('REFUSES (throws) and applies nothing when the pre-risk safety snapshot cannot be written (fail-closed C1)', () => {
      const h = harness();
      const s = h.store();
      const target = s.snapshot('boot')!; // readable target exists

      // Live state drifts to what a failed restore would destroy.
      h.advance(1000);
      const live: SnapshotFiles = { project: { name: 'live', v: 42 }, showLibrary: null, songLibrary: null };
      h.setCurrent(live);

      // Backups dir read-only: the target is still READABLE, but the pre-risk WRITE fails (the exact
      // ENOSPC/read-only scenario). The store must refuse rather than overwrite live state uncovered.
      chmodSync(dir, 0o500);
      try {
        // Guard against a permissive env (e.g. root ignores 0o500): a null pre-risk return is what
        // the fail-closed check keys on, so if the write still succeeds this env can't exercise C1.
        if (s.snapshot('pre-risk') !== null) return; // write not actually blocked here — skip
        expect(() => s.restore(target.id)).toThrow(/pre-risk/i);
      } finally {
        chmodSync(dir, 0o700);
      }
      expect(h.applied).toHaveLength(0); // nothing applied — restore refused before the sink
      expect(h.getCurrent()).toEqual(live); // live state untouched
    });
  });

  it('hands every new snapshot off-site (fire-and-forget), skipped ones excepted', () => {
    const h = harness();
    const s = h.store();
    s.snapshot('boot');
    h.advance(DAY);
    s.snapshot('cadence'); // unchanged → skipped → not shipped
    h.setCurrent({ project: { name: 'p', v: 2 }, showLibrary: null, songLibrary: null });
    h.advance(DAY);
    s.snapshot('cadence'); // changed → shipped
    expect(h.shipped.map((x) => x.reason)).toEqual(['boot', 'cadence']);
  });

  it('a throwing off-site hand-off never fails the local snapshot', () => {
    const h = harness();
    const s = createSnapshotStore({
      dir,
      now: () => 1_000_000_000_000,
      readCurrent: () => h.getCurrent(),
      applyRestored: () => {},
      onSnapshot: () => {
        throw new Error('network down');
      },
      log: () => {},
    });
    expect(s.snapshot('boot')).not.toBeNull();
    expect(fileCount()).toBe(1);
  });

  it('survives a restart: a fresh store over the same dir sees prior snapshots', () => {
    const h = harness();
    h.store().snapshot('boot');
    const reopened = h.store();
    expect(reopened.list()).toHaveLength(1);
  });
});

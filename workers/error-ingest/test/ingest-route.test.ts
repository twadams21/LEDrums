import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { DISCORD_TIMEOUT_MS } from '../src/discord';
import { d1Store } from '../src/store';
import type { ExecutionContext } from '../src/cf';
import type { Env } from '../src/env';
import { wire } from './report-fixture';
import { sqliteD1 } from './sqlite-d1';

const databases: ReturnType<typeof sqliteD1>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setup() {
  const local = sqliteD1();
  databases.push(local);
  const pending: Promise<unknown>[] = [];
  const ctx: ExecutionContext = {
    waitUntil(promise) { expect(this).toBe(ctx); pending.push(promise); },
    passThroughOnException() {},
  };
  const env: Env = {
    DB: local.db, BACKUPS: {} as Env['BACKUPS'], TELEMETRY_TOKEN: 'test-token',
    DISCORD_WEBHOOK_URL: 'https://discord.invalid/private-webhook-token',
  };
  const post = () => worker.fetch(new Request('https://worker.invalid/ingest', {
    method: 'POST', headers: { authorization: 'Bearer test-token' },
    body: JSON.stringify({ reports: [wire('a'), wire('b'), wire('c')], dropped: 4 }),
  }), env, ctx);
  return { local, pending, post };
}

describe('POST /ingest → SQLite + actual notifier (network stubbed)', () => {
  it('overlapping requests respond and persist the whole batch before stalled webhooks settle', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetchFn);
    const s = setup();
    // No timer advancement before these responses: a request-critical notification would hang.
    const responses = await Promise.all([s.post(), s.post()]);
    const bodies = await Promise.all(responses.map((r) => r.json())) as { accepted: number; pinged: number }[];
    expect(responses.every((r) => r.status === 200)).toBe(true);
    expect(bodies.map((b) => b.accepted)).toEqual([3, 3]);
    expect(bodies.reduce((n, b) => n + b.pinged, 0)).toBe(3);
    expect(await d1Store(s.local.db).list({ limit: 100 })).toHaveLength(3);
    expect(s.pending).toHaveLength(3);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(DISCORD_TIMEOUT_MS);
    await Promise.all(s.pending);
    expect(fetchFn.mock.calls.every(([, init]) => init?.signal?.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(await (await s.post()).json()).toMatchObject({ accepted: 3, pinged: 0 });
    expect(fetchFn).toHaveBeenCalledTimes(3); // timeout does NOT release the claim or retry
  });

  it('failed Discord HTTP responses do not prevent later reports or scheduled attempts', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchFn = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('private-webhook-token', { status: 429 }))
      .mockRejectedValueOnce(new Error('private-webhook-token'))
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchFn);
    const s = setup();
    const response = await s.post();
    expect(await response.json()).toEqual({ accepted: 3, rateLimited: 0, pinged: 3, droppedUpstream: 4 });
    await Promise.all(s.pending);
    expect(await d1Store(s.local.db).list({ limit: 100 })).toHaveLength(3);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(console.warn).toHaveBeenCalledWith('[error-ingest] Discord HTTP 429');
    expect(console.warn).toHaveBeenCalledWith('[error-ingest] Discord request failed');
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('private-webhook-token');
    expect(await (await s.post()).json()).toMatchObject({ accepted: 3, pinged: 0 });
  });
});

import { describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import type { Env } from '../src/env';
import type { ExecutionContext } from '../src/cf';

// A stub env whose DB/R2 are never touched on the auth/404 paths under test (token rejection happens
// before any binding access). Full ingest/read/backup logic is covered at the handler level.
const env: Env = { DB: {} as Env['DB'], BACKUPS: {} as Env['BACKUPS'], TELEMETRY_TOKEN: 'secret' };
const ctx: ExecutionContext = { waitUntil() {}, passThroughOnException() {} };

describe('worker.fetch auth (#122)', () => {
  it('401s a request with no bearer token', async () => {
    const res = await worker.fetch(new Request('https://w/ingest', { method: 'POST' }), env, ctx);
    expect(res.status).toBe(401);
  });

  it('401s a wrong token', async () => {
    const res = await worker.fetch(
      new Request('https://w/reports', { headers: { authorization: 'Bearer nope' } }),
      env,
      ctx,
    );
    expect(res.status).toBe(401);
  });

  it('404s an authed unknown route', async () => {
    const res = await worker.fetch(
      new Request('https://w/nope', { headers: { authorization: 'Bearer secret' } }),
      env,
      ctx,
    );
    expect(res.status).toBe(404);
  });

  it('400s an authed ingest with invalid JSON', async () => {
    const res = await worker.fetch(
      new Request('https://w/ingest', {
        method: 'POST',
        headers: { authorization: 'Bearer secret' },
        body: 'not json',
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(400);
  });
});

// A valid single-report batch — enough to get past auth, size and validation and reach the store.
const oneReport = JSON.stringify({
  reports: [
    {
      dedupKey: 'k',
      envelope: {
        machine: 'm',
        version: '1.0.0',
        engineMode: 'voice',
        platform: 'darwin',
        osRelease: '24.6.0',
        session: 's',
        uptimeMs: 1,
        origin: 'server',
      },
      message: 'boom',
      breadcrumbs: [],
      count: 1,
      firstSeenMs: 1,
      lastSeenMs: 1,
    },
  ],
  dropped: 0,
});

const authedPost = (path: string, body: string): Request =>
  new Request(`https://w${path}`, {
    method: 'POST',
    headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
    body,
  });

describe('worker.fetch fault boundary (#137 INIT-11 S1)', () => {
  it('returns 503 JSON when D1 faults', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const faulty: Env = {
      ...env,
      DB: {
        prepare() {
          throw new Error('D1_ERROR: too many requests');
        },
      } as unknown as Env['DB'],
    };
    const res = await worker.fetch(authedPost('/ingest', oneReport), faulty, ctx);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'storage unavailable', detail: 'D1_ERROR: too many requests' });
  });

  it('returns 503 JSON when R2 faults', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const faulty: Env = {
      ...env,
      BACKUPS: {
        put() {
          throw new Error('R2 unavailable');
        },
      } as unknown as Env['BACKUPS'],
    };
    const body = JSON.stringify({
      reports: [{ machine: 'm', key: '2026-01-01T00-00-00-manual', createdAt: 1, reason: 'manual', bundle: { a: 1 } }],
      dropped: 0,
    });
    const res = await worker.fetch(authedPost('/backups', body), faulty, ctx);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'storage unavailable', detail: 'R2 unavailable' });
  });

  it('rejects an oversized declared content-length WITHOUT reading the body', async () => {
    // Spying on body consumption is the only honest proof of the pre-buffer reject: a store spy is
    // vacuously un-called on the post-buffer 413 path too, so it proves nothing about buffering.
    const text = vi.fn(async () => '{}');
    const req = {
      method: 'POST',
      url: 'https://w/ingest',
      headers: new Headers({ authorization: 'Bearer secret', 'content-length': '99999999' }),
      text,
    } as unknown as Request;
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(413);
    expect(text).not.toHaveBeenCalled();
  });

  it('counts bytes, not UTF-16 code units, against the body cap', async () => {
    // 400k emoji = 800k UTF-16 units (under the 1M cap by the old measure) but 1.6MB of UTF-8.
    // No content-length header, so only the authoritative post-read byte check can catch it.
    const req = {
      method: 'POST',
      url: 'https://w/ingest',
      headers: new Headers({ authorization: 'Bearer secret' }),
      text: async () => '🥁'.repeat(400_000),
    } as unknown as Request;
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'payload too large' });
  });
});

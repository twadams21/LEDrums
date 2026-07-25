import { describe, expect, it } from 'vitest';
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

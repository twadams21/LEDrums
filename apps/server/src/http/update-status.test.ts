import { describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { compareVersions, createUpdateStatusHandler, UPDATE_STATUS_PATH } from './update-status';

/* S05 handler-seam tests: the OTA update-status route, extracted from main.ts behind a dep-injected
   factory. compareVersions is table-driven; the handler branches (route miss, wrong method,
   unconfigured, newer/older manifest, fetch failure) are exercised with fake req/res + injected
   fetch — no server boot, no network. */

/** A fake response capturing the single writeHead/end pair the handlers emit. */
class FakeRes {
  status: number | undefined;
  headers: Record<string, string> | undefined;
  body: string | undefined;
  headersSent = false;
  writeHead(status: number, headers: Record<string, string>): this {
    this.status = status;
    this.headers = headers;
    this.headersSent = true;
    return this;
  }
  end(body: string): void {
    this.body = body;
  }
  json(): unknown {
    return this.body === undefined ? undefined : JSON.parse(this.body);
  }
}

function req(method: string, path = UPDATE_STATUS_PATH): IncomingMessage {
  return { method, url: path } as unknown as IncomingMessage;
}

/** Flush the microtask queue so the handler's fire-and-forget async manifest fetch settles. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('compareVersions', () => {
  const cases: Array<[string, string, number]> = [
    ['1.0.0', '1.0.0', 0],
    ['1.2.0', '1.1.9', 1],
    ['1.1.9', '1.2.0', -1],
    ['2.0.0', '1.9.9', 1],
    ['1.0', '1.0.0', 0], // missing components read as 0
    ['1.0.1', '1.0', 1],
    ['1.2-3', '1.2.2', 1], // dash and dot are both separators
    ['1.2.3', '1.2-3', 0],
    ['1.0.0', 'v1.0.0', 1], // non-numeric component reads as 0 → 1 > 0 at index 0
    ['', '', 0],
    ['10.0.0', '9.0.0', 1], // numeric, not lexicographic
  ];
  it.each(cases)('compareVersions(%s, %s) === %i', (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected);
  });

  it('is antisymmetric for ordered pairs', () => {
    expect(compareVersions('1.2.0', '1.1.0')).toBe(1);
    expect(compareVersions('1.1.0', '1.2.0')).toBe(-1);
  });
});

describe('createUpdateStatusHandler', () => {
  it('returns false for a non-matching route', () => {
    const handler = createUpdateStatusHandler({ endpoint: 'http://ota', currentVersion: '1.0.0' });
    const res = new FakeRes();
    expect(handler(req('GET', '/other'), res as unknown as ServerResponse)).toBe(false);
    expect(res.status).toBeUndefined();
  });

  it('405s a non-GET method', () => {
    const handler = createUpdateStatusHandler({ endpoint: 'http://ota', currentVersion: '1.0.0' });
    const res = new FakeRes();
    expect(handler(req('POST'), res as unknown as ServerResponse)).toBe(true);
    expect(res.status).toBe(405);
    expect(res.json()).toMatchObject({ available: false, error: 'method not allowed' });
  });

  it('reports unavailable (200) when OTA is unconfigured', () => {
    const handler = createUpdateStatusHandler({ endpoint: undefined, currentVersion: '1.0.0' });
    const res = new FakeRes();
    handler(req('GET'), res as unknown as ServerResponse);
    expect(res.status).toBe(200);
    expect(res.json()).toMatchObject({ available: false, currentVersion: '1.0.0', error: 'OTA status is unavailable on this server.' });
  });

  it('reports unavailable (200) when the current version is unknown', () => {
    const handler = createUpdateStatusHandler({ endpoint: 'http://ota', currentVersion: null });
    const res = new FakeRes();
    handler(req('GET'), res as unknown as ServerResponse);
    expect(res.status).toBe(200);
    expect(res.json()).toMatchObject({ available: false, currentVersion: null });
  });

  it('reports an available update when the manifest version is newer', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ version: '2.0.0' }) });
    const handler = createUpdateStatusHandler({ endpoint: 'http://ota', currentVersion: '1.0.0', fetchImpl: fetchImpl as unknown as typeof fetch });
    const res = new FakeRes();
    handler(req('GET'), res as unknown as ServerResponse);
    await flush();
    expect(fetchImpl).toHaveBeenCalledWith('http://ota', { redirect: 'follow' });
    expect(res.status).toBe(200);
    expect(res.json()).toEqual({ available: true, version: '2.0.0', currentVersion: '1.0.0', canInstall: false });
  });

  it('reports no update when the manifest version is not newer', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ version: '1.0.0' }) });
    const handler = createUpdateStatusHandler({ endpoint: 'http://ota', currentVersion: '1.0.0', fetchImpl: fetchImpl as unknown as typeof fetch });
    const res = new FakeRes();
    handler(req('GET'), res as unknown as ServerResponse);
    await flush();
    expect(res.json()).toMatchObject({ available: false, version: '1.0.0' });
  });

  it('replies 200 with an error field when the manifest fetch fails (never a 5xx)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({}) });
    const handler = createUpdateStatusHandler({ endpoint: 'http://ota', currentVersion: '1.0.0', fetchImpl: fetchImpl as unknown as typeof fetch });
    const res = new FakeRes();
    handler(req('GET'), res as unknown as ServerResponse);
    await flush();
    expect(res.status).toBe(200);
    expect(res.json()).toMatchObject({ available: false, version: null, currentVersion: '1.0.0', error: 'manifest returned 503' });
  });

  it('replies 200 with an error field when fetch throws', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
    const handler = createUpdateStatusHandler({ endpoint: 'http://ota', currentVersion: '1.0.0', fetchImpl: fetchImpl as unknown as typeof fetch });
    const res = new FakeRes();
    handler(req('GET'), res as unknown as ServerResponse);
    await flush();
    expect(res.status).toBe(200);
    expect(res.json()).toMatchObject({ available: false, error: 'network down' });
  });
});

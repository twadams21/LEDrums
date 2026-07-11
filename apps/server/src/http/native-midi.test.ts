import { describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createNativeMidiHandler, isNativeMidiMessage, NATIVE_MIDI_PATH, type NativeMidiDeps } from './native-midi';
import type { ClientMessage } from '../ws-protocol';

/* S05 handler-seam tests: the native-MIDI POST route, extracted from main.ts behind a dep-injected
   factory. A fake req (POST body via emitted 'data'/'end') + fake res exercise every branch —
   route miss, wrong method, untrusted peer, oversized/undecodable/unsupported payloads, and the
   happy path that dispatches into the injected WS handler. No server boot, no sockets. */

const TOKEN = 'host-secret-token';

/** A fake response capturing the single writeHead/end pair the handler emits. */
class FakeRes {
  status: number | undefined;
  body: string | undefined;
  headersSent = false;
  writeHead(status: number): this {
    this.status = status;
    this.headersSent = true;
    return this;
  }
  end(body: string): void {
    this.body = body;
  }
}

/** A fake request that records event handlers so the test can drive the body stream. Trusted-host
 * defaults: loopback peer, no cloudflare headers, url carrying the exact host token. */
class FakeReq {
  method: string;
  url: string;
  headers: Record<string, string> = {};
  socket = { remoteAddress: '127.0.0.1' };
  private handlers: Record<string, (arg?: unknown) => void> = {};
  destroyed?: Error;
  constructor(opts: { method?: string; path?: string; token?: string | null } = {}) {
    this.method = opts.method ?? 'POST';
    const path = opts.path ?? NATIVE_MIDI_PATH;
    const token = opts.token === undefined ? TOKEN : opts.token;
    this.url = token === null ? path : `${path}?hostToken=${token}`;
  }
  setEncoding(): void {}
  on(event: string, cb: (arg?: unknown) => void): this {
    this.handlers[event] = cb;
    return this;
  }
  destroy(err: Error): void {
    this.destroyed = err;
    this.handlers.error?.(err);
  }
  /** Feed a body then end the stream (drives the handler's decode/dispatch). */
  send(body: string): void {
    this.handlers.data?.(body);
    if (!this.destroyed) this.handlers.end?.();
  }
}

function deps(overrides: Partial<NativeMidiDeps> = {}): NativeMidiDeps {
  return {
    hostToken: TOKEN,
    monitorInput: vi.fn(),
    dispatch: vi.fn(),
    monitor: vi.fn(),
    ...overrides,
  };
}

describe('isNativeMidiMessage', () => {
  it.each(['midi', 'cc', 'programChange'] as const)('accepts %s', (t) => {
    expect(isNativeMidiMessage({ t } as ClientMessage)).toBe(true);
  });
  it.each(['osc', 'takeover', 'listProjects', 'setProject'] as const)('rejects %s', (t) => {
    expect(isNativeMidiMessage({ t } as ClientMessage)).toBe(false);
  });
});

describe('createNativeMidiHandler', () => {
  it('returns false for a non-matching route', () => {
    const handler = createNativeMidiHandler(deps());
    const req = new FakeReq({ path: '/other' });
    const res = new FakeRes();
    expect(handler(req as unknown as IncomingMessage, res as unknown as ServerResponse)).toBe(false);
    expect(res.status).toBeUndefined();
  });

  it('405s a non-POST method', () => {
    const handler = createNativeMidiHandler(deps());
    const req = new FakeReq({ method: 'GET' });
    const res = new FakeRes();
    expect(handler(req as unknown as IncomingMessage, res as unknown as ServerResponse)).toBe(true);
    expect(res.status).toBe(405);
    expect(res.body).toBe('method not allowed');
  });

  it('401s an untrusted peer (missing host token)', () => {
    const d = deps();
    const handler = createNativeMidiHandler(d);
    const req = new FakeReq({ token: null });
    const res = new FakeRes();
    handler(req as unknown as IncomingMessage, res as unknown as ServerResponse);
    expect(res.status).toBe(401);
    expect(res.body).toBe('unauthorized');
    expect(d.dispatch).not.toHaveBeenCalled();
  });

  it('dispatches a valid MIDI message and replies 204', () => {
    const d = deps();
    const handler = createNativeMidiHandler(d);
    const req = new FakeReq();
    const res = new FakeRes();
    handler(req as unknown as IncomingMessage, res as unknown as ServerResponse);
    const msg = { t: 'midi', note: 60, velocity: 100, on: true };
    req.send(JSON.stringify(msg));
    expect(d.monitorInput).toHaveBeenCalledWith(expect.objectContaining({ t: 'midi', note: 60 }));
    expect(d.dispatch).toHaveBeenCalledWith(expect.objectContaining({ t: 'midi', note: 60 }));
    expect(res.status).toBe(204);
    expect(res.body).toBe('');
  });

  it('400s a decodable-but-unsupported client message without dispatching', () => {
    const d = deps();
    const handler = createNativeMidiHandler(d);
    const req = new FakeReq();
    const res = new FakeRes();
    handler(req as unknown as IncomingMessage, res as unknown as ServerResponse);
    req.send(JSON.stringify({ t: 'listProjects' }));
    expect(res.status).toBe(400);
    expect(res.body).toBe('unsupported native MIDI message');
    expect(d.dispatch).not.toHaveBeenCalled();
  });

  it('400s an undecodable payload and records a monitor error', () => {
    const d = deps();
    const handler = createNativeMidiHandler(d);
    const req = new FakeReq();
    const res = new FakeRes();
    handler(req as unknown as IncomingMessage, res as unknown as ServerResponse);
    req.send('{ not json');
    expect(res.status).toBe(400);
    expect(d.monitor).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', source: 'server/native-midi' }));
    expect(d.dispatch).not.toHaveBeenCalled();
  });

  it('destroys the request when the body exceeds the 4KB cap', () => {
    const handler = createNativeMidiHandler(deps());
    const req = new FakeReq();
    const res = new FakeRes();
    handler(req as unknown as IncomingMessage, res as unknown as ServerResponse);
    req.send('x'.repeat(5000));
    expect(req.destroyed).toBeInstanceOf(Error);
    expect(res.status).toBe(400);
    expect(res.body).toBe('bad request');
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createTrustedPostRoute } from './trusted-post';

const TOKEN = 'host-secret-token';
const PATH = '/api/test-route';

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

class FakeReq {
  method: string;
  url: string;
  headers: Record<string, string> = {};
  socket = { remoteAddress: '127.0.0.1' };
  handlers: Record<string, (arg?: unknown) => void> = {};
  destroyed?: Error;
  constructor(opts: { method?: string; path?: string; token?: string | null } = {}) {
    this.method = opts.method ?? 'POST';
    const path = opts.path ?? PATH;
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
  send(body: string): void {
    this.handlers.data?.(body);
    if (!this.destroyed) this.handlers.end?.();
  }
}

function route(overrides: Partial<Parameters<typeof createTrustedPostRoute>[0]> = {}) {
  const onBody = vi.fn();
  const handler = createTrustedPostRoute({
    path: PATH,
    hostToken: TOKEN,
    maxBody: 100,
    tooLargeMessage: 'test payload too large',
    onBody,
    ...overrides,
  });
  return { handler, onBody };
}

function run(handler: (req: IncomingMessage, res: ServerResponse) => boolean, req: FakeReq, res: FakeRes) {
  return handler(req as unknown as IncomingMessage, res as unknown as ServerResponse);
}

describe('createTrustedPostRoute', () => {
  it('falls through (returns false) on a non-matching path', () => {
    const { handler, onBody } = route();
    const res = new FakeRes();
    expect(run(handler, new FakeReq({ path: '/other' }), res)).toBe(false);
    expect(res.status).toBeUndefined();
    expect(onBody).not.toHaveBeenCalled();
  });

  it('405s a non-POST method', () => {
    const { handler } = route();
    const res = new FakeRes();
    expect(run(handler, new FakeReq({ method: 'GET' }), res)).toBe(true);
    expect(res.status).toBe(405);
    expect(res.body).toBe('method not allowed');
  });

  it('401s an untrusted peer', () => {
    const { handler, onBody } = route();
    const res = new FakeRes();
    run(handler, new FakeReq({ token: null }), res);
    expect(res.status).toBe(401);
    expect(res.body).toBe('unauthorized');
    expect(onBody).not.toHaveBeenCalled();
  });

  it('destroys an over-cap body with the caller-supplied message', () => {
    const { handler, onBody } = route();
    const req = new FakeReq();
    const res = new FakeRes();
    run(handler, req, res);
    req.send('x'.repeat(101));
    expect(req.destroyed).toBeInstanceOf(Error);
    expect(req.destroyed?.message).toBe('test payload too large');
    expect(res.status).toBe(400);
    expect(onBody).not.toHaveBeenCalled();
  });

  it("400s when the request stream errors before end", () => {
    const { handler, onBody } = route();
    const req = new FakeReq();
    const res = new FakeRes();
    run(handler, req, res);
    req.handlers.error?.(new Error('socket reset'));
    expect(res.status).toBe(400);
    expect(res.body).toBe('bad request');
    expect(onBody).not.toHaveBeenCalled();
  });

  it('invokes onBody exactly once with the accumulated body on the happy path', () => {
    const { handler, onBody } = route();
    const req = new FakeReq();
    const res = new FakeRes();
    run(handler, req, res);
    req.handlers.data?.('hello ');
    req.handlers.data?.('world');
    req.handlers.end?.();
    expect(onBody).toHaveBeenCalledTimes(1);
    expect(onBody).toHaveBeenCalledWith('hello world', res);
  });
});

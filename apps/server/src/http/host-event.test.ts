import { describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  createHostEventHandler,
  hostEventToMonitorDraft,
  HOST_EVENT_PATH,
  parseHostEvent,
  type HostEventDeps,
} from './host-event';

/* #139: the desktop shell's route for reporting its OWN diagnostics into the server Monitor bus —
   above all "the LEDrums MIDI destination failed to start", which previously went to an eprintln!
   that a packaged .app launched from Finder never shows anyone. Same trust fence as the native-MIDI
   route: loopback, not via cloudflared, exact host token. */

const TOKEN = 'host-secret-token';

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
  private handlers: Record<string, (arg?: unknown) => void> = {};
  destroyed?: Error;
  constructor(opts: { method?: string; path?: string; token?: string | null; remoteAddress?: string } = {}) {
    this.method = opts.method ?? 'POST';
    const path = opts.path ?? HOST_EVENT_PATH;
    const token = opts.token === undefined ? TOKEN : opts.token;
    this.url = token === null ? path : `${path}?hostToken=${token}`;
    if (opts.remoteAddress !== undefined) this.socket.remoteAddress = opts.remoteAddress;
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

function harness(overrides: Partial<HostEventDeps> = {}) {
  const monitor = vi.fn();
  const handler = createHostEventHandler({ hostToken: TOKEN, monitor, ...overrides });
  const run = (req: FakeReq, body?: string) => {
    const res = new FakeRes();
    const owned = handler(req as unknown as IncomingMessage, res as unknown as ServerResponse);
    if (owned && body !== undefined) req.send(body);
    return { owned, res };
  };
  return { monitor, run };
}

describe('parseHostEvent', () => {
  it('accepts a minimal info event', () => {
    expect(parseHostEvent('{"level":"info","label":"ready"}')).toEqual({ level: 'info', label: 'ready' });
  });

  it('carries optional detail and source through', () => {
    expect(parseHostEvent('{"level":"error","label":"boom","detail":"why","source":"desktop/native-midi"}')).toEqual({
      level: 'error',
      label: 'boom',
      detail: 'why',
      source: 'desktop/native-midi',
    });
  });

  it('rejects an unknown level rather than coercing it', () => {
    // Fail-closed: a shell bug must never silently downgrade an error into a quiet system line.
    expect(parseHostEvent('{"level":"warn","label":"x"}')).toBeNull();
    expect(parseHostEvent('{"label":"x"}')).toBeNull();
  });

  it('rejects a missing or empty label', () => {
    expect(parseHostEvent('{"level":"info"}')).toBeNull();
    expect(parseHostEvent('{"level":"info","label":""}')).toBeNull();
  });

  it('rejects non-string detail/source', () => {
    expect(parseHostEvent('{"level":"info","label":"x","detail":5}')).toBeNull();
    expect(parseHostEvent('{"level":"info","label":"x","source":true}')).toBeNull();
  });

  it('rejects malformed JSON and non-objects', () => {
    expect(parseHostEvent('not json')).toBeNull();
    expect(parseHostEvent('null')).toBeNull();
    expect(parseHostEvent('[1,2]')).toBeNull();
  });
});

describe('hostEventToMonitorDraft', () => {
  it('maps an error level onto a Monitor error event', () => {
    expect(hostEventToMonitorDraft({ level: 'error', label: 'failed', detail: 'why', source: 'desktop/native-midi' })).toEqual({
      type: 'error',
      direction: 'local',
      source: 'desktop/native-midi',
      label: 'failed',
      detail: 'why',
    });
  });

  it('maps an info level onto a Monitor system event and defaults the source', () => {
    expect(hostEventToMonitorDraft({ level: 'info', label: 'ready' })).toEqual({
      type: 'system',
      direction: 'local',
      source: 'desktop',
      label: 'ready',
    });
  });
});

describe('createHostEventHandler', () => {
  it('does not own a request for another path', () => {
    const { run, monitor } = harness();
    const { owned } = run(new FakeReq({ path: '/api/something-else' }));
    expect(owned).toBe(false);
    expect(monitor).not.toHaveBeenCalled();
  });

  it('emits the Monitor event and answers 204 on the happy path', () => {
    const { run, monitor } = harness();
    const { owned, res } = run(new FakeReq(), '{"level":"error","label":"MIDI destination failed to start","detail":"create virtual MIDI destination: boom"}');
    expect(owned).toBe(true);
    expect(res.status).toBe(204);
    expect(monitor).toHaveBeenCalledWith({
      type: 'error',
      direction: 'local',
      source: 'desktop',
      label: 'MIDI destination failed to start',
      detail: 'create virtual MIDI destination: boom',
    });
  });

  it('rejects a non-POST method', () => {
    const { run, monitor } = harness();
    const { res } = run(new FakeReq({ method: 'GET' }));
    expect(res.status).toBe(405);
    expect(monitor).not.toHaveBeenCalled();
  });

  it('rejects a caller without the host token', () => {
    const { run, monitor } = harness();
    expect(run(new FakeReq({ token: null }), '{"level":"info","label":"x"}').res.status).toBe(401);
    expect(run(new FakeReq({ token: 'wrong' }), '{"level":"info","label":"x"}').res.status).toBe(401);
    expect(monitor).not.toHaveBeenCalled();
  });

  it('rejects a non-loopback peer even with the right token', () => {
    const { run, monitor } = harness();
    const { res } = run(new FakeReq({ remoteAddress: '192.168.1.50' }), '{"level":"info","label":"x"}');
    expect(res.status).toBe(401);
    expect(monitor).not.toHaveBeenCalled();
  });

  it('rejects a request forwarded through the tunnel', () => {
    const { run, monitor } = harness();
    const req = new FakeReq();
    req.headers['cf-connecting-ip'] = '203.0.113.7';
    const { res } = run(req, '{"level":"info","label":"x"}');
    expect(res.status).toBe(401);
    expect(monitor).not.toHaveBeenCalled();
  });

  it('rejects everything when no host token was minted', () => {
    const { run, monitor } = harness({ hostToken: null });
    const { res } = run(new FakeReq(), '{"level":"info","label":"x"}');
    expect(res.status).toBe(401);
    expect(monitor).not.toHaveBeenCalled();
  });

  it('answers 400 without emitting for a malformed body', () => {
    const { run, monitor } = harness();
    const { res } = run(new FakeReq(), '{"level":"nope","label":"x"}');
    expect(res.status).toBe(400);
    expect(monitor).not.toHaveBeenCalled();
  });

  it('destroys an oversized body instead of buffering it', () => {
    const { run, monitor } = harness();
    const req = new FakeReq();
    const res = new FakeRes();
    createHostEventHandler({ hostToken: TOKEN, monitor })(
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
    );
    req.send('x'.repeat(4096));
    expect(req.destroyed).toBeInstanceOf(Error);
    expect(res.status).toBe(400);
    expect(monitor).not.toHaveBeenCalled();
  });
});

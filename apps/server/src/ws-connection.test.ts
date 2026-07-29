import { describe, expect, it, vi } from 'vitest';
import { WS_CLOSE_INVALID_PIN } from '@ledrums/protocol';
import { ClientRegistry } from './client-registry';
import { createMutablePinGate } from './pin-gate';
import { createMonitorBus } from './monitor';
import type { ServerMessage } from './ws-protocol';
import { createWsConnectionHandler, type ConnectionRequest, type ConnectionSocket, type WsConnectionDeps } from './ws-connection';

/** Fake socket: records sends/closes and lets tests fire message/close/error events. */
class FakeSocket implements ConnectionSocket {
  readonly OPEN = 1;
  readyState = 1;
  readonly sent: { data: string | Uint8Array; binary: boolean }[] = [];
  closed: { code?: number; reason?: string } | null = null;
  handlers: Record<string, (...args: unknown[]) => void> = {};
  pings = 0;
  terminated = false;
  ping(): void {
    this.pings++;
  }
  terminate(): void {
    this.terminated = true;
    this.readyState = 3;
  }
  send(data: string | Uint8Array, opts?: { binary?: boolean }): void {
    this.sent.push({ data, binary: opts?.binary ?? false });
  }
  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
    this.readyState = 3;
  }
  on(event: string, cb: (...args: never[]) => void): void {
    this.handlers[event] = cb as (...args: unknown[]) => void;
  }
  types(): string[] {
    return this.sent.filter((m) => !m.binary).map((m) => (JSON.parse(m.data as string) as { t: string }).t);
  }
  emitMessage(raw: string, isBinary = false): void {
    this.handlers.message?.(({ toString: () => raw }) as never, isBinary as never);
  }
}

function req(overrides: Partial<ConnectionRequest> = {}): ConnectionRequest {
  return { socket: { remoteAddress: '127.0.0.1' }, headers: {}, url: '/ws', ...overrides };
}

function harness(opts: { pin?: string | null; deps?: Partial<WsConnectionDeps<FakeSocket>> } = {}) {
  const clients = new ClientRegistry<FakeSocket>();
  const bus = createMonitorBus(() => {});
  const events: { type: string; label: string; detail?: string }[] = [];
  const ordered: string[] = [];
  const tunnelTagged: FakeSocket[] = [];
  const handled: unknown[] = [];
  const dropped: FakeSocket[] = [];
  const handler = createWsConnectionHandler<FakeSocket>({
    hostToken: null,
    pinGate: createMutablePinGate(opts.pin ?? null),
    clients,
    tunnelClients: { add: (ws) => tunnelTagged.push(ws) },
    monitor: (e) => {
      events.push(e as { type: string; label: string; detail?: string });
      bus.emit(e);
      ordered.push(`monitor:${e.label}`);
    },
    broadcastPresence: () => ordered.push('presence'),
    stateMessage: (): ServerMessage => {
      ordered.push('state');
      return { t: 'projects', names: ['state-stand-in'] } as ServerMessage;
    },
    replayMonitor: (sendOne) => {
      ordered.push('replay');
      bus.replay(sendOne);
    },
    monitorInput: () => {},
    handleClientMessage: (msg) => handled.push(msg),
    dropWatcher: (ws) => dropped.push(ws),
    log: () => {},
    ...opts.deps,
  });
  return { handler, clients, events, ordered, tunnelTagged, handled, dropped };
}

describe('createWsConnectionHandler (S12 — pins today\'s contract)', () => {
  it('a wrong PIN closes with the invalid-pin code and never admits', () => {
    const { handler, clients, ordered } = harness({ pin: '123456' });
    const ws = new FakeSocket();
    handler(ws, req({ url: '/ws?pin=999999' }));
    expect(ws.closed).toEqual({ code: WS_CLOSE_INVALID_PIN, reason: 'invalid pin' });
    expect([...clients]).toHaveLength(0);
    expect(ordered).toEqual([]); // no presence, no state, no monitor
  });

  it('a cf-forwarded connection is tagged as a tunnel client', () => {
    const { handler, tunnelTagged } = harness();
    const ws = new FakeSocket();
    handler(ws, req({ headers: { 'cf-connecting-ip': '1.2.3.4' }, socket: { remoteAddress: '10.0.0.9' } }));
    expect(tunnelTagged).toEqual([ws]);
  });

  it('ORDER is accepted-monitor → presence → state → replay (load-bearing, previously unproven)', () => {
    const { handler, ordered } = harness();
    handler(new FakeSocket(), req());
    expect(ordered).toEqual(['monitor:WebSocket client accepted', 'presence', 'state', 'replay']);
  });

  it('replay delivers the retained monitor history to the new socket', () => {
    const { handler } = harness();
    const ws = new FakeSocket();
    handler(ws, req());
    // 'WebSocket client accepted' was emitted onto the bus pre-replay, so it replays.
    expect(ws.types()).toContain('monitor');
  });

  it('a binary frame is ignored', () => {
    const { handler, handled } = harness();
    const ws = new FakeSocket();
    handler(ws, req());
    const before = ws.sent.length;
    ws.emitMessage('{"t":"listProjects"}', true);
    expect(handled).toEqual([]);
    expect(ws.sent.length).toBe(before);
  });

  it('a decode failure emits a decode-error monitor event AND an error frame, socket stays open', () => {
    const { handler, events } = harness();
    const ws = new FakeSocket();
    handler(ws, req());
    ws.emitMessage('{ not json');
    expect(events.some((e) => e.label === 'WebSocket decode error')).toBe(true);
    expect(ws.types()).toContain('error');
    expect(ws.closed).toBeNull();
  });

  it('a handler throw emits a handler-error monitor event', () => {
    const { handler, events } = harness({
      deps: {
        handleClientMessage: () => {
          throw new Error('handler exploded');
        },
      },
    });
    const ws = new FakeSocket();
    handler(ws, req());
    ws.emitMessage('{"t":"listProjects"}');
    expect(events.some((e) => e.label === 'WebSocket handler error' && e.detail === 'handler exploded')).toBe(true);
    expect(ws.types()).toContain('error');
    expect(ws.closed).toBeNull();
  });

  it.each(['close', 'error'] as const)('%s removes the client, drops its watcher, re-broadcasts presence', (event) => {
    const { handler, clients, ordered, dropped } = harness();
    const ws = new FakeSocket();
    handler(ws, req());
    expect([...clients]).toHaveLength(1);
    ordered.length = 0;
    ws.handlers[event]?.();
    expect([...clients]).toHaveLength(0);
    expect(dropped).toEqual([ws]);
    expect(ordered).toEqual(['presence']);
  });
});

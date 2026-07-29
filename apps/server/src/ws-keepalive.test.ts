import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWsKeepalive, HEARTBEAT_MS, type KeepaliveSocket } from './ws-keepalive';

class FakeSocket implements KeepaliveSocket {
  pings = 0;
  terminated = false;
  private pongCb: (() => void) | null = null;
  ping(): void {
    this.pings++;
  }
  terminate(): void {
    this.terminated = true;
  }
  on(_event: 'pong', cb: () => void): void {
    this.pongCb = cb;
  }
  pong(): void {
    this.pongCb?.();
  }
}

function harness() {
  const dead: FakeSocket[] = [];
  const keepalive = createWsKeepalive<FakeSocket>({ onDead: (ws) => dead.push(ws) });
  return { keepalive, dead };
}

describe('createWsKeepalive (S13)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('the sweep period is the named constant (a value change is a visible test change)', () => {
    expect(HEARTBEAT_MS).toBe(15_000);
  });

  it('a socket that never pongs is terminated on the SECOND sweep and reaped via onDead', () => {
    vi.useFakeTimers();
    const { keepalive, dead } = harness();
    const ws = new FakeSocket();
    keepalive.admit(ws);
    vi.advanceTimersByTime(HEARTBEAT_MS); // sweep 1: alive→false, ping
    expect(ws.terminated).toBe(false);
    expect(ws.pings).toBe(1);
    vi.advanceTimersByTime(HEARTBEAT_MS); // sweep 2: no pong since → terminate
    expect(ws.terminated).toBe(true);
    expect(dead).toEqual([ws]);
    keepalive.dispose();
  });

  it('a socket that pongs after each ping survives 10 sweeps', () => {
    vi.useFakeTimers();
    const { keepalive, dead } = harness();
    const ws = new FakeSocket();
    keepalive.admit(ws);
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(HEARTBEAT_MS);
      ws.pong();
    }
    expect(ws.terminated).toBe(false);
    expect(dead).toEqual([]);
    expect(ws.pings).toBe(10);
    keepalive.dispose();
  });

  it('a socket admitted mid-sweep is NOT terminated on the immediately following sweep', () => {
    vi.useFakeTimers();
    const { keepalive } = harness();
    const early = new FakeSocket();
    keepalive.admit(early);
    vi.advanceTimersByTime(HEARTBEAT_MS - 1); // just before a sweep fires
    const newcomer = new FakeSocket();
    keepalive.admit(newcomer); // alive flag starts TRUE
    vi.advanceTimersByTime(1); // the sweep fires now
    expect(newcomer.terminated).toBe(false); // pinged, not reaped — the classic off-by-one
    expect(newcomer.pings).toBe(1);
    keepalive.dispose();
  });

  it('dispose stops the sweep (and the disposer is what boot.ts calls on shutdown)', () => {
    vi.useFakeTimers();
    const { keepalive } = harness();
    const ws = new FakeSocket();
    keepalive.admit(ws);
    keepalive.dispose();
    vi.advanceTimersByTime(HEARTBEAT_MS * 5);
    expect(ws.pings).toBe(0);
    expect(ws.terminated).toBe(false);
  });

  it('the interval never keeps the process alive (unref)', () => {
    // Real timers: assert the created interval is unref'd.
    const spy = vi.spyOn(globalThis, 'setInterval');
    const keepalive = createWsKeepalive<FakeSocket>({ onDead: () => {} });
    const timer = spy.mock.results[0]!.value as { hasRef?: () => boolean };
    expect(typeof timer.hasRef).toBe('function');
    expect(timer.hasRef!()).toBe(false);
    keepalive.dispose();
    spy.mockRestore();
  });

  it('onSweep fires once per sweep AFTER the reap pass (S14 strike clock)', () => {
    vi.useFakeTimers();
    const order: string[] = [];
    const keepalive = createWsKeepalive<FakeSocket>({
      onDead: () => order.push('dead'),
      onSweep: () => order.push('sweep'),
    });
    const ws = new FakeSocket();
    keepalive.admit(ws);
    vi.advanceTimersByTime(HEARTBEAT_MS * 2); // sweep 1 pings, sweep 2 reaps
    expect(order).toEqual(['sweep', 'dead', 'sweep']);
    keepalive.dispose();
  });

  it('forget() removes a socket from the sweep (normal close path)', () => {
    vi.useFakeTimers();
    const { keepalive, dead } = harness();
    const ws = new FakeSocket();
    keepalive.admit(ws);
    keepalive.forget(ws);
    vi.advanceTimersByTime(HEARTBEAT_MS * 3);
    expect(ws.pings).toBe(0);
    expect(ws.terminated).toBe(false);
    expect(dead).toEqual([]);
    keepalive.dispose();
  });
});

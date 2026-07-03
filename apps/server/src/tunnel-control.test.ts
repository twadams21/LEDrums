import { describe, expect, it, vi } from 'vitest';
import { TunnelManager, type TunnelConfig, type TunnelProcess } from './tunnel-manager';
import { describeTunnelError, TunnelControl, type TunnelReport } from './tunnel-control';

/* In-app tunnel lifecycle (item 4). The control is driven with a REAL TunnelManager over a fake
   spawner (same seam as tunnel-manager.test.ts), so status transitions reflect the actual manager
   behavior: off → starting → live on URL, → error on spawn failure, stop → off, restartable. */

type Listener = (...args: never[]) => void;

/** A scriptable fake cloudflared child (mirrors the tunnel-manager test fake). */
class FakeProc implements TunnelProcess {
  private listeners = new Map<string, Listener[]>();
  killed = false;
  readonly stdout = {
    on: (event: 'data', l: (chunk: Buffer | string) => void) => this.add(`stdout:${event}`, l as Listener),
  };
  readonly stderr = {
    on: (event: 'data', l: (chunk: Buffer | string) => void) => this.add(`stderr:${event}`, l as Listener),
  };
  on(event: string, l: Listener): void {
    this.add(event, l);
  }
  kill(): boolean {
    this.killed = true;
    return true;
  }
  emit(event: string, ...args: unknown[]): void {
    for (const l of this.listeners.get(event) ?? []) (l as (...a: unknown[]) => void)(...args);
  }
  private add(event: string, l: Listener): void {
    const list = this.listeners.get(event) ?? [];
    list.push(l);
    this.listeners.set(event, list);
  }
}

const CONFIG: TunnelConfig = { mode: 'quick', port: 4321 };

function harness() {
  const procs: FakeProc[] = [];
  const onChange = vi.fn();
  const reports: TunnelReport[] = [];
  const ensurePinGated = vi.fn();
  const control = new TunnelControl({
    config: CONFIG,
    createManager: (config) =>
      new TunnelManager(config, () => {
        const p = new FakeProc();
        procs.push(p);
        return p;
      }),
    ensurePinGated,
    onChange,
    report: (e) => reports.push(e),
  });
  return { control, procs, onChange, reports, ensurePinGated };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('TunnelControl', () => {
  it('start(): pin-gates FIRST, goes starting → live when the URL appears, broadcasting each step', async () => {
    const h = harness();
    expect(h.control.status).toBe('off');
    h.control.start();
    expect(h.ensurePinGated).toHaveBeenCalledTimes(1);
    expect(h.control.status).toBe('starting');
    expect(h.onChange).toHaveBeenCalledTimes(1);
    h.procs[0]!.emit('stdout:data', 'https://neat-drum.trycloudflare.com ready');
    await flush();
    expect(h.control.status).toBe('live');
    expect(h.control.url).toBe('https://neat-drum.trycloudflare.com');
    expect(h.onChange).toHaveBeenCalledTimes(2);
    expect(h.reports.map((r) => r.kind)).toEqual(['ready']);
  });

  it('start() is idempotent while starting/live (no second child)', async () => {
    const h = harness();
    h.control.start();
    h.control.start();
    expect(h.procs.length).toBe(1);
    h.procs[0]!.emit('stdout:data', 'https://a.trycloudflare.com');
    await flush();
    h.control.start();
    expect(h.procs.length).toBe(1);
  });

  it('spawn failure → error status with a plain-language explanation; retry works', async () => {
    const h = harness();
    h.control.start();
    h.procs[0]!.emit('error', Object.assign(new Error('spawn cloudflared ENOENT'), { code: 'ENOENT' }));
    await flush();
    expect(h.control.status).toBe('error');
    expect(h.control.error).toMatch(/cloudflared/);
    expect(h.control.error).toMatch(/not found/i);
    expect(h.reports.map((r) => r.kind)).toEqual(['start-failed']);
    // Try again spawns a fresh child and can succeed.
    h.control.start();
    expect(h.control.status).toBe('starting');
    expect(h.control.error).toBeNull();
    h.procs[1]!.emit('stdout:data', 'https://b.trycloudflare.com');
    await flush();
    expect(h.control.status).toBe('live');
  });

  it('stop(): kills the child, returns to off, and a later start brings up a new tunnel', async () => {
    const h = harness();
    h.control.start();
    h.procs[0]!.emit('stdout:data', 'https://a.trycloudflare.com');
    await flush();
    h.control.stop();
    expect(h.procs[0]!.killed).toBe(true);
    expect(h.control.status).toBe('off');
    expect(h.control.url).toBeNull();
    h.control.start();
    h.procs[1]!.emit('stdout:data', 'https://c.trycloudflare.com');
    await flush();
    expect(h.control.url).toBe('https://c.trycloudflare.com');
  });

  it('stop() while starting wins over a late URL (no zombie live state)', async () => {
    const h = harness();
    h.control.start();
    h.control.stop();
    h.procs[0]!.emit('stdout:data', 'https://late.trycloudflare.com');
    await flush();
    expect(h.control.status).toBe('off');
    expect(h.control.url).toBeNull();
  });

  it('an unexpected exit after live surfaces as error status (never silent)', async () => {
    const h = harness();
    h.control.start();
    h.procs[0]!.emit('stdout:data', 'https://a.trycloudflare.com');
    await flush();
    h.procs[0]!.emit('exit', 1, null);
    expect(h.control.status).toBe('error');
    expect(h.control.error).toMatch(/unexpectedly/);
    expect(h.reports.map((r) => r.kind)).toEqual(['ready', 'unexpected-exit']);
  });
});

describe('describeTunnelError', () => {
  it('maps ENOENT to an install hint and passes other messages through', () => {
    expect(describeTunnelError('spawn cloudflared ENOENT', 'cloudflared')).toMatch(/brew install cloudflared/);
    expect(describeTunnelError('boom', 'cloudflared')).toBe('The share tunnel failed to start: boom');
  });
});

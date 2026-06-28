import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TunnelManager,
  parseTunnelUrl,
  tunnelArgs,
  tunnelConfigFromEnv,
  type TunnelProcess,
  type TunnelStream,
} from './tunnel-manager';

// --- fake child process ------------------------------------------------------

class FakeStream implements TunnelStream {
  private listeners: Array<(chunk: Buffer | string) => void> = [];
  on(event: 'data', listener: (chunk: Buffer | string) => void): void {
    if (event === 'data') this.listeners.push(listener);
  }
  emit(chunk: string): void {
    for (const l of this.listeners) l(chunk);
  }
}

class FakeProcess implements TunnelProcess {
  readonly stdout = new FakeStream();
  readonly stderr = new FakeStream();
  killed = false;
  killSignal: NodeJS.Signals | number | undefined;
  private exitListeners: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = [];
  private errorListeners: Array<(err: Error) => void> = [];

  kill(signal?: NodeJS.Signals | number): boolean {
    this.killed = true;
    this.killSignal = signal;
    return true;
  }

  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- canonical EventEmitter impl shape
  on(event: 'exit' | 'error', listener: (...args: any[]) => void): void {
    if (event === 'exit') this.exitListeners.push(listener);
    else this.errorListeners.push(listener);
  }

  emitExit(code: number | null, signal: NodeJS.Signals | null = null): void {
    for (const l of this.exitListeners) l(code, signal);
  }
  emitError(err: Error): void {
    for (const l of this.errorListeners) l(err);
  }
}

/** A spawner that records its calls and hands back a pre-built fake to drive. */
function fakeSpawner(proc: FakeProcess) {
  const calls: Array<{ command: string; args: string[] }> = [];
  const spawner = (command: string, args: string[]): TunnelProcess => {
    calls.push({ command, args });
    return proc;
  };
  return { spawner, calls };
}

describe('tunnelArgs (spawn selection)', () => {
  it('quick mode points cloudflared at the local origin', () => {
    expect(tunnelArgs({ mode: 'quick', port: 4321 })).toEqual([
      'tunnel',
      '--no-autoupdate',
      '--url',
      'http://localhost:4321',
    ]);
  });

  it('named mode runs the connector with its token', () => {
    expect(tunnelArgs({ mode: 'named', port: 4321, token: 'tok-123', hostname: 'led.example.com' })).toEqual([
      'tunnel',
      'run',
      '--token',
      'tok-123',
    ]);
  });
});

describe('parseTunnelUrl', () => {
  it('extracts the trycloudflare URL from a noisy banner line', () => {
    const line =
      '2024-01-01T00:00:00Z INF +-----+\n| https://brave-lions-run.trycloudflare.com |\n+-----+';
    expect(parseTunnelUrl(line)).toBe('https://brave-lions-run.trycloudflare.com');
  });

  it('returns null when there is no URL', () => {
    expect(parseTunnelUrl('INF Requesting new quick Tunnel on trycloudflare.com...')).toBeNull();
  });
});

describe('tunnelConfigFromEnv', () => {
  it('is disabled (null) when the flag is unset/off', () => {
    expect(tunnelConfigFromEnv({}, 4321)).toBeNull();
    expect(tunnelConfigFromEnv({ LEDRUMS_TUNNEL: '0' }, 4321)).toBeNull();
    expect(tunnelConfigFromEnv({ LEDRUMS_TUNNEL: 'false' }, 4321)).toBeNull();
  });

  it('defaults to quick mode when enabled with no named credentials', () => {
    expect(tunnelConfigFromEnv({ LEDRUMS_TUNNEL: '1' }, 4321)).toEqual({
      mode: 'quick',
      port: 4321,
      bin: undefined,
    });
  });

  it('uses named mode when a token + hostname are present', () => {
    const cfg = tunnelConfigFromEnv(
      { LEDRUMS_TUNNEL: '1', LEDRUMS_TUNNEL_TOKEN: 'tok', LEDRUMS_TUNNEL_HOSTNAME: 'led.example.com' },
      4321,
    );
    expect(cfg).toEqual({ mode: 'named', port: 4321, token: 'tok', hostname: 'led.example.com', bin: undefined });
  });

  it('honours an explicit binary override', () => {
    expect(tunnelConfigFromEnv({ LEDRUMS_TUNNEL: 'quick', LEDRUMS_TUNNEL_BIN: '/opt/cloudflared' }, 7)).toEqual({
      mode: 'quick',
      port: 7,
      bin: '/opt/cloudflared',
    });
  });
});

describe('TunnelManager — quick mode', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('spawns the quick-tunnel command and resolves with the parsed URL', async () => {
    const proc = new FakeProcess();
    const { spawner, calls } = fakeSpawner(proc);
    const mgr = new TunnelManager({ mode: 'quick', port: 4321, bin: 'cf' }, spawner);

    const started = mgr.start();
    expect(calls).toEqual([{ command: 'cf', args: ['tunnel', '--no-autoupdate', '--url', 'http://localhost:4321'] }]);
    expect(mgr.running).toBe(true);

    // The URL banner arrives on stderr (where cloudflared actually prints it).
    proc.stderr.emit('INF |  https://kind-otters-play.trycloudflare.com  |');
    await expect(started).resolves.toBe('https://kind-otters-play.trycloudflare.com');
    expect(mgr.url).toBe('https://kind-otters-play.trycloudflare.com');
  });

  it('rejects when the startup timeout elapses with no URL', async () => {
    const proc = new FakeProcess();
    const { spawner } = fakeSpawner(proc);
    const mgr = new TunnelManager({ mode: 'quick', port: 4321, startupTimeoutMs: 1000 }, spawner);

    const started = mgr.start();
    vi.advanceTimersByTime(1000);
    await expect(started).rejects.toThrow(/did not report a tunnel URL/);
    expect(proc.killed).toBe(true); // half-started child is torn down
    expect(mgr.running).toBe(false);
  });

  it('rejects when the child errors before the URL is ready', async () => {
    const proc = new FakeProcess();
    const { spawner } = fakeSpawner(proc);
    const mgr = new TunnelManager({ mode: 'quick', port: 4321 }, spawner);

    const started = mgr.start();
    proc.emitError(new Error('spawn cloudflared ENOENT'));
    await expect(started).rejects.toThrow(/ENOENT/);
    expect(mgr.running).toBe(false);
  });

  it('rejects when the child exits before the URL is ready', async () => {
    const proc = new FakeProcess();
    const { spawner } = fakeSpawner(proc);
    const mgr = new TunnelManager({ mode: 'quick', port: 4321 }, spawner);

    const started = mgr.start();
    proc.emitExit(1, null);
    await expect(started).rejects.toThrow(/exited before the tunnel was ready/);
    expect(mgr.running).toBe(false);
  });
});

describe('TunnelManager — named mode', () => {
  it('spawns the connector and resolves with the configured hostname URL', async () => {
    const proc = new FakeProcess();
    const { spawner, calls } = fakeSpawner(proc);
    const mgr = new TunnelManager({ mode: 'named', port: 4321, token: 'tok', hostname: 'led.example.com' }, spawner);

    const url = await mgr.start();
    expect(calls[0]!.args).toEqual(['tunnel', 'run', '--token', 'tok']);
    expect(url).toBe('https://led.example.com');
    expect(mgr.url).toBe('https://led.example.com');
  });

  it('rejects named mode without a hostname', async () => {
    const proc = new FakeProcess();
    const { spawner } = fakeSpawner(proc);
    const mgr = new TunnelManager({ mode: 'named', port: 4321, token: 'tok' }, spawner);
    await expect(mgr.start()).rejects.toThrow(/requires a hostname/);
  });
});

describe('TunnelManager — lifecycle + crash reporting', () => {
  it('stop() kills the child and clears the URL without reporting a crash', async () => {
    const proc = new FakeProcess();
    const { spawner } = fakeSpawner(proc);
    const mgr = new TunnelManager({ mode: 'named', port: 4321, token: 't', hostname: 'h.example.com' }, spawner);
    await mgr.start();

    const onExit = vi.fn();
    mgr.onUnexpectedExit = onExit;
    mgr.stop();

    expect(proc.killed).toBe(true);
    expect(mgr.running).toBe(false);
    expect(mgr.url).toBeNull();

    // A deliberate stop must NOT be reported as a crash even if the child emits exit afterward.
    proc.emitExit(0, 'SIGTERM');
    expect(onExit).not.toHaveBeenCalled();
  });

  it('reports an UNEXPECTED exit after the tunnel was up', async () => {
    const proc = new FakeProcess();
    const { spawner } = fakeSpawner(proc);
    const mgr = new TunnelManager({ mode: 'named', port: 4321, token: 't', hostname: 'h.example.com' }, spawner);
    await mgr.start();

    const onExit = vi.fn();
    mgr.onUnexpectedExit = onExit;
    proc.emitExit(137, 'SIGKILL'); // crashed

    expect(onExit).toHaveBeenCalledWith({ code: 137, signal: 'SIGKILL' });
    expect(mgr.running).toBe(false);
    expect(mgr.url).toBeNull();
  });

  it('reports an error that arrives after the tunnel was up', async () => {
    const proc = new FakeProcess();
    const { spawner } = fakeSpawner(proc);
    const mgr = new TunnelManager({ mode: 'named', port: 4321, token: 't', hostname: 'h.example.com' }, spawner);
    await mgr.start();

    const onError = vi.fn();
    mgr.onError = onError;
    proc.emitError(new Error('connection lost'));
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('rejects a second start() while already running', async () => {
    const proc = new FakeProcess();
    const { spawner } = fakeSpawner(proc);
    const mgr = new TunnelManager({ mode: 'named', port: 4321, token: 't', hostname: 'h.example.com' }, spawner);
    await mgr.start();
    await expect(mgr.start()).rejects.toThrow(/already started/);
  });
});

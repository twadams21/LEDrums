import { spawn } from 'node:child_process';

// ---------------------------------------------------------------------------
// Cloudflare tunnel manager (S3 remote access)
// ---------------------------------------------------------------------------
//
// Brings up an OUTBOUND Cloudflare tunnel so a remote browser can reach the locally-running
// server without opening an inbound port (and, in quick mode, without a Cloudflare account).
// `cloudflared` runs as a child process behind an INJECTABLE spawner so the lifecycle (spawn →
// resolve URL → stop → crash report) is unit-testable with a fake — no real binary needed.
//
// Two modes, selected by config (NOT a call-site change):
//   - quick (default): `cloudflared tunnel --url http://localhost:<port>` → parse the
//     ephemeral `https://*.trycloudflare.com` URL from the process output.
//   - named: `cloudflared tunnel run --token <token>` → the public URL is the configured,
//     stable `hostname`, so it resolves deterministically from config.

export type TunnelMode = 'quick' | 'named';

export interface TunnelConfig {
  mode: TunnelMode;
  /** Local port `cloudflared` points the tunnel at (quick mode origin). */
  port: number;
  /** `cloudflared` binary name or path (default `'cloudflared'`). */
  bin?: string;
  /** Named-tunnel connector token (`cloudflared tunnel run --token <token>`). */
  token?: string;
  /** Named-tunnel public hostname — the stable URL we resolve to. */
  hostname?: string;
  /** Max ms to wait for the quick-mode URL before failing `start()` (default 30s). */
  startupTimeoutMs?: number;
}

/** Minimal readable-stream surface the manager consumes — a structural subset of Node's
 * `Readable`, so the real child stream drops in and a fake is a one-liner. */
export interface TunnelStream {
  on(event: 'data', listener: (chunk: Buffer | string) => void): void;
}

/** Minimal child-process surface the manager drives — a structural subset of Node's
 * `ChildProcess` (so `spawn(...)` is assignable), kept tiny so a test fake is trivial. */
export interface TunnelProcess {
  readonly stdout: TunnelStream | null;
  readonly stderr: TunnelStream | null;
  kill(signal?: NodeJS.Signals | number): boolean;
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
}

/** Spawn seam: maps (command, args) → a {@link TunnelProcess}. The default uses Node's
 * `child_process.spawn`; tests inject a fake to drive the manager deterministically. */
export type TunnelSpawner = (command: string, args: string[]) => TunnelProcess;

/** The public URL banner cloudflared prints for an ephemeral quick tunnel. */
const TRYCLOUDFLARE_URL = /https:\/\/[a-z0-9][a-z0-9-]*\.trycloudflare\.com/i;

const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;

/** The `cloudflared` argv for a config — pure, so the spawn-selection is directly testable. */
export function tunnelArgs(config: TunnelConfig): string[] {
  if (config.mode === 'named') {
    return ['tunnel', 'run', '--token', config.token ?? ''];
  }
  return ['tunnel', '--no-autoupdate', '--url', `http://localhost:${config.port}`];
}

/** Extract the first `https://*.trycloudflare.com` URL from a chunk of cloudflared output,
 * or null when the chunk carries none. Pure. */
export function parseTunnelUrl(chunk: string): string | null {
  const m = TRYCLOUDFLARE_URL.exec(chunk);
  return m ? m[0] : null;
}

/**
 * Resolve a {@link TunnelConfig} from the environment, or `null` when the tunnel is disabled —
 * so plain `pnpm dev` (no env set) never spawns cloudflared.
 *
 * Enabled by `LEDRUMS_TUNNEL` (`1`/`true`/`quick`/`named`; `0`/`false`/`off`/empty = disabled).
 * Named mode is used when `LEDRUMS_TUNNEL=named`, or implicitly when BOTH a token and hostname
 * are provided; otherwise quick mode. Overrides: `LEDRUMS_TUNNEL_TOKEN`,
 * `LEDRUMS_TUNNEL_HOSTNAME`, `LEDRUMS_TUNNEL_BIN`.
 */
export function tunnelConfigFromEnv(env: NodeJS.ProcessEnv, port: number): TunnelConfig | null {
  const flag = (env.LEDRUMS_TUNNEL ?? '').trim().toLowerCase();
  if (flag === '' || flag === '0' || flag === 'false' || flag === 'off') return null;
  const token = env.LEDRUMS_TUNNEL_TOKEN?.trim() || undefined;
  const hostname = env.LEDRUMS_TUNNEL_HOSTNAME?.trim() || undefined;
  const bin = env.LEDRUMS_TUNNEL_BIN?.trim() || undefined;
  const named = flag === 'named' || (!!token && !!hostname);
  return named ? { mode: 'named', port, token, hostname, bin } : { mode: 'quick', port, bin };
}

/** Default spawner — a real, detached-stdio `cloudflared` child. */
function defaultSpawner(command: string, args: string[]): TunnelProcess {
  return spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Info handed to {@link TunnelManager.onUnexpectedExit} when the child dies after coming up. */
export interface TunnelExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

/**
 * Manages a single `cloudflared` child for the server's lifetime.
 *
 *  - `start()` spawns the child and resolves with the public URL (parsed from output in quick
 *    mode, derived from `hostname` in named mode). It rejects if the child errors or exits
 *    before the URL is ready, or if the quick-mode URL never appears within the startup timeout.
 *  - `stop()` tears the child down (and is distinguished from a crash, so it stays silent).
 *  - an UNEXPECTED exit/error after the tunnel was up is surfaced via {@link onUnexpectedExit}
 *    / {@link onError} — never swallowed.
 */
export class TunnelManager {
  private proc: TunnelProcess | null = null;
  private resolvedUrl: string | null = null;

  /** Reported when the child exits unexpectedly AFTER `start()` resolved (a crash, not `stop()`). */
  onUnexpectedExit: ((exit: TunnelExit) => void) | null = null;
  /** Reported when the child emits an error AFTER `start()` resolved. */
  onError: ((err: Error) => void) | null = null;

  constructor(
    private readonly config: TunnelConfig,
    private readonly spawner: TunnelSpawner = defaultSpawner,
  ) {}

  /** The resolved public URL, or null before `start()` resolves / after `stop()`. */
  get url(): string | null {
    return this.resolvedUrl;
  }

  /** Whether a child is currently live. */
  get running(): boolean {
    return this.proc !== null;
  }

  /** Spawn cloudflared and resolve with the public URL. Rejects on early exit/error/timeout. */
  start(): Promise<string> {
    if (this.proc) return Promise.reject(new Error('tunnel already started'));
    const bin = this.config.bin ?? 'cloudflared';
    const proc = this.spawner(bin, tunnelArgs(this.config));
    this.proc = proc;

    return new Promise<string>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const settle = (url: string): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        this.resolvedUrl = url;
        resolve(url);
      };
      const fail = (err: Error): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        // Tear down the half-started child so a failed start leaks no process.
        if (this.proc === proc) this.proc = null;
        this.resolvedUrl = null;
        try {
          proc.kill();
        } catch {
          /* ignore */
        }
        reject(err);
      };

      // Quick mode: the first trycloudflare URL in stdout/stderr is the readiness signal.
      const onChunk = (chunk: Buffer | string): void => {
        const url = parseTunnelUrl(chunk.toString());
        if (url) settle(url);
      };
      proc.stdout?.on('data', onChunk);
      proc.stderr?.on('data', onChunk);

      proc.on('error', (err) => {
        const e = err instanceof Error ? err : new Error(String(err));
        if (!settled) fail(e); // spawn failure (e.g. cloudflared not installed) → reject start()
        else this.onError?.(e); // already up → report, don't crash the server
      });

      proc.on('exit', (code, signal) => {
        const wasCurrent = this.proc === proc;
        if (wasCurrent) {
          this.proc = null;
          this.resolvedUrl = null;
        }
        if (!settled) {
          fail(new Error(`cloudflared exited before the tunnel was ready (code ${code ?? 'null'}, signal ${signal ?? 'null'})`));
        } else if (wasCurrent) {
          // Up, then died — and `stop()` nulls `this.proc` first, so a deliberate teardown is
          // already excluded by `wasCurrent`. Surface it.
          this.onUnexpectedExit?.({ code, signal });
        }
      });

      if (this.config.mode === 'named') {
        const host = this.config.hostname;
        if (!host) {
          fail(new Error('named tunnel requires a hostname'));
          return;
        }
        // The named-tunnel URL is fixed by config — resolve it as soon as the child is live.
        // A later spawn error (bad binary/token) still surfaces via onError above.
        settle(`https://${host}`);
        return;
      }

      const timeoutMs = this.config.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
      timer = setTimeout(
        () => fail(new Error(`cloudflared did not report a tunnel URL within ${timeoutMs}ms`)),
        timeoutMs,
      );
      // Don't let the startup timer hold the event loop open on its own.
      (timer as { unref?: () => void }).unref?.();
    });
  }

  /** Tear the child down. Null `proc` FIRST so the `exit` handler treats this as deliberate
   * (no {@link onUnexpectedExit}). Idempotent. */
  stop(): void {
    const proc = this.proc;
    this.proc = null;
    this.resolvedUrl = null;
    if (proc) {
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
    }
  }
}

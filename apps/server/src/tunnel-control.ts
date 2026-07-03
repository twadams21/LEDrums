import type { TunnelStatus } from '@ledrums/protocol';
import { TunnelManager, type TunnelConfig } from './tunnel-manager';

// ---------------------------------------------------------------------------
// Tunnel lifecycle control (S3 follow-up: in-app start/stop)
// ---------------------------------------------------------------------------
//
// TunnelManager owns ONE cloudflared child from spawn to teardown; TunnelControl owns the
// lifecycle ACROSS children — the off/starting/live/error status the UI renders, restart after
// stop or failure (each start builds a fresh manager), and the change/report fan-out. Both the
// boot-time env path (`LEDRUMS_TUNNEL=1` → start at listen) and the in-app protocol path
// (`{t:'tunnel'}`) drive the same control, so there is exactly one status truth.
//
// Invariant (S3): `deps.ensurePinGated()` runs BEFORE any child is spawned, so a public URL can
// never exist without an active room-PIN gate.

/** One diagnostic occurrence worth reporting (monitor + console) — NOT the status itself. */
export interface TunnelReport {
  kind: 'ready' | 'start-failed' | 'unexpected-exit' | 'error';
  detail: string;
}

export interface TunnelControlDeps {
  /** Build the manager for one tunnel run. Injectable so tests drive the lifecycle with fakes. */
  createManager(config: TunnelConfig): TunnelManager;
  /** The config each start uses (env-derived when set, plain quick-mode default otherwise). */
  config: TunnelConfig;
  /** Make sure the room-PIN gate is active — called before every spawn (never a public
   * un-gated URL). */
  ensurePinGated(): void;
  /** Status/url changed — re-broadcast `state` so every client's Share surface updates. */
  onChange(): void;
  /** A reportable event occurred (log + monitor); status is already updated when this fires. */
  report?(event: TunnelReport): void;
}

/** Translate a spawn/startup failure into the plain-language explanation the popover shows. */
export function describeTunnelError(message: string, bin: string): string {
  if (/ENOENT/.test(message)) {
    return `The share tunnel needs the '${bin}' program, which was not found. Install cloudflared (e.g. \`brew install cloudflared\`) or point LEDRUMS_TUNNEL_BIN at it, then try again.`;
  }
  return `The share tunnel failed to start: ${message}`;
}

export class TunnelControl {
  private manager: TunnelManager | null = null;
  private statusValue: TunnelStatus = 'off';
  private errorValue: string | null = null;

  constructor(private readonly deps: TunnelControlDeps) {}

  get status(): TunnelStatus {
    return this.statusValue;
  }

  /** Plain-language failure description, non-null only when `status === 'error'`. */
  get error(): string | null {
    return this.errorValue;
  }

  /** The live public URL, or null unless `status === 'live'`. */
  get url(): string | null {
    return this.manager?.url ?? null;
  }

  /**
   * Bring the tunnel up (idempotent while starting/live). Ensures the PIN gate FIRST, flips to
   * `starting` synchronously, then resolves to `live` or `error` — every transition fires
   * `onChange` so clients follow along. A start after stop/error builds a fresh manager.
   */
  start(): void {
    if (this.statusValue === 'starting' || this.statusValue === 'live') return;
    this.deps.ensurePinGated();
    const manager = this.deps.createManager(this.deps.config);
    this.manager = manager;
    this.statusValue = 'starting';
    this.errorValue = null;

    // A crash AFTER the tunnel came up (stop() never reaches these — TunnelManager
    // distinguishes deliberate teardown).
    manager.onUnexpectedExit = ({ code, signal }) => {
      if (this.manager !== manager) return;
      this.fail('The share tunnel exited unexpectedly — sharing is down. Start it again to get a new link.');
      this.deps.report?.({ kind: 'unexpected-exit', detail: `code=${code ?? 'null'}; signal=${signal ?? 'null'}` });
    };
    manager.onError = (err) => {
      if (this.manager !== manager) return;
      this.deps.report?.({ kind: 'error', detail: err.message });
    };

    this.deps.onChange();

    manager
      .start()
      .then((url) => {
        if (this.manager !== manager) return; // stopped while starting
        this.statusValue = 'live';
        this.deps.report?.({ kind: 'ready', detail: url });
        this.deps.onChange();
      })
      .catch((err: unknown) => {
        if (this.manager !== manager) return;
        const message = err instanceof Error ? err.message : String(err);
        this.fail(describeTunnelError(message, this.deps.config.bin ?? 'cloudflared'));
        this.deps.report?.({ kind: 'start-failed', detail: message });
      });
  }

  /** Tear the tunnel down (idempotent) — status returns to `off`, clearing any stale error. */
  stop(): void {
    const manager = this.manager;
    this.manager = null;
    manager?.stop();
    if (this.statusValue === 'off' && this.errorValue === null) return;
    this.statusValue = 'off';
    this.errorValue = null;
    this.deps.onChange();
  }

  private fail(error: string): void {
    this.manager = null;
    this.statusValue = 'error';
    this.errorValue = error;
    this.deps.onChange();
  }
}

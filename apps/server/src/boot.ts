import type { Server } from 'node:http';
import { networkInterfaces } from 'node:os';
import type { OscInput } from '@ledrums/io';
import type { WebSocket, WebSocketServer } from 'ws';
import type { Autosaver } from './autosave';
import type { ClientRegistry } from './client-registry';
import type { EngineHost } from './engine-host';
import type { VoiceEngineHost } from './voice-engine-host';
import type { TunnelManager } from './tunnel-manager';

/** Collaborators the boot/shutdown orchestration drives. */
export interface BootDeps {
  server: Server;
  wss: WebSocketServer;
  clients: ClientRegistry<WebSocket>;
  host: EngineHost;
  voiceHost: VoiceEngineHost | null;
  oscInput: OscInput;
  port: number;
  oscPort: number;
  voiceMode: boolean;
  /** The periodic-stats interval, cleared on shutdown. */
  statsTimer: ReturnType<typeof setInterval>;
  autosaver: Autosaver;
  showLibraryAutosaver: Autosaver;
  /** Outbound Cloudflare tunnel (S3), or null when disabled. Started after the socket binds;
   * stopped on shutdown. */
  tunnelManager: TunnelManager | null;
  /** Active room PIN (S3), or null when the gate is open — printed in the boot banner. */
  pin: string | null;
  /** Per-run host-session token (S4 desktop). Printed in the boot banner (local stdout only) so the
   * desktop shell can read it and inject it into the host app window — never sent to remote clients.
   * Only banner-printed when the gate is active (the bypass is moot on an open gate). */
  hostToken: string | null;
  /** Re-broadcast the `state` message — called once the tunnel URL resolves so already-connected
   * host clients pick up the share URL. */
  broadcastState: () => void;
}

/** Every non-internal IPv4 address as an http URL on port `p` (for the boot LAN banner). */
export function lanUrls(p: number): string[] {
  const urls: string[] = [];
  const ifaces = networkInterfaces();
  for (const addrs of Object.values(ifaces)) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) urls.push(`http://${a.address}:${p}`);
    }
  }
  return urls;
}

/**
 * Bring up the outbound tunnel (if configured) once the socket is bound, so cloudflared has a
 * live origin to forward to. Fire-and-forget: the public URL is logged + re-broadcast to
 * connected clients when it resolves; a startup failure or later crash is logged (reported, not
 * silent) and never wedges the server — local + LAN access keep working.
 */
function startTunnel(deps: BootDeps): void {
  const tunnel = deps.tunnelManager;
  if (!tunnel) return;
  tunnel.onUnexpectedExit = ({ code, signal }) => {
    console.error(`[tunnel] cloudflared exited unexpectedly (code ${code ?? 'null'}, signal ${signal ?? 'null'}) — remote access is down`);
  };
  tunnel.onError = (err) => console.error('[tunnel] error:', err.message);
  tunnel
    .start()
    .then((url) => {
      console.log(`  Tunnel: ${url}${deps.pin ? ` (PIN ${deps.pin})` : ''}`);
      deps.broadcastState(); // host UIs connected before the URL resolved now learn it
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[tunnel] failed to start (is cloudflared installed?): ${message}`);
    });
}

/**
 * Start listening and install graceful shutdown. Brings up the engine (voice or legacy)
 * once the socket is bound, prints the boot banner, and wires SIGINT/SIGTERM to a single
 * idempotent shutdown that stops the engine, closes IO, and flushes pending autosaves so a
 * clean exit never loses the last edit.
 */
export function boot(deps: BootDeps): void {
  deps.server.listen(deps.port, () => {
    if (deps.voiceHost) deps.voiceHost.start();
    else deps.host.start();
    console.log(`LEDrums server listening on http://localhost:${deps.port}${deps.voiceMode ? ' [voice engine]' : ''}`);
    for (const url of lanUrls(deps.port)) console.log(`  LAN: ${url}`);
    console.log(`OSC listening on udp:${deps.oscPort}`);
    console.log('Pixel output: set target IP + Arm in the UI');
    if (deps.pin) {
      console.log(`  Room PIN: ${deps.pin} (required to join)`);
      // Machine-readable line for the desktop shell to capture + inject into the host app window —
      // local stdout only, so it never reaches a remote client. Gated on `pin` because the host
      // bypass only matters when there is a gate to bypass.
      if (deps.hostToken) console.log(`  Host token: ${deps.hostToken}`);
    }
    startTunnel(deps);
  });

  let shuttingDown = false;
  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(deps.statsTimer);
    deps.tunnelManager?.stop();
    if (deps.voiceHost) deps.voiceHost.stop();
    else deps.host.stop();
    deps.oscInput.close();
    for (const ws of deps.clients) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    deps.wss.close();
    deps.server.close();
    // Flush any pending autosave so a clean shutdown never loses the last edit. flush()
    // never rejects (write errors are logged), but guard exit-on-error just in case. Both the
    // project and the show library are flushed (independent slots).
    await Promise.all([
      deps.autosaver.flush().catch(() => {}),
      deps.showLibraryAutosaver.flush().catch(() => {}),
    ]);
    process.exit(0);
  }

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

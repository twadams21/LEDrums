import type { Server } from 'node:http';
import { networkInterfaces } from 'node:os';
import type { OscInput } from '@ledrums/io';
import type { WebSocket, WebSocketServer } from 'ws';
import type { Autosaver } from './autosave';
import type { ClientRegistry } from './client-registry';
import type { EngineHost } from './engine-host';
import type { VoiceEngineHost } from './voice-engine-host';
import type { MonitorDraft } from './monitor';

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
  songLibraryAutosaver: Autosaver;
  /** Share-tunnel lifecycle control (S3). Boot only starts/stops it; status reporting +
   * broadcasting live inside the control's own wiring. */
  tunnelControl: { start(): void; stop(): void };
  /** Whether the env (`LEDRUMS_TUNNEL`) asked for the tunnel to come up at boot. The in-app
   * Share control can start it later regardless. */
  tunnelAtBoot: boolean;
  /** Active room PIN (S3), or null when the gate is open — printed in the boot banner. */
  pin: string | null;
  /** Per-run host-session token (S4 desktop). Printed in the boot banner (local stdout only) so the
   * desktop shell can read it and inject it into the host app window — never sent to remote clients.
   * Only banner-printed when the gate is active (the bypass is moot on an open gate). */
  hostToken: string | null;
  monitor?: (event: MonitorDraft) => void;
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
    }
    // Local-only token for the desktop shell: it admits the host webview and native MIDI bridge.
    if (deps.hostToken) console.log(`  Host token: ${deps.hostToken}`);
    // Env-requested boot tunnel — started only once the socket is bound, so cloudflared has a
    // live origin to forward to. Fire-and-forget: the control reports readiness/failure itself
    // and never wedges the server — local + LAN access keep working.
    if (deps.tunnelAtBoot) deps.tunnelControl.start();
  });

  let shuttingDown = false;
  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(deps.statsTimer);
    deps.tunnelControl.stop();
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
    // never rejects (write errors are logged), but guard exit-on-error just in case. The project
    // and both libraries are flushed (independent slots).
    await Promise.all([
      deps.autosaver.flush().catch(() => {}),
      deps.showLibraryAutosaver.flush().catch(() => {}),
      deps.songLibraryAutosaver.flush().catch(() => {}),
    ]);
    process.exit(0);
  }

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

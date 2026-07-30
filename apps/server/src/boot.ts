import type { Server } from 'node:http';
import { networkInterfaces } from 'node:os';
import type { OscInput } from '@ledrums/io';
import type { WebSocket, WebSocketServer } from 'ws';
import type { Autosaver } from './autosave';
import type { ClientRegistry } from './client-registry';
import type { VoiceEngineHost } from './voice-engine-host';
import type { MonitorDraft } from './monitor';

/** Collaborators the boot/shutdown orchestration drives. */
export interface BootDeps {
  server: Server;
  wss: WebSocketServer;
  clients: ClientRegistry<WebSocket>;
  /** The render loop. There is exactly one (S12 deleted the other), so there is nothing to
   * choose and no mode to be told about. */
  voiceHost: VoiceEngineHost;
  oscInput: OscInput;
  /** PixLite controller monitor (S47) — its poll loop is stopped on shutdown. */
  controllerMonitor?: { stop(): void };
  /** WS keepalive reaper (S13) — its sweep interval is stopped on shutdown. */
  wsKeepalive?: { disposeKeepalive(): void };
  port: number;
  oscPort: number;
  /** The periodic-stats interval, cleared on shutdown. */
  statsTimer: ReturnType<typeof setInterval>;
  /** The 30-min backup-cadence interval (#123), cleared on shutdown. */
  snapshotTimer?: ReturnType<typeof setInterval>;
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

/** Every non-internal IPv4 address of this machine — what a peer on the LAN can reach it at.
 * Shared by the boot banner (http) and the OSC listen surface (#139): a third-party sender like
 * Sensory Percussion is configured by typing one of these plus the OSC port. */
export function lanAddresses(): string[] {
  const addresses: string[] = [];
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) addresses.push(a.address);
    }
  }
  return addresses;
}

/** Every non-internal IPv4 address as an http URL on port `p` (for the boot LAN banner). */
function lanUrls(p: number): string[] {
  return lanAddresses().map((a) => `http://${a}:${p}`);
}

/**
 * Start listening and install graceful shutdown. Brings up THE engine once the socket is bound
 * (S8: there is one), prints the boot banner, and wires SIGINT/SIGTERM to a single idempotent
 * shutdown that stops the engine, closes IO, and flushes pending autosaves so a clean exit never
 * loses the last edit.
 */
export function boot(deps: BootDeps): void {
  deps.server.listen(deps.port, () => {
    deps.voiceHost.start();
    console.log(`LEDrums server listening on http://localhost:${deps.port}`);
    for (const url of lanUrls(deps.port)) console.log(`  LAN: ${url}`);
    // Print the address a sender is actually configured with, not just the port — the whole
    // point of the OSC surface is that a user can answer "what do I type into Sensory
    // Percussion / my Max device?" without reading source. Never claim liveness we have not
    // observed: a failed bind says so, and an unsettled bind says only that it is in flight.
    const osc = deps.oscInput.status;
    if (osc?.state === 'error') {
      console.log(`OSC NOT listening on udp:${osc.port} — ${osc.error ?? 'bind failed'}`);
    } else if (osc) {
      console.log(`OSC listening on udp:${osc.port}`);
      for (const a of lanAddresses()) console.log(`  send OSC to: ${a}:${osc.port}`);
    } else {
      console.log(`OSC binding on udp:${deps.oscPort}…`);
    }
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
    if (deps.snapshotTimer) clearInterval(deps.snapshotTimer);
    deps.controllerMonitor?.stop();
    deps.wsKeepalive?.disposeKeepalive();
    deps.tunnelControl.stop();
    deps.voiceHost.stop();
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

import type { ClientRegistry } from './client-registry';
import type { MonitorDraft } from './monitor';
import type { ServerMessage } from './ws-protocol';

/**
 * The socket-iterating broadcast closures, drained verbatim from main.ts (S11,
 * divergent-change-0004), plus resilience-hole-0005's backpressure guard (S14).
 *
 * The guard has two halves, each shaped by a landed review attack:
 *  - SKIP CONFINED TO THE HIGH-RATE STREAMS: only the 100 Hz `stats` JSON broadcast
 *    and the binary preview are skipped for a peer whose send buffer is over
 *    {@link BACKPRESSURE_BYTES}. Event-driven messages (state, presence, monitor,
 *    error) ALWAYS send — skipping everything would starve the message-age signal
 *    the client watchdog (S5) measures, so a slow-but-alive peer would be declared
 *    dead by its own client.
 *  - STRIKES ON THE SWEEP CLOCK: consecutive-over strikes advance only in
 *    {@link Broadcaster.sweepSlowPeers}, driven by the keepalive's 15s sweep —
 *    never per broadcast, where 3 strikes at 100 Hz would terminate a peer after
 *    ~30ms. Termination needs {@link SLOW_PEER_SWEEPS} x 15s of SUSTAINED
 *    over-threshold, an order of magnitude past the client's 5s self-recovery.
 */

/** A peer buffering more than this many undelivered bytes is skipped on the
 * high-rate streams. Named + test-asserted so a value change is a visible change. */
export const BACKPRESSURE_BYTES = 1_000_000;

/** Consecutive over-threshold keepalive sweeps (15s apart) before a slow peer is
 * terminated. Named + test-asserted so a value change is a visible change. */
export const SLOW_PEER_SWEEPS = 3;

/** The socket surface the broadcaster drives (structural, so tests use fakes).
 * `close()` comes from the registry's CloseableSocket contract, not from this module. */
export interface BroadcastSocket {
  readonly OPEN: number;
  readyState: number;
  /** Bytes queued but not yet handed to the OS — the backpressure signal. */
  bufferedAmount: number;
  send(data: string | Uint8Array, opts?: { binary?: boolean }): void;
  close(code?: number, reason?: string): void;
  /** Hard-destroy the transport (no close handshake a slow peer can't drain). */
  terminate(): void;
}

export interface BroadcasterDeps<S extends BroadcastSocket> {
  clients: ClientRegistry<S>;
  encode(msg: ServerMessage): string;
  /** Reap a terminated slow peer — wire to the SAME body as the keepalive's onDead
   * (clients.remove + dropWatcher + broadcastPresence), so a struck-out peer is
   * indistinguishable from a normal disconnect to every other subsystem. */
  onSlowPeerDead(ws: S): void;
  monitor(event: MonitorDraft): void;
}

export interface Broadcaster<S extends BroadcastSocket> {
  /** Send a JSON message to every OPEN client (encoded once, same string to all).
   * `stats` frames are skipped for over-threshold peers; everything else always sends. */
  broadcastJson(msg: ServerMessage): void;
  /** Send a binary RGB preview frame to every OPEN client (skipped for slow peers). */
  broadcastBinary(rgb: Uint8Array): void;
  /** Re-broadcast presence to every client (each gets its own `youAreEditor`). */
  broadcastPresence(): void;
  /** Relay a server message to every client EXCEPT `sender` (the live library relay). */
  relayToOthers(sender: S, msg: ServerMessage): void;
  /** Advance slow-peer strikes — called once per keepalive sweep, NEVER per broadcast.
   * A peer over-threshold for {@link SLOW_PEER_SWEEPS} consecutive sweeps is terminated. */
  sweepSlowPeers(): void;
  /** Observability for the guard: skipped high-rate sends + live strike entries
   * (the latter so tests can prove disconnected peers are not pinned — review N5). */
  stats(): { skipped: number; strikedPeers: number };
}

export function createBroadcaster<S extends BroadcastSocket>(deps: BroadcasterDeps<S>): Broadcaster<S> {
  const { clients, encode } = deps;

  /** Consecutive over-threshold SWEEPS per socket (not broadcasts). */
  const strikes = new Map<S, number>();
  let skipped = 0;

  const overThreshold = (ws: S): boolean => ws.bufferedAmount > BACKPRESSURE_BYTES;

  function broadcastJson(msg: ServerMessage): void {
    const skippable = msg.t === 'stats';
    const data = encode(msg);
    for (const ws of clients) {
      if (ws.readyState !== ws.OPEN) continue;
      if (skippable && overThreshold(ws)) {
        skipped++;
        continue;
      }
      ws.send(data);
    }
  }

  function broadcastBinary(rgb: Uint8Array): void {
    for (const ws of clients) {
      if (ws.readyState !== ws.OPEN) continue;
      if (overThreshold(ws)) {
        skipped++;
        continue;
      }
      ws.send(rgb, { binary: true });
    }
  }

  function broadcastPresence(): void {
    for (const ws of clients) {
      if (ws.readyState === ws.OPEN) ws.send(encode({ t: 'presence', ...clients.presenceFor(ws) }));
    }
  }

  function relayToOthers(sender: S, msg: ServerMessage): void {
    const data = encode(msg);
    for (const other of clients) {
      if (other !== sender && other.readyState === other.OPEN) other.send(data);
    }
  }

  function sweepSlowPeers(): void {
    // Drop strike entries for sockets no longer in the registry (review N5): the
    // close/error path removes a peer from `clients` without telling this module,
    // and a Map keyed by socket would otherwise pin every disconnected peer forever.
    if (strikes.size > 0) {
      const live = new Set<S>(clients);
      for (const ws of strikes.keys()) if (!live.has(ws)) strikes.delete(ws);
    }
    for (const ws of clients) {
      if (!overThreshold(ws)) {
        strikes.delete(ws); // recovered — the count is CONSECUTIVE sweeps
        continue;
      }
      const count = (strikes.get(ws) ?? 0) + 1;
      if (count < SLOW_PEER_SWEEPS) {
        strikes.set(ws, count);
        continue;
      }
      strikes.delete(ws);
      // admit() is idempotent for a registered socket — it returns the existing id.
      deps.monitor({
        type: 'error',
        direction: 'local',
        source: 'server/ws',
        label: 'Slow WebSocket client terminated',
        detail: `client ${clients.admit(ws)}: ${ws.bufferedAmount} bytes buffered for ${SLOW_PEER_SWEEPS} consecutive sweeps`,
      });
      ws.terminate();
      deps.onSlowPeerDead(ws);
    }
  }

  return { broadcastJson, broadcastBinary, broadcastPresence, relayToOthers, sweepSlowPeers, stats: () => ({ skipped, strikedPeers: strikes.size }) };
}

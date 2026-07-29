/**
 * Ping/pong reaper for dead WS peers (resilience-hole-0004 server half, INIT-04 S13).
 *
 * The connection handler installs only close/error listeners, so a half-open peer
 * (wifi drop, laptop sleep, dead tunnel) is never reaped and lingers in the broadcast
 * registry — which is also what lets the send buffer grow forever (resilience-hole-0005).
 * Standard `ws` keepalive: ping every sweep, terminate any peer that did not pong since
 * the previous sweep. Browsers answer pings automatically at the transport layer, so
 * packages/protocol is untouched.
 *
 * Deliberately its OWN module, generic over a minimal socket shape — NOT client-registry.ts,
 * whose CloseableSocket contract is documented close()-only and deliberately ws-decoupled.
 * S14's slow-peer strikes are counted on this same sweep clock (`onSweep`).
 */

/** Sweep period. A peer is terminated after missing a full sweep — i.e. within two
 * sweeps of going dead. Named + test-asserted so a value change is a visible change. */
export const HEARTBEAT_MS = 15_000;

export interface KeepaliveSocket {
  ping(): void;
  terminate(): void;
  on(event: 'pong', cb: () => void): void;
}

export interface WsKeepaliveDeps<S extends KeepaliveSocket> {
  /** Reap a dead peer AFTER terminate() — wired to the exact body of the close handler
   * (clients.remove + dropWatcher + broadcastPresence), so a reaped peer is
   * indistinguishable from a normal disconnect to every other subsystem. */
  onDead(ws: S): void;
  /** Sweep period override (tests). Default {@link HEARTBEAT_MS}. */
  heartbeatMs?: number;
  /** Called once per sweep tick AFTER the reap pass — S14 counts slow-peer strikes here. */
  onSweep?(): void;
}

export interface WsKeepalive<S extends KeepaliveSocket> {
  /** Register a freshly-admitted socket. Its alive flag starts TRUE, so a socket admitted
   * mid-sweep is never reaped on the immediately following sweep. */
  admit(ws: S): void;
  /** Forget a socket (normal close path — avoids pinging a corpse). */
  forget(ws: S): void;
  /** Stop the sweep interval. */
  dispose(): void;
}

export function createWsKeepalive<S extends KeepaliveSocket>(deps: WsKeepaliveDeps<S>): WsKeepalive<S> {
  const heartbeatMs = deps.heartbeatMs ?? HEARTBEAT_MS;
  const alive = new Map<S, boolean>();

  const timer = setInterval(() => {
    for (const [ws, isAlive] of alive) {
      if (!isAlive) {
        alive.delete(ws);
        ws.terminate();
        deps.onDead(ws);
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
    deps.onSweep?.();
  }, heartbeatMs);
  // Never keep the process up for the sweep alone.
  (timer as { unref?: () => void }).unref?.();

  return {
    admit(ws: S): void {
      alive.set(ws, true);
      ws.on('pong', () => {
        if (alive.has(ws)) alive.set(ws, true);
      });
    },
    forget(ws: S): void {
      alive.delete(ws);
    },
    dispose(): void {
      clearInterval(timer);
    },
  };
}

import type { ClientRegistry } from './client-registry';
import type { ServerMessage } from './ws-protocol';

/**
 * The socket-iterating broadcast closures, drained verbatim from main.ts (S11,
 * divergent-change-0004). This is also where resilience-hole-0005's backpressure
 * guard belongs once it lands (S14) — extracted FIRST, in its own commit, so the
 * guard gets its own revert boundary. NO behaviour change in this module's first
 * commit: the four bodies are byte-identical to the main.ts originals modulo the
 * closure → parameter rebinding of `clients` / `encodeServer`.
 */

/** The socket surface the broadcaster drives (structural, so tests use fakes).
 * `close()` comes from the registry's CloseableSocket contract, not from this module. */
export interface BroadcastSocket {
  readonly OPEN: number;
  readyState: number;
  send(data: string | Uint8Array, opts?: { binary?: boolean }): void;
  close(code?: number, reason?: string): void;
}

export interface BroadcasterDeps<S extends BroadcastSocket> {
  clients: ClientRegistry<S>;
  encode(msg: ServerMessage): string;
}

export interface Broadcaster<S extends BroadcastSocket> {
  /** Send a JSON message to every OPEN client (encoded once, same string to all). */
  broadcastJson(msg: ServerMessage): void;
  /** Send a binary RGB preview frame to every OPEN client. */
  broadcastBinary(rgb: Uint8Array): void;
  /** Re-broadcast presence to every client (each gets its own `youAreEditor`). */
  broadcastPresence(): void;
  /** Relay a server message to every client EXCEPT `sender` (the live library relay). */
  relayToOthers(sender: S, msg: ServerMessage): void;
}

export function createBroadcaster<S extends BroadcastSocket>(deps: BroadcasterDeps<S>): Broadcaster<S> {
  const { clients, encode } = deps;

  function broadcastJson(msg: ServerMessage): void {
    const data = encode(msg);
    for (const ws of clients) {
      if (ws.readyState === ws.OPEN) ws.send(data);
    }
  }

  function broadcastBinary(rgb: Uint8Array): void {
    for (const ws of clients) {
      if (ws.readyState === ws.OPEN) ws.send(rgb, { binary: true });
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

  return { broadcastJson, broadcastBinary, broadcastPresence, relayToOthers };
}

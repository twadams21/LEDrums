import type { IncomingMessage } from 'node:http';
import { admitDecision, isTrustedHost, isViaCloudflare, type MutablePinGate } from './pin-gate';
import type { ClientRegistry } from './client-registry';
import type { MonitorDraft } from './monitor';
import { decodeClient, encodeServer, type ClientMessage, type ServerMessage } from './ws-protocol';
import type { BroadcastSocket } from './ws-broadcast';

/**
 * The WS connection handler, drained verbatim from main.ts (S12, divergent-change-0004):
 * admit decision, tunnel tagging, presence-then-state-then-replay, the message
 * try/catch, and close/error cleanup. This is where resilience-hole-0013's redaction
 * (S15) and the connection cap (S16) land once the body is testable — extracted FIRST
 * in its own commit with the bodies byte-identical modulo closure → deps rebinding.
 */

/** The socket surface the connection handler drives (structural for tests). */
export interface ConnectionSocket extends BroadcastSocket {
  on(event: 'message', cb: (raw: { toString(): string }, isBinary: boolean) => void): void;
  on(event: 'close' | 'error', cb: () => void): void;
}

/** The request surface the admit decision reads (structural for tests). */
export interface ConnectionRequest {
  socket: { remoteAddress?: string };
  headers: IncomingMessage['headers'];
  url?: string;
}

export interface WsConnectionDeps<S extends ConnectionSocket> {
  hostToken: string | null;
  pinGate: MutablePinGate;
  clients: ClientRegistry<S>;
  /** Sockets that connected VIA the share tunnel (cf-* headers at admit). */
  tunnelClients: { add(ws: S): void };
  monitor(event: MonitorDraft): void;
  broadcastPresence(): void;
  stateMessage(): ServerMessage;
  /** Replay the retained Monitor history to one socket (monitorBus.replay). */
  replayMonitor(sendOne: (msg: ServerMessage) => void): void;
  /** The per-input monitor event, bound to the `ws` origin by the wiring. */
  monitorInput(msg: ClientMessage): void;
  handleClientMessage(msg: ClientMessage, ws: S): void;
  /** Clear this socket's controller-panel interest (controllerMonitor.dropWatcher). */
  dropWatcher(ws: S): void;
  /** Local-only logger; defaults to `console.error`. */
  log?(message: string, detail: string): void;
}

export function createWsConnectionHandler<S extends ConnectionSocket>(
  deps: WsConnectionDeps<S>,
): (ws: S, req: ConnectionRequest) => void {
  const { hostToken, pinGate, clients, tunnelClients, monitor, broadcastPresence, stateMessage, replayMonitor, monitorInput, handleClientMessage, dropWatcher } = deps;
  const log = deps.log ?? ((message: string, detail: string): void => console.error(message, detail));

  return function handleConnection(ws: S, req: ConnectionRequest): void {
    // PIN gate (S3): refuse a connection with a wrong/absent room PIN BEFORE it is admitted to the
    // registry or sent any presence/state/frames — so an un-authed client can neither view nor
    // mutate. The PIN rides the connect URL query (`?pin=…`). An open gate (no PIN configured)
    // admits everyone, so plain local dev is unchanged.
    //
    // Host bypass: the host's OWN app window is admitted without a PIN — but loopback alone is not
    // proof of that (any local tab/script is also loopback), so the bypass requires the unguessable
    // per-run host token the window was handed (plus loopback + not-via-cloudflared). Remote clients
    // (cf-* headers) and LAN peers (non-loopback) can never satisfy it, so both stay gated.
    const trustedLocal = isTrustedHost({
      remoteAddress: req.socket.remoteAddress,
      headers: req.headers,
      url: req.url,
      hostToken,
    });
    const decision = admitDecision(req.url, pinGate, trustedLocal);
    if (!decision.ok) {
      ws.close(decision.code, decision.reason);
      return;
    }

    // Admit additively (no eviction) — the first client auto-claims the editor slot, later clients
    // are viewers. Broadcast presence to EVERY client FIRST (so this newcomer learns its role before
    // the `state` below — messages are ordered on the socket), then ship its initial state.
    clients.admit(ws);
    if (isViaCloudflare(req.headers)) tunnelClients.add(ws);
    monitor({ type: 'system', direction: 'local', source: 'server', destination: 'ws', label: 'WebSocket client accepted' });
    broadcastPresence();
    ws.send(encodeServer(stateMessage()));
    replayMonitor((msg) => ws.send(encodeServer(msg)));

    ws.on('message', (raw, isBinary) => {
      if (isBinary) return; // clients send JSON only
      let handled = false;
      try {
        const msg = decodeClient(raw.toString());
        handled = true;
        monitorInput(msg);
        handleClientMessage(msg, ws);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (handled) {
          // Error escaped the handler — log, but keep the socket alive.
          log('[ws] handler error:', message);
        }
        monitor({ type: 'error', direction: 'local', source: 'server/ws', label: handled ? 'WebSocket handler error' : 'WebSocket decode error', detail: message });
        ws.send(encodeServer({ t: 'error', message }));
      }
    });

    // On disconnect, drop the socket and re-broadcast presence (headcount changed, and the editor
    // slot may have moved per the registry's election rule).
    ws.on('close', () => {
      clients.remove(ws);
      dropWatcher(ws);
      broadcastPresence();
    });
    ws.on('error', () => {
      clients.remove(ws);
      dropWatcher(ws);
      broadcastPresence();
    });
  };
}

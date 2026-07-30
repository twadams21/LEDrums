import type { IncomingMessage } from 'node:http';
import { admitDecision, isTrustedHost, isViaCloudflare, type MutablePinGate } from './pin-gate';
import type { ClientRegistry } from './client-registry';
import type { MonitorDraft } from './monitor';
import { randomBytes } from 'node:crypto';
import { clientErrorMessage, decodeClient, encodeServer, type ClientMessage, type ServerMessage } from './ws-protocol';
import type { BroadcastSocket } from './ws-broadcast';
import { createWsKeepalive, type KeepaliveSocket } from './ws-keepalive';

/**
 * The WS connection handler, drained verbatim from main.ts (S12, divergent-change-0004):
 * admit decision, tunnel tagging, presence-then-state-then-replay, the message
 * try/catch, and close/error cleanup. This is where resilience-hole-0013's redaction
 * (S15) and the connection cap (S16) land once the body is testable — extracted FIRST
 * in its own commit with the bodies byte-identical modulo closure → deps rebinding.
 */

/** The socket surface the connection handler drives (structural for tests). */
export interface ConnectionSocket extends BroadcastSocket, KeepaliveSocket {
  on(event: 'message', cb: (raw: { toString(): string }, isBinary: boolean) => void): void;
  on(event: 'close' | 'error' | 'pong', cb: () => void): void;
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
  /** Sockets that connected VIA the share tunnel (cf-* headers at admit). `has` feeds
   * the error-frame redaction (S15): tunnel peers get the fixed ref-only sentence. */
  tunnelClients: { add(ws: S): void; has(ws: S): boolean };
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
  /** Keepalive sweep period override (tests). */
  heartbeatMs?: number;
  /** Called once per keepalive sweep AFTER the reap pass — the broadcaster's
   * slow-peer strike clock (S14) rides here so strikes NEVER advance per broadcast. */
  onKeepaliveSweep?(): void;
  /** Env for the one-shot LEDRUMS_MAX_CLIENTS read (S16). Defaults to process.env. */
  env?: Record<string, string | undefined>;
}

/** Max outbound `error` frames per socket per window (S15). All failures still emit
 * Monitor events — only the client-facing frames are limited. Named + test-asserted. */
export const ERROR_FRAMES_PER_WINDOW = 5;
export const ERROR_FRAME_WINDOW_MS = 1_000;

/** Default connection cap (S16, resilience-hole-0005's amplifier): admission was
 * additive with no maximum, so a shared room link multiplies the per-client stats
 * stream without limit on the machine driving a live show. `LEDRUMS_MAX_CLIENTS`
 * (read ONCE at handler construction) overrides for a venue that outgrows it. */
export const MAX_CLIENTS_DEFAULT = 32;

/** Close code for a connection refused because the room is full. NOT 4429 — the
 * decisions doc assigns 4429 to INIT-05's throttled-PIN close. */
export const WS_CLOSE_ROOM_FULL = 4430;

/** One-shot env read of the operational cap. Unset/empty/zero/negative/non-numeric
 * falls back to the default — a typo must never lock everyone out. */
export function resolveMaxClients(env: Record<string, string | undefined>): number {
  const raw = env.LEDRUMS_MAX_CLIENTS;
  if (raw === undefined || raw.trim() === '') return MAX_CLIENTS_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return MAX_CLIENTS_DEFAULT;
  return n;
}

/** The connection handler plus the keepalive disposer boot.ts calls on shutdown. */
export type WsConnectionHandler<S extends ConnectionSocket> = ((ws: S, req: ConnectionRequest) => void) & {
  disposeKeepalive(): void;
};

export function createWsConnectionHandler<S extends ConnectionSocket>(
  deps: WsConnectionDeps<S>,
): WsConnectionHandler<S> {
  const { hostToken, pinGate, clients, tunnelClients, monitor, broadcastPresence, stateMessage, replayMonitor, monitorInput, handleClientMessage, dropWatcher } = deps;
  const log = deps.log ?? ((message: string, detail: string): void => console.error(message, detail));
  const maxClients = resolveMaxClients(deps.env ?? process.env);

  /** Reap wired to the exact body of the close handler below, so a reaped peer is
   * indistinguishable from a normal disconnect to every other subsystem (S13). */
  const keepalive = createWsKeepalive<S>({
    heartbeatMs: deps.heartbeatMs,
    onSweep: deps.onKeepaliveSweep,
    onDead: (ws) => {
      clients.remove(ws);
      dropWatcher(ws);
      broadcastPresence();
    },
  });

  function handleConnection(ws: S, req: ConnectionRequest): void {
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
    const decision = admitDecision(req.url, pinGate, { trustedLocal });
    if (!decision.ok) {
      ws.close(decision.code, decision.reason);
      return;
    }

    // Connection cap (S16) — checked AFTER the PIN decision, so an unauthorised dial
    // gets 4401 and can never consume (or probe) a slot; a full room answers 4430.
    if (clients.size >= maxClients) {
      // Never a silent refusal: the host must be able to see WHY a peer can't join.
      monitor({ type: 'error', direction: 'local', source: 'server/ws', label: 'WebSocket client refused: room full', detail: `${clients.size} clients connected, cap ${maxClients}` });
      ws.close(WS_CLOSE_ROOM_FULL, 'room full');
      return;
    }

    // Admit additively (no eviction) — the first client auto-claims the editor slot, later clients
    // are viewers. Broadcast presence to EVERY client FIRST (so this newcomer learns its role before
    // the `state` below — messages are ordered on the socket), then ship its initial state.
    clients.admit(ws);
    keepalive.admit(ws);
    if (isViaCloudflare(req.headers)) tunnelClients.add(ws);
    monitor({ type: 'system', direction: 'local', source: 'server', destination: 'ws', label: 'WebSocket client accepted' });
    broadcastPresence();
    ws.send(encodeServer(stateMessage()));
    replayMonitor((msg) => ws.send(encodeServer(msg)));

    // Per-socket error-frame limiter (S15): the outbound frames are capped, the
    // Monitor diagnostics never are.
    let errorWindowStart = 0;
    let errorFramesInWindow = 0;

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
        // The Monitor event keeps the FULL diagnostic (message + stack) under the same
        // correlation ref the client frame carries; only the outbound frame is redacted.
        const ref = randomBytes(4).toString('hex');
        const stack = err instanceof Error && err.stack ? `\n${err.stack}` : '';
        monitor({ type: 'error', direction: 'local', source: 'server/ws', label: handled ? 'WebSocket handler error' : 'WebSocket decode error', detail: `ref ${ref}: ${message}${stack}` });
        const now = Date.now();
        if (now - errorWindowStart >= ERROR_FRAME_WINDOW_MS) {
          errorWindowStart = now;
          errorFramesInWindow = 0;
        }
        if (errorFramesInWindow < ERROR_FRAMES_PER_WINDOW) {
          errorFramesInWindow++;
          ws.send(encodeServer({ t: 'error', message: clientErrorMessage(err, tunnelClients.has(ws), ref) }));
        }
      }
    });

    // On disconnect, drop the socket and re-broadcast presence (headcount changed, and the editor
    // slot may have moved per the registry's election rule).
    ws.on('close', () => {
      keepalive.forget(ws);
      clients.remove(ws);
      dropWatcher(ws);
      broadcastPresence();
    });
    ws.on('error', () => {
      keepalive.forget(ws);
      clients.remove(ws);
      dropWatcher(ws);
      broadcastPresence();
    });
  }

  const handler = handleConnection as WsConnectionHandler<S>;
  handler.disposeKeepalive = () => keepalive.dispose();
  return handler;
}

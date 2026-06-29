import { WS_PATH } from '@ledrums/core';
import { WS_CLOSE_INVALID_PIN } from '@ledrums/protocol';
import {
  decodeServer,
  type ClientMessage,
  type EffectSpec,
  type OutputStatus,
  type SerializedModel,
  type ServerMessage,
  type ShowLibraryBlob,
  type TunnelInfo,
  type VoiceStats,
} from './protocol-types';
import type { EngineStats, Project } from '@ledrums/core';

export type ConnectionState = 'connecting' | 'open' | 'closed';

/** Minimal structural type so the client is testable with a fake WebSocket. */
export interface WSLike {
  binaryType: string;
  readyState: number;
  onopen: ((ev?: unknown) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  send(data: string): void;
  close(): void;
}

export type WSFactory = (url: string) => WSLike;

export interface WSCallbacks {
  onState?: (
    project: Project,
    model: SerializedModel,
    effects: EffectSpec[],
    projects: string[],
    output: OutputStatus,
    showLibrary: ShowLibraryBlob | null,
    tunnel: TunnelInfo | null,
  ) => void;
  onFrame?: (frame: Uint8Array) => void;
  onStats?: (stats: EngineStats, latencyMs: number, fps: number, output: OutputStatus, voice?: VoiceStats) => void;
  onInput?: (kind: 'midi' | 'osc', label: string, value: number) => void;
  onProjects?: (names: string[]) => void;
  /** Multi-client presence (S1): who is the single editor, whether WE are it, and the headcount. */
  onPresence?: (editorId: string | null, youAreEditor: boolean, clientCount: number) => void;
  /** Live authored-library push (S1): the editor's library relayed by the server — a viewer adopts
      it without a full `state` rebuild. */
  onShowLibrary?: (library: ShowLibraryBlob) => void;
  onError?: (message: string) => void;
  onConnection?: (state: ConnectionState) => void;
  /** The server refused the connection for a wrong/absent room PIN (close 4401). The reconnect
      loop is paused; supply a PIN via {@link WSClient.reconnectWithPin} to retry. */
  onAuthError?: () => void;
}

export interface WSClientOptions {
  url?: string;
  factory?: WSFactory;
  /** Initial reconnect delay (ms); grows with backoff up to maxDelayMs. */
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Room PIN sent on connect as the `?pin=` query (S3). null/empty = none (open server). */
  pin?: string | null;
  /** Host-session token sent on connect as the `?hostToken=` query (S4 desktop) — the packaged app
   * injects it so the host's own window is admitted without the room PIN. null/empty for browsers. */
  hostToken?: string | null;
}

function defaultUrl(): string {
  const loc =
    typeof location !== 'undefined' ? location : { host: 'localhost', protocol: 'http:' };
  // Match the page protocol so HTTPS pages (e.g. behind a Tailscale/HTTPS proxy)
  // use wss:// — a ws:// socket from an https:// page is blocked as mixed content.
  const scheme = loc.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${loc.host}${WS_PATH}`;
}

function defaultFactory(url: string): WSLike {
  return new WebSocket(url) as unknown as WSLike;
}

/**
 * WebSocket client with auto-reconnect + exponential backoff. Tolerates the
 * server-not-yet-bound dev startup race. Distinguishes text (JSON ServerMessage)
 * from binary (Uint8Array RGB frame) payloads. All callbacks are best-effort.
 */
export class WSClient {
  private readonly url: string;
  private readonly factory: WSFactory;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;

  private ws: WSLike | null = null;
  private cb: WSCallbacks = {};
  private attempt = 0;
  private closedByUser = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Room PIN appended to the connect URL (S3); null/empty when the server is open. */
  private pin: string | null;
  /** Host-session token appended to the connect URL (S4 desktop); null for browser/remote clients.
   * Fixed for the tab's lifetime — set once from the injected window URL, never re-prompted. */
  private readonly hostToken: string | null;
  /** The last connect was refused for a bad PIN (close 4401) — the reconnect loop is paused
      until {@link reconnectWithPin} supplies a new one. */
  private authRejected = false;

  constructor(opts: WSClientOptions = {}) {
    this.url = opts.url ?? defaultUrl();
    this.factory = opts.factory ?? defaultFactory;
    this.baseDelayMs = opts.baseDelayMs ?? 500;
    this.maxDelayMs = opts.maxDelayMs ?? 8000;
    this.pin = opts.pin ?? null;
    this.hostToken = opts.hostToken ?? null;
  }

  /** The connect URL with the room PIN (`?pin=`) and/or host token (`?hostToken=`) appended when set. */
  private dialUrl(): string {
    const params = new URLSearchParams();
    if (this.pin) params.set('pin', this.pin);
    if (this.hostToken) params.set('hostToken', this.hostToken);
    const qs = params.toString();
    if (!qs) return this.url;
    const sep = this.url.includes('?') ? '&' : '?';
    return `${this.url}${sep}${qs}`;
  }

  on(cb: WSCallbacks): void {
    this.cb = cb;
  }

  /** Open the socket (idempotent while one is live). */
  connect(): void {
    this.closedByUser = false;
    this.openSocket();
  }

  /** Whether the last connect was refused for a bad/absent PIN (reconnect is paused). */
  get hasAuthError(): boolean {
    return this.authRejected;
  }

  /** Retry the connection with a (new) room PIN after a 4401 refusal. Clears the auth-paused
      state, tears down any stale socket/timer, and dials again from a fresh backoff. */
  reconnectWithPin(pin: string): void {
    this.pin = pin;
    this.authRejected = false;
    this.closedByUser = false;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.attempt = 0;
    this.openSocket();
  }

  private openSocket(): void {
    this.cb.onConnection?.('connecting');
    let ws: WSLike;
    try {
      ws = this.factory(this.dialUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      this.attempt = 0;
      this.cb.onConnection?.('open');
    };
    ws.onclose = (ev?: unknown) => {
      this.cb.onConnection?.('closed');
      this.ws = null;
      // A 4401 close means the server refused our PIN. Don't dial forever against a gate we
      // can't pass — pause reconnect and surface it so the UI can prompt for a PIN.
      const code = (ev as { code?: number } | undefined)?.code;
      if (code === WS_CLOSE_INVALID_PIN) {
        this.authRejected = true;
        this.cb.onAuthError?.();
        return;
      }
      if (!this.closedByUser) this.scheduleReconnect();
    };
    ws.onerror = () => {
      // The close handler drives reconnect; swallow to avoid uncaught errors.
    };
    ws.onmessage = (ev: { data: unknown }) => this.handleMessage(ev.data);
  }

  private handleMessage(data: unknown): void {
    // Binary path: a quantized RGB frame (Uint8Array, length pixelCount*3).
    if (data instanceof ArrayBuffer) {
      this.cb.onFrame?.(new Uint8Array(data));
      return;
    }
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
      void data.arrayBuffer().then((buf) => this.cb.onFrame?.(new Uint8Array(buf)));
      return;
    }
    if (data instanceof Uint8Array) {
      this.cb.onFrame?.(data);
      return;
    }
    // Text path: a JSON ServerMessage.
    if (typeof data === 'string') {
      const msg = decodeServer(data);
      if (msg) this.dispatch(msg);
      return;
    }
    // Anything else is ignored (malformed).
  }

  private dispatch(msg: ServerMessage): void {
    switch (msg.t) {
      case 'state':
        this.cb.onState?.(msg.project, msg.model, msg.effects, msg.projects, msg.output, msg.showLibrary, msg.tunnel);
        break;
      case 'stats':
        this.cb.onStats?.(msg.stats, msg.latencyMs, msg.fps, msg.output, msg.voice);
        break;
      case 'input':
        this.cb.onInput?.(msg.kind, msg.label, msg.value);
        break;
      case 'projects':
        this.cb.onProjects?.(msg.names);
        break;
      case 'presence':
        this.cb.onPresence?.(msg.editorId, msg.youAreEditor, msg.clientCount);
        break;
      case 'showLibrary':
        this.cb.onShowLibrary?.(msg.library);
        break;
      case 'error':
        this.cb.onError?.(msg.message);
        break;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    const delay = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** this.attempt);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closedByUser) this.openSocket();
    }, delay);
  }

  /** Send a typed client message as a JSON string. No-op if not open. */
  send(msg: ClientMessage): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1 /* OPEN */) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Drop on transient send failures; reconnect logic handles recovery.
    }
  }

  /** Current reconnect attempt count (0 when connected). */
  get reconnectAttempt(): number {
    return this.attempt;
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }
}

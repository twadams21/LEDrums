import { WS_PATH } from '@ledrums/core';
import {
  decodeServer,
  type ClientMessage,
  type EffectSpec,
  type OutputStatus,
  type SerializedModel,
  type ServerMessage,
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
  ) => void;
  onFrame?: (frame: Uint8Array) => void;
  onStats?: (stats: EngineStats, latencyMs: number, fps: number, output: OutputStatus) => void;
  onInput?: (kind: 'midi' | 'osc', label: string, value: number) => void;
  onProjects?: (names: string[]) => void;
  onError?: (message: string) => void;
  onConnection?: (state: ConnectionState) => void;
}

export interface WSClientOptions {
  url?: string;
  factory?: WSFactory;
  /** Initial reconnect delay (ms); grows with backoff up to maxDelayMs. */
  baseDelayMs?: number;
  maxDelayMs?: number;
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

  constructor(opts: WSClientOptions = {}) {
    this.url = opts.url ?? defaultUrl();
    this.factory = opts.factory ?? defaultFactory;
    this.baseDelayMs = opts.baseDelayMs ?? 500;
    this.maxDelayMs = opts.maxDelayMs ?? 8000;
  }

  on(cb: WSCallbacks): void {
    this.cb = cb;
  }

  /** Open the socket (idempotent while one is live). */
  connect(): void {
    this.closedByUser = false;
    this.openSocket();
  }

  private openSocket(): void {
    this.cb.onConnection?.('connecting');
    let ws: WSLike;
    try {
      ws = this.factory(this.url);
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
    ws.onclose = () => {
      this.cb.onConnection?.('closed');
      this.ws = null;
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
        this.cb.onState?.(msg.project, msg.model, msg.effects, msg.projects, msg.output);
        break;
      case 'stats':
        this.cb.onStats?.(msg.stats, msg.latencyMs, msg.fps, msg.output);
        break;
      case 'input':
        this.cb.onInput?.(msg.kind, msg.label, msg.value);
        break;
      case 'projects':
        this.cb.onProjects?.(msg.names);
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

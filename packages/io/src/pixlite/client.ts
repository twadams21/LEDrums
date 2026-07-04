import { request as httpRequest } from 'node:http';
import { authHash, EMPTY_PASSWORD_AUTH } from './auth';
import { SequentialQueue } from './queue';
import {
  parseResponse,
  parseStatisticResponse,
  parseVersionResponse,
  serializeIdentify,
  serializeModeLive,
  serializeModeTestData,
  serializeStatisticRead,
} from './protocol';
import type {
  ControllerIdentity,
  ControllerStats,
  ModeTestDataParams,
  PixliteClient,
} from './types';

// ── HTTP transport seam ──────────────────────────────────────────────────────
// The network is injected so the client's own unit tests never touch a socket.
// The default uses `node:http` (pure JS, cross-platform, no native addons).

export interface HttpRequestSpec {
  method: 'GET' | 'POST';
  url: string;
  body?: string;
  timeoutMs: number;
}

export interface HttpResponse {
  status: number;
  body: string;
}

export type HttpTransport = (spec: HttpRequestSpec) => Promise<HttpResponse>;

/** Default transport over `node:http`, with a hard per-request timeout. */
export const nodeHttpTransport: HttpTransport = (spec) =>
  new Promise<HttpResponse>((resolve, reject) => {
    const url = new URL(spec.url);
    const headers: Record<string, string> =
      spec.body !== undefined
        ? {
            'Content-Type': 'application/json',
            'Content-Length': String(Buffer.byteLength(spec.body)),
          }
        : {};
    const req = httpRequest(url, { method: spec.method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
      );
    });
    req.on('error', reject);
    req.setTimeout(spec.timeoutMs, () => {
      req.destroy(new Error(`PixLite request to ${spec.url} timed out after ${spec.timeoutMs}ms`));
    });
    if (spec.body !== undefined) req.write(spec.body);
    req.end();
  });

// ── Probe (standalone, unauthenticated) ──────────────────────────────────────

export interface ProbeOptions {
  port?: number;
  transport?: HttpTransport;
}

/**
 * Read a host's identity via unauthenticated `GET /ver` (doc §7.15). Returns
 * null on timeout, connection failure, non-200, or a body that isn't a PixLite
 * version response. Standalone (not queued) so {@link sweep} can fan it out
 * across many hosts — the sequential-request rule is per-controller.
 */
export async function probe(
  host: string,
  timeoutMs: number,
  opts: ProbeOptions = {},
): Promise<ControllerIdentity | null> {
  const transport = opts.transport ?? nodeHttpTransport;
  const port = opts.port ?? 80;
  try {
    const res = await transport({ method: 'GET', url: `http://${host}:${port}/ver`, timeoutMs });
    if (res.status !== 200) return null;
    return parseVersionResponse(res.body, host);
  } catch {
    return null;
  }
}

// ── Real HTTP client ─────────────────────────────────────────────────────────

export interface HttpPixliteClientOptions {
  host: string;
  /** Management/HTTP port. Default 80. */
  port?: number;
  /** API version segment in the request path. Default `v1.7`. */
  apiVersion?: string;
  /** Auth username. Default `admin`. */
  user?: string;
  /**
   * Plaintext password — hashed once at construction. Prefer {@link auth} on the
   * server so the plaintext is never held. Default `''` (unauthenticated).
   */
  password?: string;
  /** Pre-computed `Base64URL(SHA256(password))` hash; overrides {@link password}. */
  auth?: string;
  /** Per-request timeout (ms). Default 2000. */
  timeoutMs?: number;
  /** Injected network. Default {@link nodeHttpTransport}. */
  transport?: HttpTransport;
}

/**
 * Real HTTP adapter. All complexity — auth hashing, strict JSON ordering, the
 * sequential-request queue, timeouts, response parsing — lives here, behind the
 * small {@link PixliteClient} interface. v1 is HTTP-only (no WebSocket): the
 * server polls `statisticRead` at 1–2s.
 */
export class HttpPixliteClient implements PixliteClient {
  readonly host: string;
  private readonly port: number;
  private readonly apiVersion: string;
  private readonly user: string;
  private readonly auth: string;
  private readonly timeoutMs: number;
  private readonly transport: HttpTransport;
  private readonly queue = new SequentialQueue();
  private id = 0;

  constructor(opts: HttpPixliteClientOptions) {
    this.host = opts.host;
    this.port = opts.port ?? 80;
    this.apiVersion = opts.apiVersion ?? 'v1.7';
    this.user = opts.user ?? 'admin';
    this.auth = opts.auth ?? (opts.password ? authHash(opts.password) : EMPTY_PASSWORD_AUTH);
    this.timeoutMs = opts.timeoutMs ?? 2000;
    this.transport = opts.transport ?? nodeHttpTransport;
  }

  probe(timeoutMs: number = this.timeoutMs): Promise<ControllerIdentity | null> {
    // Queued: probing our own controller must respect the sequential rule too.
    return this.queue.run(() =>
      probe(this.host, timeoutMs, { port: this.port, transport: this.transport }),
    );
  }

  statisticRead(paths: string[]): Promise<ControllerStats> {
    return this.queue.run(async () => {
      const body = await this.post(serializeStatisticRead(this.nextId(), paths));
      return parseStatisticResponse(body);
    });
  }

  identify(durationS: number): Promise<void> {
    return this.queue.run(async () => {
      const body = await this.post(serializeIdentify(this.nextId(), durationS));
      parseResponse(body); // surfaces a controller `err` as PixliteError
    });
  }

  modeTestData(params: ModeTestDataParams): Promise<void> {
    return this.queue.run(async () => {
      const body = await this.post(serializeModeTestData(this.nextId(), params));
      parseResponse(body);
    });
  }

  modeLive(): Promise<void> {
    return this.queue.run(async () => {
      const body = await this.post(serializeModeLive(this.nextId()));
      parseResponse(body);
    });
  }

  private nextId(): number {
    this.id = (this.id + 1) & 0x7fffffff;
    return this.id;
  }

  private mgmtUrl(): string {
    // The auth hash is Base64URL — already URL-safe, no encoding needed.
    return `http://${this.host}:${this.port}/${this.apiVersion}/?user=${encodeURIComponent(
      this.user,
    )}&auth=${this.auth}`;
  }

  private async post(bodyText: string): Promise<string> {
    const res = await this.transport({
      method: 'POST',
      url: this.mgmtUrl(),
      body: bodyText,
      timeoutMs: this.timeoutMs,
    });
    if (res.status !== 200) throw new Error(`PixLite HTTP ${res.status} from ${this.host}`);
    return res.body;
  }
}

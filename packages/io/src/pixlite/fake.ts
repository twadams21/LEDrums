/**
 * In-memory fake adapter — the second implementation of {@link PixliteClient}
 * that makes the interface a real seam. The server (S47) injects this in tests
 * to drive discover → adopt → status flows without hardware. Everything is
 * controllable: identity, stats, canned failures, and a per-call delay for
 * exercising the caller's own timing.
 */
import type { Prober } from './sweep';
import type {
  ControllerIdentity,
  ControllerStats,
  ModeTestDataParams,
  PixliteClient,
} from './types';

/** A realistic default identity (mirrors the doc §7.15 example). */
export function defaultIdentity(host = '192.168.0.100'): ControllerIdentity {
  return {
    host,
    prodName: 'PixLite A16-S Mk3',
    nickname: 'Roof Left 1',
    fwVer: '1.2.3',
    apiVer: [{ maj: 'v1', min: [0, 3] }],
    authReqd: false,
  };
}

/** Realistic default stats: three universes receiving, healthy (doc §7.13 Figure 28). */
export function defaultStats(): ControllerStats {
  const uni = (uniNum: number): ControllerStats['universes']['sACN'][number] => ({
    uniNum,
    timedOut: false,
    inGood: 1000,
    inBadSeq: 0,
    inLowPri: 0,
    priority: 100,
    sourceName: 'Your Lighting Software',
  });
  return {
    universes: { sACN: [uni(10), uni(11), uni(12)], artNet: [] },
    rates: { inFrmRate: 45, outFrmRate: 45 },
    health: { tempC: 32.5, bankVoltsMv: [5000, 5000], portStatus: ['Good'], ethLinkUp: [true, true] },
    raw: {},
  };
}

export interface FakePixliteClientOptions {
  host?: string;
  /** Identity returned by `probe()`. null simulates an unreachable/non-PixLite host. */
  identity?: ControllerIdentity | null;
  stats?: ControllerStats;
  /** Artificial per-call delay (ms) — lets callers test their own queue/timeout behavior. */
  delayMs?: number;
}

export class FakePixliteClient implements PixliteClient {
  readonly host: string;
  identity: ControllerIdentity | null;
  stats: ControllerStats;
  delayMs: number;

  /** If set, the *next* call rejects with this error, then it clears. */
  failNext: Error | null = null;

  /** Ordered log of method names — assert sequential ordering in tests. */
  readonly calls: string[] = [];
  /** Durations passed to `identify()`, in order. */
  readonly identifyCalls: number[] = [];
  /** Params passed to `modeTestData()`, in order (S49 hook). */
  readonly testDataCalls: ModeTestDataParams[] = [];

  constructor(opts: FakePixliteClientOptions = {}) {
    this.host = opts.host ?? '192.168.0.100';
    this.identity =
      opts.identity !== undefined ? opts.identity : defaultIdentity(this.host);
    this.stats = opts.stats ?? defaultStats();
    this.delayMs = opts.delayMs ?? 0;
  }

  private async enter<T>(name: string, value: () => T): Promise<T> {
    this.calls.push(name);
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.failNext) {
      const err = this.failNext;
      this.failNext = null;
      throw err;
    }
    return value();
  }

  probe(): Promise<ControllerIdentity | null> {
    return this.enter('probe', () => this.identity);
  }

  statisticRead(_paths: string[]): Promise<ControllerStats> {
    return this.enter('statisticRead', () => this.stats);
  }

  identify(durationS: number): Promise<void> {
    return this.enter('identify', () => {
      this.identifyCalls.push(durationS);
    });
  }

  modeTestData(params: ModeTestDataParams): Promise<void> {
    return this.enter('modeTestData', () => {
      this.testDataCalls.push(params);
    });
  }
}

/**
 * A fake {@link Prober} for {@link sweep} tests: responds with the identity mapped
 * to each host, null for hosts absent from the map. No network involved.
 */
export function makeFakeProber(byHost: Record<string, ControllerIdentity>): Prober {
  return async (host) => byHost[host] ?? null;
}

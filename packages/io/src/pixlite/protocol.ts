/**
 * PixLite wire protocol: request serialization (strict member order) and
 * response parsing. Pure functions — no IO — so the tracer surface can be
 * tested against fixture JSON captured from the API doc.
 */
import { om, stringifyOrdered, type OrderedJson } from './json-order';
import type {
  ControllerIdentity,
  ControllerStats,
  ModeTestDataParams,
  UniverseRx,
} from './types';

/** An error returned by the controller (`err` object, doc §6.3, Figure 4). */
export class PixliteError extends Error {
  constructor(
    readonly code: number,
    msg: string,
  ) {
    super(`PixLite error ${code}: ${msg}`);
    this.name = 'PixliteError';
  }
}

/**
 * Build a request as an ordered object: `req` first, then `id`, then `params`.
 * Serialize with {@link stringifyOrdered} so member order is guaranteed on the
 * wire regardless of how the runtime treats object keys.
 */
export function serializeRequest(req: string, id: number, params?: OrderedJson): string {
  const entries: Array<readonly [string, OrderedJson]> = [
    ['req', req],
    ['id', id],
  ];
  if (params !== undefined) entries.push(['params', params]);
  return stringifyOrdered(om(...entries));
}

export function serializeStatisticRead(id: number, paths: string[]): string {
  return serializeRequest('statisticRead', id, om(['path', paths]));
}

export function serializeIdentify(id: number, durationS: number): string {
  return serializeRequest('identify', id, om(['duration', durationS]));
}

/** `modeLive` request (§7.7.1) — no params. Returns the controller to live mode (exits test data). */
export function serializeModeLive(id: number): string {
  return serializeRequest('modeLive', id);
}

/** `modeTestData` params in strict doc order: op, color, colorRes, pixPortNum, pixNum (§7.7.2). */
export function serializeModeTestData(id: number, p: ModeTestDataParams): string {
  const entries: Array<readonly [string, OrderedJson]> = [['op', p.op]];
  if (p.color !== undefined) entries.push(['color', [...p.color]]);
  if (p.colorRes !== undefined) entries.push(['colorRes', p.colorRes]);
  if (p.pixPortNum !== undefined) entries.push(['pixPortNum', p.pixPortNum]);
  if (p.pixNum !== undefined) entries.push(['pixNum', p.pixNum]);
  return serializeRequest('modeTestData', id, om(...entries));
}

interface ResponseEnvelope {
  resp?: string;
  id?: number;
  result?: Record<string, unknown>;
  err?: { code?: number; msg?: string };
}

/** Parse a response body; throw {@link PixliteError} if the controller reported `err`. */
export function parseResponse(bodyText: string): ResponseEnvelope {
  let env: ResponseEnvelope;
  try {
    env = JSON.parse(bodyText) as ResponseEnvelope;
  } catch {
    throw new Error('PixLite response was not valid JSON');
  }
  if (env.err) {
    throw new PixliteError(env.err.code ?? -1, env.err.msg ?? 'unknown error');
  }
  return env;
}

/**
 * Parse a `GET /ver` body into a {@link ControllerIdentity}. Returns null for
 * anything that is not a well-formed PixLite version response, so a probe of a
 * non-PixLite host (or garbage) reads as "no controller here".
 */
export function parseVersionResponse(bodyText: string, host: string): ControllerIdentity | null {
  let env: ResponseEnvelope;
  try {
    env = JSON.parse(bodyText) as ResponseEnvelope;
  } catch {
    return null;
  }
  const r = env.result;
  if (env.resp !== 'version' || !r || typeof r.prodName !== 'string') return null;
  const apiVerRaw = Array.isArray(r.apiVer) ? (r.apiVer as unknown[]) : [];
  return {
    host,
    prodName: r.prodName,
    nickname: typeof r.nickname === 'string' ? r.nickname : '',
    fwVer: typeof r.fwVer === 'string' ? r.fwVer : '',
    apiVer: apiVerRaw.flatMap((v) => {
      if (v && typeof v === 'object' && 'maj' in v) {
        const av = v as { maj?: unknown; min?: unknown };
        return [
          {
            maj: typeof av.maj === 'string' ? av.maj : '',
            min: Array.isArray(av.min) ? (av.min as number[]) : [],
          },
        ];
      }
      return [];
    }),
    authReqd: r.authReqd === true,
  };
}

/** Zip the controller's parallel per-universe arrays into one record per universe. */
function zipUniverses(uni: unknown): UniverseRx[] {
  if (!uni || typeof uni !== 'object') return [];
  const u = uni as Record<string, unknown[]>;
  const nums = Array.isArray(u.uniNum) ? u.uniNum : [];
  return nums.map((uniNum, i) => {
    const rx: UniverseRx = {
      uniNum: uniNum as number,
      timedOut: arrAt(u.timedOut, i) === true,
      inGood: numAt(u.inGood, i),
      inBadSeq: numAt(u.inBadSeq, i),
    };
    if (Array.isArray(u.inLowPri)) rx.inLowPri = numAt(u.inLowPri, i);
    if (Array.isArray(u.priority)) rx.priority = numAt(u.priority, i);
    if (Array.isArray(u.sourceName)) rx.sourceName = String(u.sourceName[i] ?? '');
    return rx;
  });
}

function arrAt(a: unknown, i: number): unknown {
  return Array.isArray(a) ? a[i] : undefined;
}
function numAt(a: unknown, i: number): number {
  const v = arrAt(a, i);
  return typeof v === 'number' ? v : 0;
}

/** Parse a `statistic` object (whole or partial) into the typed {@link ControllerStats} view. */
export function parseStatistic(statistic: Record<string, unknown>): ControllerStats {
  const ethProt = (statistic.ethProt ?? {}) as Record<string, unknown>;
  const inUni = (ethProt.inUni ?? {}) as Record<string, unknown>;
  const pixData = (statistic.pixData ?? {}) as Record<string, unknown>;
  const dev = (statistic.dev ?? {}) as Record<string, unknown>;
  const temp = (dev.temp ?? {}) as Record<string, unknown>;
  const pixPwrOuts = (statistic.pixPwrOuts ?? {}) as Record<string, unknown>;
  const eth = (statistic.eth ?? {}) as Record<string, unknown>;
  const extp = (eth.extp ?? {}) as Record<string, unknown>;

  const rates: ControllerStats['rates'] = {};
  if (typeof pixData.inFrmRate === 'number') rates.inFrmRate = pixData.inFrmRate;
  if (typeof pixData.outFrmRate === 'number') rates.outFrmRate = pixData.outFrmRate;

  const health: ControllerStats['health'] = {};
  if (typeof temp.current === 'number') health.tempC = temp.current;
  if (Array.isArray(dev.bankVolt)) health.bankVoltsMv = dev.bankVolt as number[];
  if (Array.isArray(pixPwrOuts.stat)) health.portStatus = pixPwrOuts.stat as string[];
  if (Array.isArray(extp.linkUp)) health.ethLinkUp = extp.linkUp as boolean[];

  return {
    universes: { sACN: zipUniverses(inUni.sACN), artNet: zipUniverses(inUni.artNet) },
    rates,
    health,
    raw: statistic,
  };
}

/** Parse a `statisticRead` response body into {@link ControllerStats}. */
export function parseStatisticResponse(bodyText: string): ControllerStats {
  const env = parseResponse(bodyText);
  const statistic = env.result?.statistic;
  if (!statistic || typeof statistic !== 'object') {
    throw new Error('statisticRead response missing result.statistic');
  }
  return parseStatistic(statistic as Record<string, unknown>);
}

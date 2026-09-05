import { lazyResource } from './lazy-resource.svelte';

/* Recovery for deferred UI code. Browsers retain rejected module-map entries even
   after connectivity returns, so a retry needs a NEW entry URL, not another call to
   the same import(). Recovery is licensed only by evidence about THIS boundary's
   own attempt: the exact URL it requested, from this origin, during this attempt,
   with a witnessed failed download. Anything ambiguous (an evaluation error, a
   shared dependency failing behind a delivered entry, a policy block, an opaque
   redirect, a missing/evicted timing entry) gets safe reopen guidance instead of a
   retry that cannot work. The shared runtime is never re-imported: a second copy
   of stores/engine state is worse than a reload the operator controls. */

export interface ResourceTiming {
  name: string;
  responseStatus?: number;
  initiatorType?: string;
  startTime?: number;
}

export type AttemptOutcome =
  | { kind: 'delivered'; status: number }
  | { kind: 'http'; status: number }
  | { kind: 'opaque' }
  | null;

/** The Chrome/Firefox/Safari wording for a module whose fetch was refused. */
const FETCH_FAILURE = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i;
const STYLE_ASSET = /^\/assets\/(.+)-[\w-]+\.css$/;

function entryPattern(entry: string): RegExp {
  return new RegExp(`^/assets/${entry}-[\\w-]+\\.js$`);
}

function stripQuery(url: string): string {
  const parsed = new URL(url);
  parsed.search = '';
  parsed.hash = '';
  return parsed.href;
}

/** The exact entry URL a fetch-failure error reports, or null when the message does
 * not describe THIS boundary's attempt. A first attempt must report the bare Vite
 * entry; a retry must report the very URL that retry requested. A message naming a
 * different query (or nothing at all) is not evidence about our request. */
export function reportedEntryUrl(error: unknown, entry: string, origin: string, attemptedUrl: string | null): string | null {
  if (!(error instanceof TypeError) || !FETCH_FAILURE.test(error.message)) return null;
  const reported = error.message.match(/https?:\/\/[^\s'"<>]+/)?.[0];
  if (!reported) return null;
  try {
    const url = new URL(reported);
    if (url.origin !== origin || url.username || url.password || url.hash) return null;
    if (!entryPattern(entry).test(url.pathname)) return null;
    if (attemptedUrl !== null) return url.href === attemptedUrl ? url.href : null;
    return url.search === '' ? url.href : null;
  } catch { return null; }
}

/** What Resource Timing witnessed for the exact URL of this attempt. Only requests
 * started during the attempt by a script/link initiator count: an icon probe, an
 * older attempt, or a query-variant of the same path is not our request. Engines
 * that omit responseStatus, and evicted buffers, yield null (no evidence). */
export function attemptOutcome(
  url: string,
  timings: readonly ResourceTiming[],
  since = 0,
  initiators: readonly string[] = ['script', 'link'],
): AttemptOutcome {
  const latest = timings
    .filter((timing) => timing.name === url && (timing.startTime ?? 0) >= since
      && (timing.initiatorType === undefined || initiators.includes(timing.initiatorType)))
    .at(-1);
  const status = latest?.responseStatus;
  if (status === undefined) return null;
  if (status === 0) return { kind: 'opaque' };
  if (status >= 400) return { kind: 'http', status };
  return { kind: 'delivered', status };
}

export function failedStyleUrl(error: unknown, origin: string): string | null {
  if (!(error instanceof Error)) return null;
  const path = error.message.match(/^Unable to preload CSS for (.+)$/)?.[1];
  if (!path) return null;
  try {
    const url = new URL(path, origin);
    return url.origin === origin && !url.username && !url.password && STYLE_ASSET.test(url.pathname)
      ? stripQuery(url.href) : null;
  } catch { return null; }
}

/** Vite names a chunk's stylesheet after the chunk. A stylesheet named after a
 * registered lazy entry belongs to that boundary alone; every other asset
 * stylesheet is a shared dependency any boundary may need. */
export function styleOwner(href: string, entries: ReadonlySet<string>): string | null {
  const name = new URL(href).pathname.match(STYLE_ASSET)?.[1];
  return name !== undefined && entries.has(name) ? name : null;
}

export interface LazyEnvironment {
  readonly origin: string;
  readonly document: Document | null;
  timings(): readonly ResourceTiming[];
  now(): number;
  online(): boolean | undefined;
  /** Resolves true when a request for the URL completed at the network level (any
   * status, opaque redirects included) and false when the network refused it. */
  probe(url: string): Promise<boolean>;
  onPreloadError(listener: (error: unknown) => void): void;
}

interface StyleRecord {
  readonly href: string;
  failed: boolean;
  attempts: number;
  /** Whether the latest witnessed failure was a real download failure. */
  verdict: Promise<boolean>;
  repair?: Promise<void>;
}

/** Stylesheet ownership shared by every boundary. Vite remembers each attempted
 * preload for the page's lifetime, including rejected ones, so a later boundary
 * that needs the same stylesheet gets no second attempt and no error. The registry
 * therefore records witnessed failures once, repairs each stylesheet at most once
 * at a time, and lets each boundary gate readiness on the styles it needs. */
export interface LazyHost {
  readonly env: LazyEnvironment;
  readonly entries: Set<string>;
  readonly styles: Map<string, StyleRecord>;
}

export function createLazyHost(env: LazyEnvironment): LazyHost {
  const host: LazyHost = { env, entries: new Set(), styles: new Map() };
  env.onPreloadError((error) => {
    const href = failedStyleUrl(error, env.origin);
    if (href) witnessStyleFailure(host, href, 0, href);
  });
  return host;
}

/** A status-0 failure is ambiguous: offline, an abort, a policy block and an opaque
 * cross-origin redirect all report 0, and only the first two are recoverable by
 * retrying. Being offline is corroboration enough; otherwise a HEAD probe of the
 * same URL (never an import) settles whether the network refused the request. */
async function recoverable(outcome: AttemptOutcome, url: string, env: LazyEnvironment): Promise<boolean> {
  if (!outcome) return false;
  if (outcome.kind === 'http') return true;
  if (outcome.kind === 'delivered') return false;
  if (env.online() === false) return true;
  return !(await env.probe(url));
}

function witnessStyleFailure(host: LazyHost, href: string, since: number, attemptedUrl: string): StyleRecord {
  const existing = host.styles.get(href);
  const record: StyleRecord = existing ?? { href, failed: false, attempts: 0, verdict: Promise.resolve(false) };
  record.failed = true;
  record.verdict = recoverable(attemptOutcome(attemptedUrl, host.env.timings(), since, ['link', 'css']), attemptedUrl, host.env)
    .catch(() => false);
  host.styles.set(href, record);
  return record;
}

/** Replace only the failed stylesheet and await its real load. Chrome gives even a
 * failed link an empty .sheet, so the load event is the evidence, not .sheet. */
function repairStyle(host: LazyHost, record: StyleRecord): Promise<void> {
  if (record.repair) return record.repair;
  const { document, now } = host.env;
  if (!document) return Promise.reject(new Error(`Unable to preload CSS for ${record.href}`));
  const since = now();
  const attemptedUrl = `${record.href}?load-retry=${++record.attempts}`;
  record.repair = new Promise<void>((resolve, reject) => {
    const target = new URL(record.href);
    for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')) {
      const source = new URL(link.href, target.origin);
      if (source.origin === target.origin && source.pathname === target.pathname) link.remove();
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = attemptedUrl;
    link.onload = () => { record.failed = false; resolve(); };
    link.onerror = () => {
      link.remove();
      witnessStyleFailure(host, record.href, since, attemptedUrl);
      reject(new Error(`Unable to preload CSS for ${record.href}`));
    };
    document.head.append(link);
  }).finally(() => { record.repair = undefined; });
  return record.repair;
}

/** Vite awaits every preload but throws at its FIRST rejection, so sibling
 * stylesheets that failed in the same graph get no event. Witness them from the
 * bare preload links Vite left in the document, by exact-URL evidence only. */
function witnessUnreportedStyleFailures(host: LazyHost): void {
  const { document, origin } = host.env;
  if (!document) return;
  const timings = host.env.timings();
  for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')) {
    let href: URL;
    try { href = new URL(link.href); } catch { continue; }
    if (href.origin !== origin || href.search || href.hash || !STYLE_ASSET.test(href.pathname)) continue;
    if (host.styles.get(href.href)?.failed) continue;
    const outcome = attemptOutcome(href.href, timings, 0, ['link', 'css']);
    if (outcome && outcome.kind !== 'delivered') witnessStyleFailure(host, href.href, 0, href.href);
  }
}

function requiredFailedStyles(host: LazyHost, entry: string): StyleRecord[] {
  return [...host.styles.values()].filter((record) => {
    if (!record.failed) return false;
    const owner = styleOwner(record.href, host.entries);
    return owner === null || owner === entry;
  });
}

class StyleFailure extends Error {
  constructor(readonly retryable: boolean, hrefs: string[]) {
    super(`Unable to preload CSS for ${hrefs.join(', ')}`);
  }
}

/** Repair every failed stylesheet this boundary needs (its own, or a shared one),
 * and fail closed rather than paint unstyled content. Another boundary's own
 * stylesheet is not our problem: its recovery stays with that boundary. */
async function repairRequiredStyles(host: LazyHost, entry: string): Promise<void> {
  const required = requiredFailedStyles(host, entry);
  if (!required.length) return;
  const results = await Promise.allSettled(required.map((record) => repairStyle(host, record)));
  if (results.every((result) => result.status === 'fulfilled')) return;
  const still = requiredFailedStyles(host, entry);
  const verdicts = await Promise.all(still.map((record) => record.verdict));
  throw new StyleFailure(still.length > 0 && verdicts.every(Boolean), still.map((record) => record.href));
}

function browserEnvironment(): LazyEnvironment {
  return {
    origin: typeof location === 'undefined' ? '' : location.origin,
    document: typeof document === 'undefined' ? null : document,
    timings: () => (typeof performance === 'undefined'
      ? [] : performance.getEntriesByType('resource') as unknown as ResourceTiming[]),
    now: () => (typeof performance === 'undefined' ? 0 : performance.now()),
    online: () => (typeof navigator === 'undefined' ? undefined : navigator.onLine),
    probe: async (url) => {
      try {
        await fetch(url, { method: 'HEAD', cache: 'no-store', redirect: 'manual', credentials: 'same-origin' });
        return true;
      } catch { return false; }
    },
    onPreloadError: (listener) => {
      if (typeof window === 'undefined') return;
      window.addEventListener('vite:preloadError', (event) => listener((event as Event & { payload?: unknown }).payload));
    },
  };
}

let defaultHost: LazyHost | undefined;

export function lazyComponent<T>(
  entry: string,
  importer: () => Promise<{ default: T }>,
  host: LazyHost = (defaultHost ??= createLazyHost(browserEnvironment())),
) {
  host.entries.add(entry);
  /** The bare entry URL whose download was witnessed failing; null until proven. */
  let recoveryBase: string | null = null;
  let attempt = 0;
  let retryable = false;
  return lazyResource(async () => {
    attempt++;
    retryable = false;
    const since = host.env.now();
    // Styles this boundary needs may already have failed under another boundary's
    // attempt; Vite will silently skip them, so repair before importing.
    await repairRequiredStyles(host, entry);
    // A monotonically new URL permits repeated explicit retries of the declared
    // entry only. Vite's original preload graph is used on first load.
    const attemptedUrl = recoveryBase ? `${recoveryBase}?load-retry=${attempt}` : null;
    let module: { default: T };
    try {
      module = attemptedUrl ? await import(/* @vite-ignore */ attemptedUrl) : await importer();
    } catch (error) {
      // Vite's preloadError event already witnessed the same rejection in browsers
      // that dispatch it; engines without the event still land here.
      const style = failedStyleUrl(error, host.env.origin);
      if (style) {
        if (!host.styles.get(style)?.failed) witnessStyleFailure(host, style, 0, style);
        witnessUnreportedStyleFailures(host);
      }
      const reported = reportedEntryUrl(error, entry, host.env.origin, attemptedUrl);
      if (reported) {
        retryable = await recoverable(attemptOutcome(reported, host.env.timings(), since), reported, host.env);
        recoveryBase = retryable ? stripQuery(reported) : null;
      } else if (style) {
        const verdicts = await Promise.all(requiredFailedStyles(host, entry).map((record) => record.verdict));
        retryable = verdicts.length > 0 && verdicts.every(Boolean);
      }
      throw error;
    }
    // A shared stylesheet may have failed under a concurrent attempt after Vite
    // skipped it for us. Resolved code is not readiness; required styles are.
    await repairRequiredStyles(host, entry);
    return module.default;
  }, (error) => (error instanceof StyleFailure ? error.retryable : retryable));
}

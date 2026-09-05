import { lazyResource } from './lazy-resource.svelte';

/** Browsers retain rejected module-map entries even after connectivity returns.
 * A retry needs a new URL, not another call to the same import(). Only recover a
 * reported fetch failure for THIS entry, from THIS origin; never interpret an
 * evaluation error or an arbitrary error string as permission to import code.
 * Some engines omit the URL. There we offer explicit safe-reopen guidance rather
 * than a fake retry; never auto-reload a live rig. */
export function failedEntryUrl(error: unknown, entry: string, origin: string): string | null {
  if (!(error instanceof TypeError)) return null;
  if (!/Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(error.message)) return null;
  const reported = error.message.match(/https?:\/\/[^\s'"<>]+/)?.[0];
  if (!reported) return null;
  try {
    const url = new URL(reported);
    if (url.origin !== origin || url.username || url.password) return null;
    // Vite production entries, not arbitrary paths or shared dependencies. Recovery
    // for a failed shared dependency is deliberately not a recursive module rewrite.
    if (!new RegExp(`^/assets/${entry}-[\\w-]+\\.js$`).test(url.pathname)) return null;
    url.search = '';
    url.hash = '';
    return url.href;
  } catch { return null; }
}

/** Chrome can report the ENTRY url when a SHARED dependency failed. Only a
 * recorded failed HTTP request licenses entry recovery. Missing/evicted timing
 * evidence (including engines without responseStatus) means safe reopen instead. */
export function entryFetchFailed(url: string, timings: readonly { name: string; responseStatus?: number }[]): boolean {
  const target = new URL(url);
  const requests = timings.filter((timing) => {
    try {
      const request = new URL(timing.name);
      return request.origin === target.origin && request.pathname === target.pathname;
    } catch { return false; }
  });
  const status = requests.at(-1)?.responseStatus;
  return status !== undefined && (status === 0 || status >= 400);
}

export function failedStyleUrl(error: unknown, origin: string): string | null {
  if (!(error instanceof Error)) return null;
  const path = error.message.match(/^Unable to preload CSS for (.+)$/)?.[1];
  if (!path) return null;
  try {
    const url = new URL(path, origin);
    return url.origin === origin && !url.username && !url.password && /^\/assets\/[\w-]+\.css$/.test(url.pathname)
      ? url.href : null;
  } catch { return null; }
}

/** Vite remembers attempted preloads, including rejected ones. Replace only the
 * failed stylesheet and await its actual load before retrying the component. */
function retryStylesheet(url: string, attempt: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')) {
      const source = new URL(link.href);
      if (source.origin === target.origin && source.pathname === target.pathname) link.remove();
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `${url}?load-retry=${attempt}`;
    link.onload = () => resolve();
    link.onerror = () => { link.remove(); reject(new Error(`Unable to preload CSS for ${url}`)); };
    document.head.append(link);
  });
}

export function lazyComponent<T>(entry: string, importer: () => Promise<{ default: T }>) {
  let failedUrl: string | null = null;
  const failedStyles = new Set<string>();
  let attempt = 0;
  return lazyResource(async () => {
    try {
      if (failedStyles.size) {
        const results = await Promise.allSettled([...failedStyles].map(async (url) => {
          await retryStylesheet(url, ++attempt);
          failedStyles.delete(url);
        }));
        const failure = results.find((result) => result.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
      }
      // A monotonically new URL permits repeated explicit retries. Vite's original
      // preload graph is used on first load; imported CSS/shared modules stay cached.
      const module = failedUrl
        ? await import(/* @vite-ignore */ `${failedUrl}?load-retry=${++attempt}`)
        : await importer();
      return module.default as T;
    } catch (error) {
      const origin = typeof location === 'undefined' ? '' : location.origin;
      const candidate = failedEntryUrl(error, entry, origin);
      failedUrl = candidate && typeof performance !== 'undefined'
        && entryFetchFailed(candidate, performance.getEntriesByType('resource')) ? candidate : null;
      const style = failedStyleUrl(error, origin);
      const timings = typeof performance === 'undefined' ? [] : performance.getEntriesByType('resource');
      if (style && entryFetchFailed(style, timings)) {
        failedStyles.add(style);
        // Vite awaits every preload but reports only the first rejection. Retain
        // ALL witnessed failed CSS links or retry could paint a half-styled view.
        // Chrome gives even a failed link an empty .sheet, so that is not evidence.
        for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')) {
          const url = new URL(link.href);
          if (url.origin === origin && /^\/assets\/[\w-]+\.css$/.test(url.pathname)
            && entryFetchFailed(url.href, timings)) failedStyles.add(url.href);
        }
      }
      throw error;
    }
  }, () => failedUrl !== null || failedStyles.size > 0);
}

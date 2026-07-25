import type { ShipTransport } from './ship-queue';

/**
 * A generic HTTP batch transport for a {@link ShipQueue}: POST `{ reports, dropped }` to the ingest
 * endpoint with a static bearer token, throwing on a non-2xx so the queue retains + backs off. Generic
 * over the payload `T` so the backups queue (#123) reuses it against the same Worker with its own T.
 * `fetch` is injected so tests never touch the network.
 */
export function createHttpTransport<T>(opts: {
  endpoint: string;
  token: string;
  fetchFn?: typeof fetch;
}): ShipTransport<T> {
  const doFetch = opts.fetchFn ?? fetch;
  return async (items, meta) => {
    const res = await doFetch(opts.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.token}` },
      body: JSON.stringify({ reports: items, dropped: meta.dropped }),
    });
    if (!res.ok) throw new Error(`ingest responded ${res.status}`);
  };
}

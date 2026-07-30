import type { ShipTransport } from './ship-queue';

/**
 * Is a failed ship worth retrying? The whole taxonomy in one predicate, so the classification can be
 * read and tested in one place rather than inferred from branch order at the call site.
 *
 * Retryable: 5xx (the server is broken, not the request — including the ingest Worker's own 503
 * `storage unavailable`), 408 request timeout, 429 rate limited. Everything else is PERMANENT: a 401
 * will not start working, and a 400/413 batch will be rejected identically on every retry until the
 * heat death of the universe.
 */
export function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

/**
 * A non-2xx from the ingest endpoint, carrying the status class the queue needs to decide what to do
 * about it. The message is byte-identical to the untyped Error this replaced, so existing assertions
 * and log lines are unchanged.
 */
export class ShipHttpError extends Error {
  readonly status: number;
  readonly retryable: boolean;

  constructor(status: number) {
    super(`ingest responded ${status}`);
    this.name = 'ShipHttpError';
    this.status = status;
    this.retryable = isRetryableStatus(status);
  }
}

/**
 * A generic HTTP batch transport for a {@link ShipQueue}: POST `{ reports, dropped }` to the ingest
 * endpoint with a static bearer token, throwing a {@link ShipHttpError} on a non-2xx so the queue can
 * tell a transient outage from a permanent rejection. Generic over the payload `T` so the backups
 * queue (#123) reuses it against the same Worker with its own T. `fetch` is injected so tests never
 * touch the network.
 *
 * A rejected `doFetch` (DNS failure, offline, TLS) is deliberately left alone and propagates as
 * whatever it already is — an unclassified rejection, which the queue keeps treating as retryable.
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
    if (!res.ok) throw new ShipHttpError(res.status);
  };
}

import type { IncomingMessage, ServerResponse } from 'node:http';
import { isTrustedHost } from '../pin-gate';

/**
 * The shared security preamble for host-trusted POST routes (duplicated-code-0006).
 *
 * host-event.ts and native-midi.ts carried the same 28-line scaffold: path match →
 * 405 non-POST → 401 untrusted → byte-capped utf8 accumulation with destroy-on-over →
 * error → 400 → onBody on end. One owner means a hardening change lands once.
 *
 * The body caps stay PER-ROUTE parameters (2048 host-event / 4096 native-MIDI) —
 * changing a guard VALUE is a separate decision and must not ride an extraction.
 */
export interface TrustedPostRouteDeps {
  /** Exact pathname this route owns; anything else falls through (returns false). */
  path: string;
  /** The server's per-run host token (null disables host trust entirely). */
  hostToken: string | null;
  /** Maximum accumulated body length (utf8 chars) before the request is destroyed. */
  maxBody: number;
  /** The Error message used when destroying an over-cap request. */
  tooLargeMessage: string;
  /** Handle the fully-accumulated body (route-specific decode + reply). */
  onBody(raw: string, res: ServerResponse): void;
}

export function sendPlain(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(body);
}

/**
 * Build a host-trusted POST route handler. Returns `(req, res) => boolean`: `true` once it
 * owns the request (route matched), `false` to fall through to the next handler. Behaviour
 * matches the previously-inlined preambles exactly.
 */
export function createTrustedPostRoute(
  deps: TrustedPostRouteDeps,
): (req: IncomingMessage, res: ServerResponse) => boolean {
  const { path, hostToken, maxBody, tooLargeMessage, onBody } = deps;

  return function handleTrustedPost(req: IncomingMessage, res: ServerResponse): boolean {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (pathname !== path) return false;

    if (req.method !== 'POST') {
      sendPlain(res, 405, 'method not allowed');
      return true;
    }

    const trustedLocal = isTrustedHost({
      remoteAddress: req.socket.remoteAddress,
      headers: req.headers,
      url: req.url,
      hostToken,
    });
    if (!trustedLocal) {
      sendPlain(res, 401, 'unauthorized');
      return true;
    }

    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > maxBody) req.destroy(new Error(tooLargeMessage));
    });
    req.on('error', () => {
      if (!res.headersSent) sendPlain(res, 400, 'bad request');
    });
    req.on('end', () => {
      onBody(raw, res);
    });
    return true;
  };
}

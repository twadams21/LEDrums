import type { IncomingMessage, ServerResponse } from 'node:http';
import { isTrustedHost } from '../pin-gate';
import type { MonitorDraft } from '../monitor';

/** POST route the desktop shell uses to report its OWN diagnostics into the server Monitor bus. */
export const HOST_EVENT_PATH = '/api/host-event';

/** Body cap — these are short status lines, not payloads. */
const MAX_BODY = 2048;

/** Severity the shell reports. `error` lands as a Monitor `error` event (red in the app); `info`
 * lands as a `system` event. Nothing else is accepted. */
export type HostEventLevel = 'info' | 'error';

/** The wire shape the desktop shell POSTs. `source`/`detail` are optional context. */
export interface HostEventBody {
  level: HostEventLevel;
  label: string;
  detail?: string;
  source?: string;
}

/**
 * Parse + validate a host-event body. Returns null for anything malformed — the handler answers 400
 * rather than emitting a half-formed Monitor event. Fail-closed: an unknown `level` is rejected, not
 * coerced to `info`, so a shell bug can never downgrade an error into a quiet system line.
 */
export function parseHostEvent(raw: string): HostEventBody | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { level, label, detail, source } = value as Record<string, unknown>;
  if (level !== 'info' && level !== 'error') return null;
  if (typeof label !== 'string' || label.length === 0) return null;
  if (detail !== undefined && typeof detail !== 'string') return null;
  if (source !== undefined && typeof source !== 'string') return null;
  const body: HostEventBody = { level, label };
  if (detail !== undefined) body.detail = detail;
  if (source !== undefined) body.source = source;
  return body;
}

/** Map a validated body onto the Monitor draft the bus emits. `direction` is always `local` — the
 * desktop shell and the server are the same machine. */
export function hostEventToMonitorDraft(body: HostEventBody): MonitorDraft {
  const draft: MonitorDraft = {
    type: body.level === 'error' ? 'error' : 'system',
    direction: 'local',
    source: body.source ?? 'desktop',
    label: body.label,
  };
  if (body.detail !== undefined) draft.detail = body.detail;
  return draft;
}

/** Collaborators the host-event handler needs from the server wiring. */
export interface HostEventDeps {
  /** The server's per-run host token (null disables host trust entirely). */
  hostToken: string | null;
  /** Record the diagnostic on the Monitor bus. */
  monitor(event: MonitorDraft): void;
}

function sendPlain(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(body);
}

/**
 * Build the host-event HTTP handler. Returns `(req, res) => boolean`: `true` once it owns the
 * request (route matched), `false` to fall through to the next handler.
 *
 * Why this exists (#139): the desktop shell's native MIDI bridge could only report failures through
 * `eprintln!`, and a packaged `.app` launched from Finder has no visible stdout — so a drummer whose
 * `LEDrums` port failed to appear got total silence. This is the shell's route into the SAME Monitor
 * stream the server's own `native-midi` errors use, so "the MIDI port did not come up" is visible in
 * the app instead of nowhere.
 *
 * Trust: identical to the native-MIDI route — loopback, not via cloudflared, and holding the exact
 * per-run host token. A remote or LAN caller can never post into the Monitor stream.
 */
export function createHostEventHandler(
  deps: HostEventDeps,
): (req: IncomingMessage, res: ServerResponse) => boolean {
  const { hostToken, monitor } = deps;

  return function handleHostEventHttp(req: IncomingMessage, res: ServerResponse): boolean {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path !== HOST_EVENT_PATH) return false;

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
      if (raw.length > MAX_BODY) req.destroy(new Error('host event payload too large'));
    });
    req.on('error', () => {
      if (!res.headersSent) sendPlain(res, 400, 'bad request');
    });
    req.on('end', () => {
      const body = parseHostEvent(raw);
      if (!body) {
        sendPlain(res, 400, 'bad host event');
        return;
      }
      monitor(hostEventToMonitorDraft(body));
      sendPlain(res, 204, '');
    });
    return true;
  };
}

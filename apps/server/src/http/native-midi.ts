import type { IncomingMessage, ServerResponse } from 'node:http';
import { isTrustedHost } from '../pin-gate';
import type { MonitorDraft } from '../monitor';
import { decodeClient, type ClientMessage } from '../ws-protocol';

/** POST route for the desktop shell's native (Core-MIDI / node-midi) input bridge. */
export const NATIVE_MIDI_PATH = '/api/native-midi';

/** The three MIDI channel-message kinds the native bridge may forward (matches the WS input path). */
export type NativeMidiMessage = Extract<ClientMessage, { t: 'midi' | 'cc' | 'programChange' }>;

/** Only channel MIDI (note/cc/programChange) is accepted over the native bridge; anything else is a
 * 400. Shared decode/dispatch is the same as the WS path — this just fences the payload type. */
export function isNativeMidiMessage(msg: ClientMessage): msg is NativeMidiMessage {
  return msg.t === 'midi' || msg.t === 'cc' || msg.t === 'programChange';
}

/** Collaborators the native-MIDI HTTP handler needs from the server wiring. `hostToken`/host-trust
 * live in pin-gate; `monitorInput`/`dispatch` bind the origin label + the fake input socket the WS
 * message handler expects; `monitor` records the decode-error diagnostic. */
export interface NativeMidiDeps {
  /** The server's per-run host token (null when host bypass is disabled). */
  hostToken: string | null;
  /** Emit the per-input monitor event (bound to the `native-midi` origin by the wiring). */
  monitorInput(msg: NativeMidiMessage): void;
  /** Feed the decoded message into the shared WS client-message handler (bound to a fake socket). */
  dispatch(msg: NativeMidiMessage): void;
  /** Record a diagnostic event (used for the decode-error path). */
  monitor(event: MonitorDraft): void;
}

function sendPlain(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(body);
}

/**
 * Build the native-MIDI HTTP handler. Returns `(req, res) => boolean`: `true` once it owns the
 * request (route matched), `false` to fall through to the next handler. Behaviour matches the
 * inlined server route exactly — POST-only, host-trusted-only, 4KB body cap, decode → type-gate →
 * dispatch, 204 on success, 400 on bad/unsupported payloads.
 */
export function createNativeMidiHandler(
  deps: NativeMidiDeps,
): (req: IncomingMessage, res: ServerResponse) => boolean {
  const { hostToken, monitorInput, dispatch, monitor } = deps;

  return function handleNativeMidiHttp(req: IncomingMessage, res: ServerResponse): boolean {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path !== NATIVE_MIDI_PATH) return false;

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
      if (raw.length > 4096) req.destroy(new Error('native MIDI payload too large'));
    });
    req.on('error', () => {
      if (!res.headersSent) sendPlain(res, 400, 'bad request');
    });
    req.on('end', () => {
      try {
        const msg = decodeClient(raw);
        if (!isNativeMidiMessage(msg)) {
          sendPlain(res, 400, 'unsupported native MIDI message');
          return;
        }
        monitorInput(msg);
        dispatch(msg);
        sendPlain(res, 204, '');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'bad request';
        monitor({ type: 'error', direction: 'local', source: 'server/native-midi', label: 'Native MIDI error', detail: message });
        sendPlain(res, 400, message);
      }
    });
    return true;
  };
}

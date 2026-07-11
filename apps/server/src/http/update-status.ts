import type { IncomingMessage, ServerResponse } from 'node:http';

/** GET route the app polls for an available OTA update (desktop shell). */
export const UPDATE_STATUS_PATH = '/api/update-status';

/** The OTA status payload. `canInstall` is always false today — the server only reports
 * availability; the desktop shell performs the install. */
export interface UpdateStatusResponse {
  available: boolean;
  version: string | null;
  currentVersion: string | null;
  canInstall: false;
  error?: string;
}

/**
 * Compare two dotted/dashed version strings numerically component-by-component (e.g. `1.2.0` vs
 * `1.2-3`). Missing / non-numeric components read as 0. Returns 1 if `a > b`, -1 if `a < b`, 0 if
 * equal. Used to decide whether the manifest version is newer than the running one.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((part) => Number.parseInt(part, 10));
  const pb = b.split(/[.-]/).map((part) => Number.parseInt(part, 10));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const av = Number.isFinite(pa[i]) ? pa[i]! : 0;
    const bv = Number.isFinite(pb[i]) ? pb[i]! : 0;
    if (av !== bv) return av > bv ? 1 : -1;
  }
  return 0;
}

/** Collaborators the update-status handler needs from the server wiring. `endpoint` +
 * `currentVersion` are the OTA env values resolved at boot; `fetchImpl` is injectable so the async
 * manifest branch is testable (defaults to the global `fetch`). */
export interface UpdateStatusDeps {
  /** The OTA manifest URL (`LEDRUMS_OTA_ENDPOINT`), or undefined when OTA is unconfigured. */
  endpoint: string | undefined;
  /** The running app version (`LEDRUMS_APP_VERSION`), or null when unknown. */
  currentVersion: string | null;
  /** Manifest fetcher; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

function sendJson(res: ServerResponse, status: number, body: UpdateStatusResponse): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

/**
 * Build the OTA update-status HTTP handler. Returns `(req, res) => boolean`: `true` once it owns the
 * request (route matched), `false` to fall through. Behaviour matches the inlined server route
 * exactly — GET-only (405 otherwise), 200 with an `unavailable` body when OTA is unconfigured,
 * otherwise fetch the manifest and report whether its version is newer than the running one (all
 * failure paths reply 200 with an `error` field, never a 5xx).
 */
export function createUpdateStatusHandler(
  deps: UpdateStatusDeps,
): (req: IncomingMessage, res: ServerResponse) => boolean {
  const { endpoint, currentVersion, fetchImpl = fetch } = deps;

  return function handleUpdateStatusHttp(req: IncomingMessage, res: ServerResponse): boolean {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path !== UPDATE_STATUS_PATH) return false;

    if (req.method !== 'GET') {
      sendJson(res, 405, { available: false, version: null, currentVersion: null, canInstall: false, error: 'method not allowed' });
      return true;
    }

    if (!endpoint || !currentVersion) {
      sendJson(res, 200, { available: false, version: null, currentVersion, canInstall: false, error: 'OTA status is unavailable on this server.' });
      return true;
    }

    void (async () => {
      try {
        const response = await fetchImpl(endpoint, { redirect: 'follow' });
        if (!response.ok) throw new Error(`manifest returned ${response.status}`);
        const manifest = (await response.json()) as { version?: unknown };
        const version = typeof manifest.version === 'string' ? manifest.version : null;
        sendJson(res, 200, {
          available: !!version && compareVersions(version, currentVersion) > 0,
          version,
          currentVersion,
          canInstall: false,
        });
      } catch (err) {
        sendJson(res, 200, {
          available: false,
          version: null,
          currentVersion,
          canInstall: false,
          error: err instanceof Error ? err.message : 'update check failed',
        });
      }
    })();
    return true;
  };
}

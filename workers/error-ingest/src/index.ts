import { r2Store } from './backups';
import type { ExecutionContext } from './cf';
import { createDiscordNotifier } from './discord';
import { RATE_LIMIT_MAX_NEW_ROWS, RATE_LIMIT_WINDOW_MS, type Env } from './env';
import { getBackup, ingestBackups, ingestBatch, listBackups, listReports, type HandlerResult } from './handlers';
import { d1Store } from './store';
import { parseBackupBatch, parseIngestBatch, ValidationError } from './validate';

const MAX_BODY_BYTES = 1_000_000; // hard cap on the /ingest request body
// Backup bundles carry the whole project + both libraries — larger than an error batch, but still
// bounded so a leaked token can't stream unlimited data into R2.
const MAX_BACKUP_BODY_BYTES = 16_000_000;

function json(result: HandlerResult): Response {
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'content-type': 'application/json' },
  });
}

function error(status: number, message: string): Response {
  return json({ status, body: { error: message } });
}

/** Constant-time-ish bearer check: both routes require `Authorization: Bearer <TELEMETRY_TOKEN>`. */
function authed(req: Request, env: Env): boolean {
  const header = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${env.TELEMETRY_TOKEN}`;
  return env.TELEMETRY_TOKEN.length > 0 && header === expected;
}

export default {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (!authed(req, env)) return error(401, 'unauthorized');

    // POST /ingest — batch write.
    if (req.method === 'POST' && url.pathname === '/ingest') {
      const raw = await req.text();
      if (raw.length > MAX_BODY_BYTES) return error(413, 'payload too large');
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return error(400, 'invalid JSON');
      }
      let batch;
      try {
        batch = parseIngestBatch(parsed);
      } catch (err) {
        return error(400, err instanceof ValidationError ? err.message : 'invalid batch');
      }
      const result = await ingestBatch(
        {
          store: d1Store(env.DB),
          notify: createDiscordNotifier(env.DISCORD_WEBHOOK_URL),
          now: Date.now(),
          rateWindowMs: RATE_LIMIT_WINDOW_MS,
          rateMaxNewRows: RATE_LIMIT_MAX_NEW_ROWS,
        },
        batch,
      );
      return json(result);
    }

    // GET /reports — token-authed JSON read API (machine/version/since filters).
    if (req.method === 'GET' && url.pathname === '/reports') {
      return json(await listReports(d1Store(env.DB), url));
    }

    // POST /backups — batch write of snapshot bundles to R2 (#123). Same envelope as /ingest (the
    // shipper posts items under `reports`); the ROUTE distinguishes it. Bodies are opaque.
    if (req.method === 'POST' && url.pathname === '/backups') {
      const raw = await req.text();
      if (raw.length > MAX_BACKUP_BODY_BYTES) return error(413, 'payload too large');
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return error(400, 'invalid JSON');
      }
      let batch;
      try {
        batch = parseBackupBatch(parsed);
      } catch (err) {
        return error(400, err instanceof ValidationError ? err.message : 'invalid batch');
      }
      return json(await ingestBackups(r2Store(env.BACKUPS), batch));
    }

    // GET /backups?machine= — token-authed listing of a machine's snapshots (metadata only).
    if (req.method === 'GET' && url.pathname === '/backups') {
      return json(await listBackups(r2Store(env.BACKUPS), url));
    }

    // GET /backups/object?key= — fetch one stored bundle body by full R2 key (agent debugging). The
    // body is already JSON, so it is returned verbatim rather than re-wrapped.
    if (req.method === 'GET' && url.pathname === '/backups/object') {
      const result = await getBackup(r2Store(env.BACKUPS), url);
      if (result.status === 200 && typeof result.body === 'string') {
        return new Response(result.body, { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return json(result);
    }

    return error(404, 'not found');
  },
};

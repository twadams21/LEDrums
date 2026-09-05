# LEDrums error-ingest + backups Worker (#122, #123)

A deliberately dumb Cloudflare Worker: it validates a bearer token, validates the shape, and writes
error reports to a D1 table and project backups to an R2 bucket. It also serves token-authed JSON
read APIs and fires a Discord webhook on the first occurrence of each unique error. No HTML, no
dashboard — the read consumer is Trent's AI agent via `curl`.

The queue/ship machinery on the app side (`apps/server/src/telemetry/`) is generic; project backups
(#123) reuse this same Worker with a second `/backups` route (no third shipping mechanism).

## Routes

All require `Authorization: Bearer <TELEMETRY_TOKEN>`.

- `POST /ingest` — body `{ "reports": ReportRecord[], "dropped": number }`. Upserts each report by
  `(machine, version, session, dedupKey)`; repeats bump `count`/`last_seen`. Rate-limited per machine
  (new keys only). Returns `{ accepted, rateLimited, pinged, droppedUpstream }`.
  **`pinged` means notification claimed/scheduled, not delivered** (including when no webhook is
  configured). Response shape and report read API are unchanged.
- `GET /reports?machine=&version=&since=&limit=` — newest-first JSON, `since` is an ms epoch on
  `last_seen`, `limit` defaults 100 (max 1000). Returns `{ reports, count }`.
- `POST /backups` — body `{ "reports": BackupRecord[], "dropped": number }` (the generic shipper
  posts items under `reports`; the route, not the key, marks it a backup batch). Each `BackupRecord`
  is `{ machine, key, createdAt, reason, bundle }`; the bundle is stored to R2 verbatim under
  `backups/<machine>/<key>`. `machine`/`key` are path-safety validated (the Worker is the trust
  boundary). Returns `{ accepted, droppedUpstream }`.
- `GET /backups?machine=` — newest-first JSON listing of a machine's snapshots (metadata only):
  `{ objects: [{ key, size, uploaded }], count }`. `machine` is required.
- `GET /backups/object?key=` — fetch one stored bundle body by its full R2 key (must be inside the
  `backups/` prefix). Returns the bundle JSON verbatim, or 404.

## Ingest admission and notification contract (P14)

- One D1 `batch` transaction per report conditionally inserts a unique
  `(machine, version, dedup_key)` claim under the per-machine rolling budget, then upserts its
  session row only if that identity has a claim. SQL `RETURNING` identifies THIS call's winner;
  no read/check/write decision lives in a request-local cache. Failure rolls back both statements.
- Budget is **240 new error identities per 60 seconds**, across versions, counted at server arrival
  (`claimed_at >= requestNow - window`). Repeat-count updates AND new sessions of an old identity
  always land without charging the budget. This removes the old inconsistency where new sessions
  bypassed admission but their report rows charged later requests. Same-session counts still use
  `MAX`, not addition; `last_seen` and original `received_at` behavior are unchanged.
- A committed claim schedules one `ExecutionContext.waitUntil` task immediately. Other reports
  and the HTTP response never wait for Discord. Each attempt has a **5-second deadline**, with an
  explicit promise race AND abort signal, including fetch implementations that ignore abort.
  Unread response bodies are aborted; no body is awaited. Diagnostics contain fixed error categories
  or HTTP status codes only—never webhook URLs, raw exceptions, or response bodies.
- **Best-effort, no outbox/retries, no exactly-once delivery guarantee.** Termination between commit
  and scheduling can lose a notification; a timeout can mean delivered without acknowledgement.
  A noncooperative fetch cannot be forcibly stopped, but its task settles at the deadline and any
  late rejection is handled. Failed, timed-out, or unconfigured attempts do not release claims.
  Claims are permanent dedup markers; do not prune them when their budget window expires.

## Existing installation upgrade — UNEXECUTED

These are operator steps for a future authorized deployment. None were performed for P14.
**Do not deploy the new Worker before backfill, or apply only `schema.sql` to an existing DB.**

1. Quiesce `/ingest` writers (including old Worker invocations): use a temporary ingress gate
   returning retryable **503**, let in-flight requests drain, and take a D1 recovery/export checkpoint.
   Keep the gate in place through migration and deployment. Do not return 200 for discarded batches.
2. From `workers/error-ingest`, apply the additive, rerunnable backfill:
   ```bash
   npx wrangler@4 d1 execute ledrums-errors --remote --file=./migrations/0001-notification-claims.sql
   ```
   It creates `notification_claims` and its budget index, then groups legacy reports by identity
   using **MIN(received_at)**. It neither changes reports nor sends notifications. Re-running keeps
   existing claims intact. If interrupted, keep writers stopped and rerun before proceeding.
3. Verify the claim table/index exist and this query returns **0** (no missing legacy identities):
   ```sql
   SELECT COUNT(*) AS missing FROM (
     SELECT DISTINCT machine, version, dedup_key FROM reports
   ) r WHERE NOT EXISTS (
     SELECT 1 FROM notification_claims c
     WHERE c.machine = r.machine AND c.version = r.version AND c.dedup_key = r.dedup_key
   );
   ```
   Check representative claim timestamps against earliest report arrivals; backfill timestamps must
   not be migration time. Local tests verify fresh/upgrade table and index definitions match.
4. Deploy the new Worker (`pnpm deploy`), verify bindings/logs and the authorized ingest/read smoke
   test, then remove the ingress gate. Any live new-error smoke can send a real Discord notification;
   it is **not** part of offline tests. No app/OTA release is needed for this Worker-only change.
5. Rollback: keep both tables/data. Reverting to old Worker code restores its old races; old writers
   do not populate the ledger. Before deploying the fixed version again, quiesce and rerun backfill.

## One-time deploy (Trent — secrets are yours, do not commit them)

Prereqs: `npm i -g wrangler` (or use `npx wrangler@4`), and `wrangler login`.

```bash
cd workers/error-ingest

# 1. Create the D1 database, then paste the printed database_id into wrangler.toml.
npx wrangler@4 d1 create ledrums-errors

# 2. Create the table (remote = production D1).
pnpm db:init:remote          # → npx wrangler@4 d1 execute ledrums-errors --remote --file=./schema.sql

# 3. Set secrets (prompted for the value; never committed).
npx wrangler@4 secret put TELEMETRY_TOKEN        # a long random string
npx wrangler@4 secret put DISCORD_WEBHOOK_URL    # #ledrums-errors webhook (optional)
                                                 # value is kept in Infisical (prod) as
                                                 # LEDRUMS_ERRORS_DISCORD_WEBHOOK; wrangler secrets
                                                 # are set by hand, not injected from Infisical.
                                                 # (OTA release pings use a different channel +
                                                 # webhook — see apps/desktop/README.md.)

# 4. Create the R2 bucket for project backups (#123), then set its lifecycle rule (below).
npx wrangler@4 r2 bucket create ledrums-backups

# 5. Deploy.
pnpm deploy                  # → npx wrangler@4 deploy
```

The deploy prints the Worker URL (e.g. `https://ledrums-error-ingest.<subdomain>.workers.dev`).

## Project backups (#123): R2 bucket + lifecycle

Backups are stored in the `ledrums-backups` R2 bucket (bound as `BACKUPS` in `wrangler.toml`) under
`backups/<machine>/<timestamp>-<reason>`. **Remote retention is a bucket lifecycle rule, not code:**
objects expire 90 days after upload, so storage stays bounded with zero server logic.

Set it once, in the Cloudflare dashboard → R2 → `ledrums-backups` → Settings → Object lifecycle rules:

- **Rule**: apply to prefix `backups/` (all objects), **Delete objects 90 days after upload**.

(Or via the API — `PUT /accounts/<id>/r2/buckets/ledrums-backups/lifecycle` with a single rule
deleting objects at `maxAge: 7776000` seconds.) Adjust the 90-day window there; nothing in this
Worker or the app enforces remote retention.

## Wiring the app to the Worker

The desktop/prod server reads two env vars (baked in at build time or set in the run environment):

- `LEDRUMS_TELEMETRY_ENDPOINT` = `<worker-url>/ingest`
- `LEDRUMS_TELEMETRY_TOKEN`    = the same value as the Worker's `TELEMETRY_TOKEN` secret

Reporting is on by default when the server serves the built web root (packaged/prod) and off under the
dev proxy; `LEDRUMS_TELEMETRY=on|off` overrides either way. **Off-site backups reuse the same two env
vars** — the server derives the backups endpoint by swapping `/ingest` → `/backups` on the same
origin, so no extra config is needed. Local snapshotting is always on regardless (it is local + cheap);
only the off-site push follows this enablement rule.

## Reading reports (AI agent)

```bash
curl -H "Authorization: Bearer $TELEMETRY_TOKEN" \
  "https://ledrums-error-ingest.<subdomain>.workers.dev/reports?machine=<host>&since=$(( $(date +%s000) - 86400000 ))"
```

## Reading backups (AI agent)

Correlate "the error at 21:14" with "the project state at 21:00": list a machine's snapshots, then
fetch the exact bundle by key.

```bash
BASE="https://ledrums-error-ingest.<subdomain>.workers.dev"
# List (newest first):
curl -H "Authorization: Bearer $TELEMETRY_TOKEN" "$BASE/backups?machine=<host>"
# Fetch one bundle body (project + show + song libraries) by its full key:
curl -H "Authorization: Bearer $TELEMETRY_TOKEN" \
  "$BASE/backups/object?key=backups/<host>/<timestamp>-<reason>"
```

## Local dev / tests

Worker tests require **Node >=22.5** with built-in `node:sqlite` (the test scripts enable its flag
for early Node 22 releases). This is **dev-only**: production Worker code has no Node import,
SQLite addon, or new dependency. `createRequire` in the test adapter bypasses Vite 5's outdated
builtin-module resolver. No lockfile changes are needed.

```bash
pnpm install --frozen-lockfile
pnpm --filter @ledrums/error-ingest-worker test        # this worker only, including real SQLite
pnpm --filter @ledrums/error-ingest-worker test:sql    # narrower production-SQL/route regressions
pnpm --filter @ledrums/error-ingest-worker typecheck
```

All tests use memory/temporary local SQLite and stubbed notifications/fetch: **no network, live
Worker, D1, R2 or Discord calls**. The D1 shim runs production SQL unchanged in SQLite, with a
transaction around each `batch`; overlapping handlers yield at each async IO boundary. Tests also
use independent connections to one temporary DB and inject SQLite transaction failures. This
checks SQL and application interleavings, not Cloudflare's deployed service/runtime behavior.

Optional manual local development (not run by tests): `npx wrangler@4 dev` after `db:init:local`.
Existing local DBs need the same migration/backfill with `--local` instead of `--remote` first.

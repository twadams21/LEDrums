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
npx wrangler@4 secret put DISCORD_WEBHOOK_URL    # your Discord channel webhook (optional)

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

```bash
pnpm --filter @ledrums/error-ingest-worker test        # handler-level unit tests (no live Cloudflare)
pnpm --filter @ledrums/error-ingest-worker typecheck
npx wrangler@4 dev                                     # local run against a local D1 (db:init:local first)
```

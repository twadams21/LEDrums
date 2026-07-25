# LEDrums error-ingest Worker (#122)

A deliberately dumb Cloudflare Worker: it validates a bearer token, validates the shape, and writes
error reports to a D1 table. It also serves a token-authed JSON read API and fires a Discord webhook
on the first occurrence of each unique error. No HTML, no dashboard — the read consumer is Trent's AI
agent via `curl`.

The queue/ship machinery on the app side (`apps/server/src/telemetry/`) is generic; the backups spec
(#123) is expected to reuse this same Worker with a second table/route.

## Routes

Both require `Authorization: Bearer <TELEMETRY_TOKEN>`.

- `POST /ingest` — body `{ "reports": ReportRecord[], "dropped": number }`. Upserts each report by
  `(machine, version, session, dedupKey)`; repeats bump `count`/`last_seen`. Rate-limited per machine
  (new keys only). Returns `{ accepted, rateLimited, pinged, droppedUpstream }`.
- `GET /reports?machine=&version=&since=&limit=` — newest-first JSON, `since` is an ms epoch on
  `last_seen`, `limit` defaults 100 (max 1000). Returns `{ reports, count }`.

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

# 4. Deploy.
pnpm deploy                  # → npx wrangler@4 deploy
```

The deploy prints the Worker URL (e.g. `https://ledrums-error-ingest.<subdomain>.workers.dev`).

## Wiring the app to the Worker

The desktop/prod server reads two env vars (baked in at build time or set in the run environment):

- `LEDRUMS_TELEMETRY_ENDPOINT` = `<worker-url>/ingest`
- `LEDRUMS_TELEMETRY_TOKEN`    = the same value as the Worker's `TELEMETRY_TOKEN` secret

Reporting is on by default when the server serves the built web root (packaged/prod) and off under the
dev proxy; `LEDRUMS_TELEMETRY=on|off` overrides either way.

## Reading reports (AI agent)

```bash
curl -H "Authorization: Bearer $TELEMETRY_TOKEN" \
  "https://ledrums-error-ingest.<subdomain>.workers.dev/reports?machine=<host>&since=$(( $(date +%s000) - 86400000 ))"
```

## Local dev / tests

```bash
pnpm --filter @ledrums/error-ingest-worker test        # handler-level unit tests (no live Cloudflare)
pnpm --filter @ledrums/error-ingest-worker typecheck
npx wrangler@4 dev                                     # local run against a local D1 (db:init:local first)
```

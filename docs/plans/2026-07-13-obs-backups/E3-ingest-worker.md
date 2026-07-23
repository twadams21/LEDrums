# E3 — Cloudflare ingest-worker (D1 + Discord)

Spec: #122. Effort: **medium**. Wave 1 (parallel with E1, E4).

## Mission

A new workspace `apps/ingest-worker`: a dumb Cloudflare Worker implementing the INDEX wire contract — validate token, validate shape, insert into D1, ping Discord on new unique errors, list reports as JSON. No dashboard, no HTML: the read consumer is an AI agent with curl.

## What to build

1. **Workspace**: `apps/ingest-worker/` with `package.json` (the root `pnpm-workspace.yaml` `apps/*` glob already includes it — do not edit it), `wrangler.toml` (worker name, D1 binding, R2 binding declared now for B3, secrets documented), TypeScript config consistent with sibling apps.
2. **Routes** (exactly the INDEX wire contract):
   - `POST /ingest` — bearer-token check, per-report ≤32KB (413), per-machine rate limit (429), batch insert into a `reports` D1 table (envelope fields as columns: machine, appVersion, engineMode, platform, osRelease, sessionId, origin, key, count, firstAt, lastAt; error+breadcrumbs as a JSON payload column). Upsert semantics on `(sessionId, key)` so count updates from the same session update the row rather than duplicating.
   - `GET /reports?machine=&version=&since=&limit=` — same token, JSON array newest-first, sane default/max limit.
   - `POST /backup`, `GET /backups`, `GET /backup` — **stub 501 in this slice** (B3 implements; route shape reserved per contract).
3. **Discord webhook**: fired only when `(machine, appVersion, key)` has no prior row — the "new unique error" ping. Webhook URL from a Worker secret; absent secret = feature silently off. Never fired for count updates.
4. **D1 schema**: a migration file (wrangler migrations convention) creating `reports` + whatever uniqueness the upsert/new-key check needs.
5. **README**: exact one-time setup steps for Trent — `wrangler d1 create`, secret puts (`INGEST_TOKEN`, `DISCORD_WEBHOOK_URL`), deploy command, a curl smoke test for each route. **The agent deploys nothing and creates no live resources.**

## Anchors to verify

- `pnpm-workspace.yaml` — confirm the glob really covers the new dir.
- Sibling app `package.json`s for script naming conventions (`dev`/`build`/`test`/`typecheck`) so root `pnpm typecheck`/`pnpm test` pick the workspace up (or are correctly filtered — check how root scripts fan out).
- The INDEX wire contract is the authority for shapes — E2 is being built against it in parallel; do not deviate.

## Scope fence

May touch: `apps/ingest-worker/**` only.
Non-goals: no server/web/protocol changes, no deploys, no live D1/R2/Discord, no backup-route implementation beyond 501 stubs, no HTML.

## Tests

Handler-level unit tests with in-memory/miniflare-style bindings (whatever `@cloudflare/vitest-pool-workers` or plain handler-injection makes clean — prefer the lightest setup that tests the real handler code): token rejection, shape rejection, size cap, rate limit, insert + upsert-count semantics, webhook-on-new-key-only (fake fetch), reports filtering. Hermetic — no network.

## Escalation triggers

- Root gate scripts (`pnpm test`/`typecheck`) can't cleanly include the workspace without touching root config beyond the trivial — show the change before landing it.
- The wire contract proves unimplementable as written (e.g. upsert key insufficient) — propose the amendment, don't silently drift from E2.

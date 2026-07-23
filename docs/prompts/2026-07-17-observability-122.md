# Task: Implement GitHub issue #122 — Observability: remote error reporting

Run `gh issue view 122 -R twadams21/LEDrums` and treat its body as the full spec. It is a complete PRD: problem, user stories, implementation decisions, testing decisions, out-of-scope. Follow it exactly; do not re-litigate settled decisions.

## Scope summary (the spec is authoritative)

- Capture rides the existing Monitor bus: web global error/unhandledrejection/console.error → one new WS client message → error Monitor events; server process handlers likewise.
- One new server module, the **Reporter** (pure factory, injected clock/transport/paths — same style as the autosaver): dedup, breadcrumbs (last ~20 bus events), disk-backed JSONL queue (atomic writes, caps, drop-oldest + dropped-counter), 30s flush, exponential backoff, retry on boot.
- New Cloudflare Worker workspace in the monorepo: batch ingest → D1, token-authenticated JSON read API (machine/version/since filters), Discord webhook on first occurrence of a dedup key only. Worker stays dumb.
- Hidden sourcemaps per build, uploaded by the OTA publish flow keyed by version.
- Enablement: on for packaged/prod, off for dev, `LEDRUMS_TELEMETRY=on|off` overrides.
- `packages/core` untouched. Fire-and-forget everywhere; Reporter errors log locally only.

## Sequencing within the task

1. Capture → Monitor bus (valuable standalone, visible in local Monitor view).
2. Reporter + queue + shipper.
3. Worker workspace (ingest + read API + webhook) with handler-level unit tests, deployed manually via wrangler — write the code + wrangler config + a short deploy README; do NOT deploy (secrets are Trent's).
4. Sourcemap flag + OTA upload hook.

## Design-for-reuse constraint

Issue #123 (backups) reuses this Worker and the queue/ship machinery with a second queue. Keep the shipper generic over payload type.

## Gates

- `pnpm typecheck` and `pnpm test` green on committed HEAD.
- Hermetic tests only (fake clock/transport/temp dirs) — see the spec's Testing Decisions and the prior art it names.
- Branch `feat/observability-122`, push, open a PR referencing #122. Done = committed-HEAD green AND pushed.

Report back to your parent per the implementer manual, including the PR URL and any deploy steps left for Trent.

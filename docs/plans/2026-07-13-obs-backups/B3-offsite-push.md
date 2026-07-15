# B3 — Off-site backup push + Worker routes

Spec: #123. Effort: **medium**. Wave 4 (parallel with B2; merges second).

## Mission

Every snapshot leaves the machine: a second disk-backed queue (reusing E2's shipper core) pushes snapshot bundles to the Worker, which stores them in R2 keyed by machine. A dead SSD then costs at most ~30 minutes of authoring.

## What to build

1. **Server push queue**: instantiate E2's reusable queue/shipper core with a backup payload — enqueue on every successful snapshot write (a hook/callback on the SnapshotStore write path or its boot wiring, whichever is cleaner against the landed code), POST per the INDEX wire contract (`/backup?machine=&reason=&ts=`, body = the gzipped bundle bytes). Same discipline: batching not required (one blob per POST is fine), backoff, boot retry, caps (e.g. 50 queued blobs, drop-oldest — a dropped backup is recoverable locally, so cheap policy is correct). Enablement identical to the Reporter's (prod-on/dev-off, `LEDRUMS_TELEMETRY` override) — reuse its resolution, don't fork it.
2. **Worker routes** (replacing E3's 501 stubs, per the wire contract):
   - `POST /backup` — token check, size cap (snapshots are tens of KB; cap generously at ~10MB), R2 put to `backups/<machine>/<ts>-<reason>.json.gz`.
   - `GET /backups?machine=` — list keys `[{key, size, uploaded}]`, token-gated.
   - `GET /backup?key=` — stream the blob back, token-gated, key validated against the `backups/` prefix (no bucket traversal).
3. **R2 lifecycle**: 90-day expiry is bucket configuration, not code — add the exact console/wrangler steps to the ingest-worker README for Trent. The wrangler.toml R2 binding was declared in E3; verify it.
4. **README update**: the curl smoke tests for the three routes.

## Anchors to verify

- E2's landed queue/shipper core — its actual reuse surface (this brief assumes a factory; build against what merged, escalate if reuse requires reshaping it).
- B1's landed snapshot write path — where a post-write hook belongs.
- `apps/ingest-worker/` as landed by E3 — routing, auth helper, test setup, R2 binding.
- The INDEX wire contract.

## Scope fence

May touch: `apps/ingest-worker/**`, new server queue-wiring module + `boot.ts`/`main.ts` glue, a minimal additive hook on `snapshot-store.ts` if needed.
Non-goals: **no `client-message.ts`, no `packages/protocol` changes (B2's fence)**, no web UI, no cloud-restore path in the app, no live deploys/bucket config (document, don't do).

## Tests

Server: fake-transport queue tests (enqueue-on-snapshot, backoff, caps, enablement) — reuse E2's test fakes/patterns. Worker: R2 put/list/fetch against test bindings, token rejection, prefix validation on fetch. Hermetic.

## Escalation triggers

- E2's shipper core can't be reused without modifying it in ways that touch Reporter behaviour — propose the refactor, don't land it silently inside this slice.
- Snapshot blobs turn out large enough (>~5MB real-world) that per-POST shipping needs rethinking.

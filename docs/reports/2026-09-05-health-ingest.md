# P14 — atomic ingest admission and background notifications

## State / scope

**Implemented and committed locally; NOT deployed.** Branch: `fix/health-ingest-atomicity`.
Base: `ea18f615`. Fix + regression commit: `e347b7fa`.

Source: Trent's in-session instruction to implement P14 of
[`2026-09-05-codebase-health-audit.md`](../plans/2026-09-05-codebase-health-audit.md), approving the
follow-ups without further questions. Best-effort notifications are the integrating agent's
implementation default; local commits and worker-only verification were delegation constraints,
not separately stated user decisions. Infrastructure actions remain unauthorized. Attribution verified by `scutil --get ComputerName` → Trent’s MacBook Pro.

Implementation ownership stayed inside `workers/error-ingest`; this requested report is the only
file outside that directory. No application/core/IO/UI/release changes, dependency additions,
lockfile edits, full sweep, push, PR, merge, publication, deployment, or live service calls.

## Repair and contract

1. **One persistence operation owns admission.** `ReportStore.admit` replaces the three independent
   seen/count/upsert calls. A D1 `batch` transaction conditionally inserts a permanent unique
   `(machine, version, dedup_key)` ledger row under the machine budget, then upserts the session
   report only if its identity exists in that ledger. `RETURNING` identifies this transaction's
   claim/admission; no post-commit read can mistake another request's claim for its own.
   The ledger insertion IS the budget charge—there is no separate counter to race or drift.
   Serialized SQLite writes and the primary key prevent concurrent budget/claim winners exceeding
   the bound. Failure of report persistence rolls back the claim and charge together.
2. **Repeat behavior survives.** Reports remain unique per machine/version/session/key; same-session
   retries use `MAX(count)`, never addition. Existing `last_seen` overwrite and original
   `received_at` behavior are retained. New sessions of an existing error still create report rows,
   bypass admission limits, and never re-notify. Versions have separate identities but share their
   machine's budget; machines have independent budgets. Read API and HTTP response shape are unchanged.
3. **Budget semantics are explicit:** 240 new error identities in the rolling 60-second window,
   counted by server arrival with an inclusive lower boundary (`claimed_at >= now - window`).
   Repeat sessions do not consume extra budget. This deliberately removes the old inconsistency
   where repeat sessions bypassed admission but their report rows charged subsequent requests.
   Claims aging out of the window free budget, NOT notification eligibility; never prune this ledger
   just because claims are old. Rejected new keys persist neither a report nor a claim and can retry.
4. **Notifications are background, bounded, best-effort.** Each committed claim immediately registers
   a task through `ExecutionContext.waitUntil`, preserving the context method's receiver. No Discord
   await remains on the ingest path; a later DB failure cannot prevent scheduling earlier commits.
   Sync throws and rejected notification promises are contained. The transport races fetch against
   a 5-second timeout and aborts on expiry/completion. Even an abort-ignoring fetch cannot leave the
   tracked task pending forever; late rejections are observed. It never awaits a response body.
   Non-2xx responses and transport/timeouts log only status numbers or fixed categories, not URLs,
   raw exceptions, or bodies. Redirects fail rather than forwarding the webhook request.
5. **`pinged` = claimed/scheduled, NOT delivered.** This includes an unset webhook. There is no outbox,
   retry, claim release, or exactly-once delivery promise. Termination after commit can lose an
   attempt; timeout can mean Discord received it without acknowledgement. A noncooperative fetch
   cannot be forcibly stopped, but its tracked task settles. Error persistence survives webhook
   failure. Future durable retry requirements need a separate outbox/delivery design.

## Verification (offline only)

Environment: Node **v25.8.2**, built-in SQLite **3.52.0**, existing Vitest **2.1.9**.
The worker test scripts support Node >=22.5 with `--experimental-sqlite`; no production Node import
or native addon was added. Vite 5 predates this builtin, so the test-only adapter uses `createRequire`
to load `node:sqlite`. Existing root `@types/node` supplies its types; no new dependency was needed.

| Command / check | Result |
|---|---|
| `pnpm install --frozen-lockfile` | PASS; existing lockfile unchanged, packages reused |
| `pnpm --filter @ledrums/error-ingest-worker test` | PASS: **57 tests / 9 files**, 24 added tests |
| `pnpm --filter @ledrums/error-ingest-worker typecheck` | PASS: worker source + tests |
| `pnpm --filter @ledrums/error-ingest-worker test:sql` | PASS: **15 tests / 3 files** (subset of 57, not additional) |
| `git diff --check` | PASS |

**Red-before-green evidence:** running
`pnpm --filter @ledrums/error-ingest-worker exec vitest run test/ingest-atomicity.test.ts`
against the original implementation failed all three initial regressions:

- 12 simultaneous first reports produced **12** claimed pings, expected **1**.
- 12 simultaneous different keys admitted **12** reports with a budget of **3**.
- A never-settling notifier kept ingestion pending beyond the test deadline; later reports did not land.

An initial harness-only failure (Vite's missing `node:sqlite` resolver support) was corrected before
these three failures were reproduced. During test authoring, a matcher unavailable in Vitest 2 was
replaced with its supported count/argument assertions; the final suite is green.

**SQL evidence is not an independent fake of admission policy.** The test adapter executes the
production SQL strings unchanged in SQLite and wraps each D1-style batch in a real transaction.
Async IO boundaries allow concurrent handlers to interleave; tests additionally use two independent
connections to one temporary DB. SQLite trigger-induced failures prove rollback, and tests apply
the actual migration file, verify backfill/rerun semantics, and compare fresh/upgraded table/index
DDL. The old in-memory store remains only for handler branching tests, not atomicity evidence.

Coverage includes concurrent duplicate sessions, distinct-key overlap, exhausted budget with repeats
and new sessions, machine/version isolation, inclusive window expiry, retry after denial, persisted
`MAX(count)`, earlier commits surviving a later DB failure, migration preserving reports and earliest
arrival time, HTTP 400/429/500, synchronous/rejected transport failures, absent webhook, deadline with
fetch honoring AND ignoring abort, late rejection, and timer cleanup. Full Worker route tests use
real admission SQL and the real notifier with stubbed fetch: complete batches return before stalled
webhooks settle, failed HTTP does not stop remaining reports, and repeats never reschedule failures.

**Limits:** the SQLite shim models D1's documented transactional batch contract; it does not certify
Cloudflare service/runtime behavior, wall-clock fairness across isolates, or deployment health.
Independent connections are driven at async operation boundaries, not a multithreaded load benchmark.
No Wrangler/D1/Worker/R2/Discord/OTA endpoint was contacted. No full-repo test/typecheck/build sweep,
UI capture, hardware test, or live smoke test was run.

Conventions verification: core/IO/render/WS model untouched; no duplicate wire/model schema added;
new types are internal adapter contracts; worker-only tests/typecheck passed. No UI changed, so UI
skills/design-system regeneration/screenshots are not applicable.

## Required migration / deployment — explicitly UNEXECUTED

**All steps below are UNEXECUTED against infrastructure.** Only disposable local SQLite databases
were migrated by tests. Runbook: [`workers/error-ingest/README.md`](../../workers/error-ingest/README.md)
→ “Existing installation upgrade”. A separate deployment authorization is required.

1. **UNEXECUTED — quiesce all ingest writers and checkpoint D1.** Temporarily gate `/ingest` with
   retryable 503, drain old invocations, and take a recovery/export checkpoint. Keep the gate until
   the new Worker is deployed. Old code does not write claims; allowing it between backfill and
   deployment can reintroduce missing identities and duplicate notifications.
2. **UNEXECUTED — migration/backfill.** From `workers/error-ingest`, run:
   ```bash
   npx wrangler@4 d1 execute ledrums-errors --remote --file=./migrations/0001-notification-claims.sql
   ```
   This additive migration creates `notification_claims` plus its machine/time index and inserts
   one row per historical identity using `MIN(received_at)`. Historical records do not assert prior
   Discord delivery. Reruns preserve claims and reports. If interrupted, keep writers paused and rerun.
   **Do not use only `schema.sql` on an existing installation**: it creates an empty ledger without
   backfilling old reports. Fresh empty installations can use `schema.sql` normally.
3. **UNEXECUTED — verify backfill.** Check table/index existence, run the README's anti-join query
   (missing historical identities must be 0), and compare representative `claimed_at` values with
   earliest report arrivals, not migration time. Do not delete old claims to reset the budget.
4. **UNEXECUTED — deploy and smoke-check.** Run `pnpm deploy` only after verification, check bindings
   and authorized ingest/read behavior, then remove the gate. A live new-error smoke may notify real
   Discord and is not included in the local tests. No desktop version bump/OTA release is required.
5. **UNEXECUTED — rollback if needed.** Retain the additive table and reports. Old Worker code restores
   the old races and writes no claims; before re-upgrading, quiesce again and rerun backfill. Never
   drop the ledger as a routine rollback step.

## GROW / handoff within the ownership fence

Ground: actual SQL and route regressions prove bounded background notification and atomic admission.
Record: this report records the approved policy, behavioral change, evidence and unexecuted rollout.
Orient: the worker README now carries the repeatable migration/rollback and local-SQL verification
runbook. Shared `.mex` scaffold files were left untouched to honor the worker-only ownership fence;
the integrating session can link this report there without conflicting with other health slices.

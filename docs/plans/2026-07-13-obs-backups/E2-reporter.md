# E2 — Reporter: dedup, disk queue, shipper

Spec: #122. Effort: **high** (novel seam). Wave 2 — after E1 is merged.

## Mission

One new server module, the **Reporter**: subscribes to error-type Monitor events, deduplicates, persists a disk queue, and ships batches to the ingest Worker per the INDEX wire contract. Autosaver-style pure factory — injected clock, transport (fetch), and file paths; zero behaviour change when disabled.

## What to build

1. **Bus tap**: `createMonitorBus` gains a lightweight, additive listener hook (or the Reporter wraps the `sendAll` sink — pick whichever reads cleaner against the real code; the bus is 28 lines). No second bus.
2. **Reporter factory** (new `apps/server/src/reporter.ts` + test):
   - Filters `type:'error'` events. Dedup key = `origin|message|top stack frame`, scoped per session: first occurrence enqueues a full report with breadcrumbs = `bus.snapshot()` (≤20 most recent); repeats bump `count`/`lastAt` on the queued/shipped record (count updates ship with later batches).
   - **Disk queue**: JSONL beside the project files via the atomic-write helper; rebuilt on boot (crash reports survive the crash). Caps ≈200 reports / 2MB, drop-oldest, with a `droppedReports` counter that ships.
   - **Shipper**: batch POST every ~30s when non-empty; exponential backoff on failure; retry on boot. Payload exactly per the INDEX wire contract.
   - **Isolation**: fire-and-forget; a Reporter-internal error logs locally only — it must never emit onto the bus (no recursion) and never throw into the host.
3. **Envelope builder**: machine (`os.hostname()`), appVersion (reuse the version source the update-status route uses; package.json fallback in plain dev), engineMode, platform + release, per-boot sessionId, uptimeMs, origin from the event.
4. **Enablement**: on when the server serves the built web root, off under the dev proxy; `LEDRUMS_TELEMETRY=on|off` overrides both ways. Config via env: `LEDRUMS_INGEST_URL`, `LEDRUMS_INGEST_TOKEN` — absent config = reporter disabled with one startup diagnostic line, never an error.
5. **Crash path**: in the uncaughtException handler (E1 landed it), best-effort synchronous queue append before the process dies.
6. **Design for reuse**: the queue+shipper core must be instantiable a second time with a different payload type/route — B3 (backup push) consumes it. Keep dedup/breadcrumbs in the error-specific layer, not the queue core.

## Anchors to verify

- `apps/server/src/monitor.ts` — bus factory to tap.
- `apps/server/src/autosave.ts` + test — the factory/injection/never-rejects house style to match.
- `apps/server/src/atomic-file.ts` — write helper. `apps/server/src/projects.ts` — where the project-adjacent data dir is resolved.
- `apps/server/src/http/update-status.ts` — the existing app-version source; do not invent a second one.
- `apps/server/src/static-host.ts` (`resolveWebRoot`) + `boot.ts` — how prod-serving vs dev is distinguishable; wire enablement there.
- How the packaged desktop app supplies env to the sidecar server: `apps/desktop/scripts/build-sidecar.mjs` / `prepare-bundle.mjs`. **Verify a channel exists for baking `LEDRUMS_INGEST_URL`/`_TOKEN` into the bundle.**

## Scope fence

May touch: new `reporter.ts`(+test), `monitor.ts` (additive tap only), `main.ts`/`boot.ts` wiring, `atomic-file.ts` (only if an append-friendly variant is genuinely needed), desktop build scripts **only** for env plumbing if the channel already exists.
Non-goals: no Worker code (E3), no capture changes (E1 done), no backup queue (B3 — just don't preclude it), no protocol changes.

## Tests

Fake clock + fake fetch + temp dirs, external behaviour only: dedup (same key → count bump; new key → new report with breadcrumbs), batch cadence, backoff schedule, queue-survives-restart, drop-oldest + dropped counter, transport-throws → nothing propagates, enablement matrix (prod/dev × env override), envelope contents. Prior art: `autosave.test.ts`, `controller-monitor.test.ts` (coalescing windows).

## Escalation triggers

- No clean env channel into the packaged sidecar (this decides how the token reaches the drummer's machine — a real design call, stop and ask).
- The version source turns out unavailable at Reporter construction time.
- Any pressure to make shipping synchronous or bus-blocking — that violates a non-negotiable; stop.

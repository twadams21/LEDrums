# Lane: INIT-11 telemetry-resilience (whole initiative, S1–S5)

Read `lanes/COMMON.md` — it binds. Branch: `init/11-telemetry` off `review/impl`
(start at origin HEAD; re-measure baseline at your starting HEAD and report it).
Steps from `09-synthesis/INIT-11-telemetry-resilience.json`, in step order.
`11-decisions.md` overrides plan text.

DEPLOY FENCE (absolute): you deploy NOTHING. The error-ingest Worker (#137) is
live at adamstrent21.workers.dev — code + tests only; wrangler deploy is
Trent's, via OAuth (the Infisical CF token lacks D1/Workers perms). If a step
seems to need a live deploy, write the README steps instead and flag it.

ANCHOR WARNING: the plan predates INIT-04/05. main.ts's telemetry block will
have moved lines (INIT-04 strangled main.ts into ws-broadcast/ws-connection/
stats-frame with main.ts as composition root; INIT-05 landed pin-auth without
touching main.ts). Verify anchors; report corrections. Telemetry key
`boot-recovery/quarantine` (D8) already ships from the recovery path — do not
break its shape.

- S1: Worker fault boundary — storage faults → 503 JSON; size cap
  byte-accurate + pre-buffer; extract internal route(req, env).
- S2: ShipHttpError {status, retryable} — stop discarding the status class in
  transport.ts.
- S3: ShipQueue outcome policy — blocked state that truly stops shipping +
  dead-letter for poison batches (retires the wedged-at-30min-ceiling hole).
  Fail-closed; the queue's no-emit invariant holds.
- S4: byte-budgeted batch cut — never post a body the Worker will reject;
  shrink the poison blast radius.
- S5: wire the health signal at the composition root (main.ts telemetry
  block) + align report batch cap (maxBatchBytes 900_000) with the Worker.
- Gates green per committed step (foreground `pnpm gates`). Machine note: disk
  is tight (~3.7GiB free) — no cargo/Tauri builds this lane; if gates fail
  ENOSPC-shaped or suites fail to LOAD, suspect the machine and re-run.
- Report: per-step shas, gates numbers, anchor corrections, deviations.

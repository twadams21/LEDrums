# Lane: INIT-04-server-runtime-hardening (rank 2)

Read `lanes/COMMON.md` first — it binds. Branch: `init/04-server-hardening` off `review/impl`.
Plan: `docs/plans/2026-07-26-deep-review/09-synthesis/INIT-04-server-runtime-hardening.json`
(S0→S18 in its `sequencing` order, one green commit each). S0's boot-parity
instrument comes FIRST — main.ts has zero test coverage; the instrument is the
only thing that makes the strangler steps falsifiable.

## Decision overrides (11-decisions.md — these beat the plan text)

- **Decision 8 — boot recovery surfaces as a BLOCKING BANNER + DISCORD.** When
  S10's ladder quarantines an unloadable project (snapshot/seed fallback), that
  event must (a) file a telemetry report with key `boot-recovery/quarantine`
  through the EXISTING Reporter → Worker → Discord path (no new plumbing), and
  (b) show an in-app acknowledgement banner — "recovered from backup — last edits
  may be missing" (honest copy, ack to dismiss). The banner is NOT in the plan's
  file list: land it as your FINAL step, after S18. If the client needs a new
  field to learn of the quarantine, add it (greenfield posture, keep protocol zod
  in lockstep). UI GATE APPLIES to the banner: compose from the design system
  (`docs/design-system.html`), apply `/make-interfaces-feel-better`, and verify
  with ui-shot pinned to YOUR dev server: `UI_SHOT_BASE=http://localhost:$TWUX_DEV_PORT`
  (never the default :5173 — that probes someone else's server).
- **Approved defaults:** render-loop faults survive the frame — rate-limited
  error reporting, NEVER auto-blackout (S2 as planned); stats broadcast 100Hz →
  **30Hz** (fold into S17's named cadence constant); connection cap **32** with
  `LEDRUMS_MAX_CLIENTS` override (S16 as planned); `scripts/server-smoke.mjs`
  belongs HERE and is shared programme-wide — keep it initiative-agnostic.

## Watch

- INIT-01 rewrites main.ts too; it is NOT running while you are — but do not
  widen main.ts scope beyond your plan's steps, and keep extractions verbatim.
- apps/web edits: `ws/client.ts` (S5 watchdog) is logic, not rendered UI — no
  ui-shot needed there. Only the banner step is UI-gated.

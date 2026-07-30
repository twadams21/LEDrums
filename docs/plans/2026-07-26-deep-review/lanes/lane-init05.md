# Lane: INIT-05 pin-auth-hardening (whole initiative, S1–S6)

Read `lanes/COMMON.md` — it binds. Branch: `init/05-pin-auth` off `review/impl`
(start at origin HEAD; re-measure baseline at your starting HEAD, expect ~3265).
Steps from `09-synthesis/INIT-05-pin-auth-hardening.json`, in step order.
`11-decisions.md` overrides plan text.

RESERVED CLOSE CODE: the PIN throttle owns **4429**. INIT-04 landed room-full
as 4430 specifically to keep 4429 for you — do not renumber either.

ANCHOR WARNING: the plan predates INIT-04's main.ts strangling — the WS
connection handler now lives in apps/server/src/ws-connection.ts territory
with main.ts as composition root. Verify where admission actually happens
before wiring S4; report the corrected anchor.

- S1: pin-gate.ts credential helper — one parse, one constant-time equals,
  BOTH credentials (PIN + any admin secret the gate carries).
- S2: admission-throttle.ts — pure module, per-peer cooldown + bounded global
  tier, injected clock. No IO, no timers of its own.
- S3: fold throttle into admitDecision — the whole admission policy one pure
  function (fail-closed: when in doubt, refuse).
- S4: wire throttle + audit event into the WS connection handler; throttled
  rejects close with 4429.
- S5: adversarial live-socket proof against the REAL server (the evidence the
  suite cannot give): scripts/pin-throttle-probe.mjs + artifact JSON. Run the
  server on THIS LANE'S ports (check TWUX_DEV_PORT in your env; lane-b pool
  port is 4325 — avoid 5173 and other lanes' ports; kill your server after).
- S6: document credential rules where operators read them — server README AND
  apps/desktop (its src-tauri/src/lib.rs doc comment per plan).
- Gates green per committed step (foreground `pnpm gates`).
- Report: per-step shas, gates numbers, probe artifact summary, deviations.

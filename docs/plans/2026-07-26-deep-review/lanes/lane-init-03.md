# Lane: INIT-03-io-output-resilience (rank 1)

Read `lanes/COMMON.md` first — it binds. Branch: `init/03-io-resilience` off `review/impl`.
Plan: `docs/plans/2026-07-26-deep-review/09-synthesis/INIT-03-io-output-resilience.json`
(S1→S11 in its `sequencing` order, one green commit each).

## Decision overrides (11-decisions.md — these beat the plan text)

- **Decision 7 — sACN universes: FIX PROPERLY, replacing S9's detect-only audit.**
  `buildDmxMap` becomes protocol-aware: sACN emits 1-based universes (0 is
  E1.31-invalid), Art-Net stays 0-based. Byte-golden tests regenerate to match.
  This ADDS `packages/core` dmx-map files (+ its tests, + whatever golden fixtures
  encode universe numbers) to your scope — that extension is authorized, and ONLY
  that. S8 (pure universe predicate) still lands as planned and your protocol-aware
  code should use it. Where S9's tests asserted "detect but never renumber", invert
  intent: assert correct per-protocol numbering end-to-end. Keep the arm-time audit
  row only if it still adds signal after the fix; if it becomes vacuous, drop S9's
  audit and say so in your report.
  Note in your report: **Trent re-checks the PixLite patch once when this lands** —
  flag it prominently; real wire bytes change for sACN.
- **Approved defaults (veto round):** faults sticky until re-arm (plan already
  sticky — keep); adapters observe-only, no auto-rebind (keep); no BoundUdpSocket
  merge (keep); liveness probe = follow-on ticket, out of scope.

## Watch

- S1's golden fixtures are recorded BEFORE adapters change — do S1 first, exactly.
- With Decision 7, sACN goldens legitimately change when buildDmxMap renumbers —
  keep Art-Net goldens byte-identical, and make the sACN before/after delta an
  explicit, reviewed diff (universe field only), not a silent regeneration.
- S11's apps/web edit must stay comment-only (`git diff -U0 -- apps/web` shows
  only comment lines), else drop that file from the step and note it.

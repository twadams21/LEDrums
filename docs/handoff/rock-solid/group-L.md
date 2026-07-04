# Group L — PixLite Mk3 integration (issue #56, lane 4) — FINAL GROUP

Lane-4 orch group report. Branch: `group/L` (off `rock-solid` @ `0d78389`; integrated with `rock-solid` @
`8280f06`; head at the rock-solid merge). Serial chain S46→S47→S48→S49. Context:
[doc 01](../../plans/2026-07-02-rock-solid/01-io-confidence-pixlite.md). (Doc-01 Module-3 items 1 & 3 —
OutputPill truth, input badges — were already delivered by lane-1 group B; group L is client → service →
panel → test patterns.)

## Slices

- **S46 — PixliteClient in io + fake** (`slice/S46`, impl opus/high): deep module `packages/io/src/pixlite/`
  (auth Base64URL-SHA256, strict JSON member ordering, per-controller sequential queue, HTTP probe/
  statisticRead/identify, pure prober-injected subnet `sweep`, in-memory fake) — small interface, all
  complexity inside; `core` untouched. 49 io tests.
- **S47 — Discovery + controller-monitor service** (`slice/S47`, impl opus/medium):
  `apps/server/src/controller-monitor.ts` — discover/adopt/interest-gated poll loop (1–2s only while a client
  watches; proven no idle traffic) emitting `controllerStatus`; `watchController` interest signal +
  `controllerDiscovery` sweep carrier; `project.controller` persistence (core **data-only**, auth HASH not
  plaintext). `lastSeen` ages when quiet.
- **S48 — Controller panel UI** (`slice/S48`, impl opus/high, ui-significant): EXTENDED S03's
  `OutputStatusPanel` (opt-in `ControllerStatusPanel` child composite, NOT forked; derivations in
  `output-status.ts`) — identity, per-universe rx (`receiving` headline), rates, health, Discover/Adopt-IP
  (also `setOutput{host}`)/Identify. "Not receiving"/LOST loud in the S02/S03 error tone. `watchController`
  mount/teardown lifecycle (no leak). Design-system regen. +58 tests.
- **S49 — Test patterns + takeover** (`slice/S49`, impl opus/medium): drive `modeTestData` (setColor/rgbw
  cycle/colour fade) from the panel with a **server-authoritative** takeover (`ControllerStatus.testPattern`
  — all watchers agree, survives reconnect): amber banner + `deriveOutputPill(link,output,takeover)` `TEST`
  tone the whole run (below genuine ERR), one-click back-to-live (`modeLive`), auto-revert when the last
  watcher leaves. Design-system regen.

## Merges

- S46/S47/S48/S49 each fast-forwarded onto group/L in dependency order (each built atop the prior, so S49's
  green sweep tested the fully-integrated tree). `rock-solid` (@ 8280f06) merged in — **clean, docs-only**
  (master tracker), so no code re-sweep needed.
- Integrated sweep (from S49): **typecheck 0** · **all green, 0 skips** — io 51 · core 560 · protocol 1 ·
  server 227 · web 1170.

## Group review (full diff vs doc 01 + slice files + AGENTS.md)

Verdict: **PASS, no findings requiring fixes.**

- **Core purity intact across all four slices** — the ONLY core touch is S47's data-only `project.controller`
  schema field (no IO/DOM imports added; core's 560 tests unchanged). PixliteClient lives in `packages/io`
  behind an interface with a real fake (the seam the whole group's tests use). `packages/core` never touches it.
- **The confidence chain is complete** (doc 01 §"end-to-end confidence chain"): app fired → server sent
  (`OutputStatus`) → **controller received** (`receiving`/`inGood`) → controller outputting (`outFrmRate`,
  port health) — each link has a UI home in the panel.
- **Verification contract met** — PixliteClient fake covers all methods; the monitor + panel + takeover are
  fake-backed in tests; strict JSON ordering + sequential queue + interest-gating + lastSeen aging +
  multi-watcher auto-revert all unit/integration-tested.
- **Live smoke-load (my independent run):** `LEDRUMS_ENGINE=voice pnpm ui-shot patch-controller --strict` —
  controller inspector renders (S03 OUTPUT panel + S48 CONTROLLER Discover/empty-state), **clean console, no
  effect loops / throws**, `watchController` lifecycle clean.
- Design system engaged + regenerated on both UI slices (S48 controller panel states, S49 takeover state demo).

## Deviations accepted

- S46 defined `modeTestData` on the interface (permitted); S49 added `modeLive` (§7.7.1) — both necessary and
  minimal (back-to-live/auto-revert are impossible without `modeLive`).
- S49 takeover is server-authoritative (echoed on `ControllerStatus.testPattern`) rather than local state —
  the right call for multi-client agreement + reconnect. Per-port/per-pixel params are wired through but the
  ui-light panel exposes only all-outputs targeting (in scope for v1).

## 🟡 LIVE SPOT-CHECK for the final gate (hardware — per doc 01 / slice files, deferred by design)

Needs a real PixLite A4 Mk3; fake-backed in tests, **do NOT block the group**. At the final gate:
- Discover → adopt a real controller; the panel shows live identity + per-universe rx (`receiving` true while
  the show plays; a pulled cable makes "not receiving"/LOST unmissable) + temp/voltage/port health.
- Identify flashes the device LED; Adopt-IP populates output host.
- A test pattern lights the rig with the engine stopped; the takeover banner + `TEST` output pill show the
  whole time; back-to-live restores the live stream; closing the panel auto-reverts.

## Context pack

Group L is terminal — nothing cross-lane. New wire surface for the record: client msgs
`discoverControllers`/`adoptController`/`identifyController`/`watchController`/`controllerTestData`/
`controllerBackToLive`; server msgs `controllerStatus`/`controllerDiscovery`; `project.controller` persistence.

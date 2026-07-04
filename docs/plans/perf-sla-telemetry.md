# Plan: Per-Effect SLA Performance Telemetry

## One-line objective
Give the LEDrums render pipeline durable, low-noise performance telemetry so that when a
drummer reports "the lights lagged," the operator can look at long-lived stats/logs, confirm
the incident, see **which effect** blew the frame budget and **why**, and download the log to
diagnose semi-remotely.

**Status:** planned, code-truth verified 2026-07-05 (all anchors below re-checked against
source by explorer agents; line numbers drift — re-anchor by symbol). Not yet implemented.

---

## Background & motivation

- LEDrums is a real-time generative lighting engine driving a 3D LED-pixel drum kit. Frame
  render time on the server **must stay under 8ms at basically all times** (the 120fps tick
  interval) — this is the SLA.
- A perf regression appeared where lights lag; at its worst, frame time hit ~500ms (unusable),
  most noticeable on the **confetti burst** effect. Suspected to coincide with moving to a
  Single-Source-Of-Truth (SSOT) model where the server render engine is authoritative for
  pixels (the browser sim no longer renders independently when connected).
- Investigation findings (context, not the task itself):
  - `packages/core/src/effects/impl/confetti-burst.ts:107-124` runs a nearest-pixel search
    **per particle** — O(particles × pixels), up to ~2.24M distance ops/frame at the
    `MAX_PARTICLES=4096` cap (line 24). It is also the app's biggest per-frame allocator
    (`pt.pos = {…}` rebuilt per particle per frame, lines 90-98).
  - Per-frame allocations in the web store `snapshot()`
    (`apps/web/src/lib/trigger-lab/store.svelte.ts:1604-1617`) add secondary GC pressure.
  - `packages/core/src/voice/compositor.ts` is fine (opacity + alpha early-exit) — not a suspect.
- **We cannot currently prove or triage this from inside the running app.** The only server
  perf signals today are hit→light latency (`voice-engine-host.ts:431`) and a rolling-1s FPS
  (`voice-engine-host.ts:395-401`), broadcast in the 500ms `stats` message — no per-effect
  breakdown, no history, no persistence. This plan builds the measurement so future
  regressions are caught by data, not user complaint. (Fixing confetti's algorithm is a
  *separate* follow-up, unblocked by this telemetry.)

---

## Goals

1. Measure **per-effect** render time every frame on the **server** (the loop that drives the
   physical lights / the SSOT), with negligible overhead on the happy path.
2. Record telemetry **only when a budget is violated** (SLA-gated) so the log stays small but
   every entry is a real incident with enough context to root-cause.
3. Persist telemetry so it is **long-lived** (survives server restarts).
4. Surface it in the web UI as a new **Performance** view, listed directly below Monitor in
   the left rail.
5. Provide a way to **download the raw log file** so the operator can diagnose semi-remotely.
6. Also monitor the **web UI RAF loop** (per-stage) so operator-facing jank is visible, since
   UI jank erodes confidence even when the lights themselves are fine.

## Non-goals

- Do **not** change confetti's algorithm or fix the regression here. This is measurement only.
- Do not add end-to-end network latency measurement (UDP output is fire-and-forget).
- Do not build alerting/notifications. Passive telemetry + a UI view is the scope.
- Do not instrument the **legacy** `Engine` path (see locked decisions).

---

## Locked design decisions

| Decision | Value |
|---|---|
| Timing granularity (server) | **Per-effect, always-on** (whole-frame breakdown is required, not optional) |
| Per-effect budget | **5ms** |
| Whole-frame budget | **8ms** (≈ the 120fps tick interval; a frame over 8ms is already late) |
| Violation trigger | Frame flagged if **either** budget trips (any effect > 5ms **or** frame total > 8ms) |
| Root-cause context | Optional `telemetry?(state)` hook on effects, captured **only on flagged frames**; confetti returns live particle count |
| Server = authoritative SLA | Per-effect timing; drives the lights |
| Client = UI-jank monitor | **Per-stage** RAF timing (not per-effect — the browser doesn't render effects when connected) |
| Persistence | Server writes to disk under the projects dir; aggregates load on boot |
| UI placement | **New `performance` workspace view** in the left rail, listed directly below Monitor (see "UI model correction" below) |
| Download | Server HTTP route serving the raw violation log as a file; UI "Download log" button |
| Engine scope | **Voice engine only** (`LEDRUMS_ENGINE=voice`, how dev + the rig run). Legacy `Engine` untouched — same accepted-no-op precedent as `setKitOutputs` (ROUTER, Patch-authoritative S1) |
| Effect timing unit | Aggregate by **effect/generator id per frame** (a frame may render the same effect on several voices — sum the voice renders into one per-effect ms; report voice count in violation context) |

### Budget vs tick-rate note (be aware, not a change)
The voice host loop runs at **120fps** (`voice-engine-host.ts` `TICK_MS = 1000/120`, ~line 47),
i.e. an 8.33ms frame interval. The 8ms whole-frame budget sits right at that interval, so a
violation means a genuinely late frame. The telemetry must record the actual
frame ms so sub-budget-but-over-interval drift is still visible in aggregates (`ewmaMs`,
`maxMs` are recorded for every frame, not only violations).

---

## Design (codebase-design vocabulary)

**`FrameProfiler` is the one new seam.** It is a deep module: a tiny interface
(`frameStart() / begin(effectId) / end(effectId) / frameEnd()`) hiding all timing, budget
gating, aggregation, ring-buffering, and persistence behind it. Two adapters make it a real
seam from day one:

- **No-op adapter** (in `packages/core`, the default) — keeps core pure and offline/test paths
  zero-cost.
- **Clock-backed recording adapter** (in `apps/server`) — owns `performance.now()`, the
  budgets, the violation gate, aggregates, ring buffer, and disk IO. Core never sees a clock.

The interface is the test surface: determinism is proven by rendering identical frames with
the no-op vs recording adapter and asserting byte-identical framebuffers; the gate/aggregate
logic is tested against the recording adapter alone with a fake clock, never through the
engine. The client RAF monitor reuses the same interface with a third, browser-local adapter
(session ring only, no disk) — leverage from one seam across both hosts.

`telemetry?(state)` on `EffectGenerator` is a second, minimal interface extension (one
optional method), pulled **only on flagged frames** so it costs nothing on the happy path.

---

## Hard constraints (from AGENTS.md — do not violate)

- **`packages/core` stays pure**: no Node/DOM/IO imports. Do **not** import or call
  `performance.now()` (or any clock) inside core — verified: core currently gets time only as
  parameters (`VoiceBusEngine.tick(now, dt, transport)`). Core only calls the injected
  profiler's `begin/end` hooks.
- **Determinism**: render output must be byte-identical and deterministic whether profiling is
  on or off. The profiler must never influence pixel output. Prove this with a test.
- **No per-frame allocation on the happy path**: pre-allocated per-effect ms buffer/map reuse;
  only build context/violation objects when a frame is actually flagged.
- **UI work must use/extend the design system** (`docs/design-system.html`; styleguide in
  `apps/web/src/lib/styleguide/` — see its README extension contract) and apply the
  `/make-interfaces-feel-better` polish pass.
- **UI changes must be verified with `pnpm ui-shot`** captures of the affected surface.
- Run `pnpm test` and `pnpm typecheck` green before considering any slice done.

---

## Key file anchors (verified 2026-07-05; lines drift — re-anchor by symbol)

### Core (`packages/core`)
- `src/effects/types.ts:43-63` — `EffectGenerator` interface. `telemetry?(state)` slots
  naturally between `timebase?` (46) and `createState?` (61). No existing telemetry hook.
- `src/effects/registry.ts` — 41 effects in the `ALL` array (47-89); confetti id is
  `'confetti-burst'`.
- `src/effects/impl/confetti-burst.ts` — state `ConfettiBurstState { particles, rng, lastSeq }`
  (17-21); `MAX_PARTICLES = 4096` (24); hot loops 87-124.
- **Voice engine (the one to wire):** `src/voice/engine.ts` — `VoiceBusEngine.tick(now, dt,
  transport)` main tick 616-642, voice composite loop 631-640. Effect renders happen in
  `src/voice/compositor.ts` (voice iteration 138-178, `generators.renderVoice()` at 176) →
  `src/voice/generator-bridge.ts:141` `gen.render(genCtx, params, genScratch, v.genState)`.
  **This is the begin/end wrap point**; the effect id is the voice's generator id, the state
  for `telemetry()` is `v.genState`.
- Legacy `src/engine/engine.ts` (tick 184-219, `renderLayer` effect call at 234) — **NOT
  wired** (locked decision), listed only so nobody wires it by accident.

### Protocol (`packages/protocol`)
- `src/index.ts` — `ServerMessage` union at ~356; the `stats` variant at ~364:
  `{ t:'stats'; stats: EngineStats; latencyMs; fps; output; voice? }` (`EngineStats` is
  imported from `@ledrums/core`). `ClientMessage` union at ~38. Encode/decode in
  `ws-protocol.ts` on the server, consumed by `apps/web/src/lib/ws/client.ts`.
- Budget constants (effect 5ms / frame 8ms) belong here so server + web share them.

### Server (`apps/server`)
- `src/voice-engine-host.ts` — voice-mode host (`main.ts:55` selects via
  `LEDRUMS_ENGINE=voice`). Loop: recursive `setTimeout`, `TICK_MS = 1000/120` (~47), loop
  start 352-356, per-frame `step()` 390-434 (calls `engine.tick()`; latency calc at 431;
  rolling FPS 395-401). **Inject the clock-backed profiler here; `frameEnd` handling lives in
  `step()`.**
- `src/main.ts` — stats broadcast `setInterval(..., 500)` at 626-650 (voice mapping 627-645).
  WS handling is split: `decodeClient` at 367 → `handleClientMessage` (370) →
  `src/handlers/client-message.ts`. HTTP routing chain at 192-196
  (`updateStatusHttpHandler` → `nativeHttpHandler` → `serveStatic`); model the new
  `GET /diag/perf-log.jsonl` handler on `handleUpdateStatusHttp` (554-595).
- Persistence patterns to reuse: `src/atomic-file.ts` (`writeFileAtomic` async 31-41,
  `writeFileAtomicSync` 18-28) for the aggregates snapshot; `src/autosave.ts`
  (`createAutosaver`, 400ms debounce, `markDirty()`/`flush()`) for scheduling; files live in
  `PROJECTS_DIR` (`src/projects.ts:16-21`, default `apps/server/projects/`,
  `LEDRUMS_PROJECTS_DIR` override). **Note:** the JSONL violation log is append-only — plain
  `fs.appendFile` (async, off-loop) is correct there; atomic temp+rename is only for the
  aggregates JSON.
- Monitor bus: `src/monitor.ts` `createMonitorBus` (`emit/replay/snapshot`, 300-event
  retention); `MonitorEvent` types in `packages/protocol/src/index.ts:323-334`. Violations
  additionally emit a monitor `system`-type event (coalesced — see Slice 4) so incidents show
  in the Monitor timeline too.

### Web (`apps/web`)
- `src/lib/trigger-lab/store.svelte.ts` — RAF loop 789-816; stages in order:
  `sim.tick(dt)` (793), `renderFrame()` (798, skipped when `useServer`), `snapshot()` (799),
  `tickDockDisplay(dt)` (800), `syncTransport()` (813). `snapshot()` at 1604-1617.
  `onStats` callback wired at 1425-1439 (sets `latencyMs`, `fps`, `output`, `busLevels`,
  `serverVoices`).
- `src/lib/ws/client.ts:238` — `case 'stats'` dispatch; new perf fields/messages flow the
  same way (add an `onPerf`-style callback or extend `onStats`).
- **UI model correction (the old plan was wrong here):** Monitor is **not a dock** — it is a
  first-class **workspace view**. `View` union in `src/lib/app/shell-nav.ts:12`
  (`'perform' | 'objects' | 'sections' | 'trigger' | 'patch' | 'monitor'`); NAV array in
  `src/lib/app/chrome/LeftRail.svelte:22-29`; mounted in
  `src/lib/app/AuthorShell.svelte:99-100` (`{:else if shell.view === 'monitor'}`), rendering
  in the center workspace with the right column (Visualizer/Buses) intact. **Performance is a
  new `View` following exactly this pattern**, its NAV entry placed directly after Monitor's.
- Component to model on: `src/lib/app/docks/Monitor.svelte` (props
  `store` + `variant?: 'dock'|'workspace'`; tokens + `Select` + `ListItem`-style rows).
- **Download-link gap (verified):** the web app currently talks to the server over WS only —
  there is no existing `<a href>`-to-server-route pattern. When served by the server the app
  is same-origin (`<a href="/diag/perf-log.jsonl" download>` works); in Vite dev (`:5173`)
  it is not. Derive the HTTP base from the active WS URL (the store/client knows it) so the
  button works in both cases.
- Styleguide contract: `src/lib/styleguide/README.md:27-35` — new reusable pieces go to
  `lib/ui` + a `sections/Section*.svelte` demo + regenerate `pnpm design-system` in the same
  change.

---

## Data shapes

**Per-effect aggregate (tiny, permanent — one row per effect id, updated every frame):**
```
{ effectId, frames, violations, maxMs, ewmaMs, lastMs, lastTs }
```

**Violation log entry (written only on a flagged frame):**
```
{ ts, frameMs, budgetFrameMs, budgetEffectMs,
  worst: { effectId, ms },
  breakdown: [ { effectId, ms, voices }, … top 3 ],
  context: { pixelCount, voiceCount, effect?: Record<string, Record<string, number>> } }
  // effect context keyed by effectId, e.g. { "confetti-burst": { particles: 3200 } }
```

- In-memory ring buffer capped at **500 entries**; every entry also appended to a JSONL file
  (`PROJECTS_DIR/perf-violations.jsonl`, `fs.appendFile`, fire-and-forget off the loop).
- Aggregates snapshotted to `PROJECTS_DIR/perf-aggregates.json` via the
  autosaver + `writeFileAtomic` pattern (debounced; flush on shutdown); reloaded on boot.
- JSONL file size guard: on boot, if > ~5MB, rotate (rename to `.1`, start fresh) — one
  simple guard, not a log framework.

---

## Slices

Uniform ~15–25-min slices, one seam each, stable IDs, ≤6 acceptance boxes. Tags route model
tier (`plumbing`/`mechanical` → cheaper tier; `ui-significant` → strongest tier). Each slice
ends green on `pnpm test` + `pnpm typecheck`.

### S01 — `FrameProfiler` seam + voice-engine wiring `[core]`
Define `FrameProfiler` (`frameStart/begin/end/frameEnd`) + exported no-op adapter in
`packages/core` (suggest `src/voice/profiler.ts`, re-exported from the package root).
`VoiceBusEngine` accepts an optional profiler (defaults to no-op); wrap the whole `tick`
(frameStart/frameEnd) and each generator render (`generator-bridge.ts:141` — begin/end with
the voice's generator id; pattern-effect renders in `compositor.ts` get the same wrap if they
render outside the bridge — check `renderVoice` at compositor.ts:176 and wrap at the one
choke point that covers both).
**Accept:** □ no-op default changes zero behaviour (existing core tests green) □ determinism
test: identical framebuffers with no-op vs a recording stub □ begin/end called once per
voice-render with the correct effect id (stub-profiler test) □ no clock import in core
□ typecheck green.

### S02 — `telemetry?()` hook + confetti implementation `[core]` (dep none)
Add optional `telemetry?(state: State): Record<string, number>` to `EffectGenerator`
(`effects/types.ts`, beside `timebase?`). Implement on confetti:
`{ particles: state.particles.length }`.
**Accept:** □ interface change compiles, all 41 effects unaffected □ confetti unit test:
after N ticks telemetry reports live particle count □ hook is never called by core itself
(caller-pulled only).

### S03 — Protocol types + budget constants `[protocol, plumbing]` (dep none)
In `packages/protocol`: `PERF_BUDGET_EFFECT_MS = 5`, `PERF_BUDGET_FRAME_MS = 8`; the
aggregate + violation-entry types above; extend the `stats` `ServerMessage` variant with
`perf?: PerfAggregate[]`; add `ClientMessage` `{ t:'perfLog' }` and `ServerMessage`
`{ t:'perfLog'; entries: PerfViolation[] }`.
**Accept:** □ types exported + consumed by server and web without casts □ protocol test
round-trips the new messages □ typecheck green across all pkgs.

### S04 — Server recording profiler: gate, aggregates, ring `[server]` (deps S01, S02, S03)
Clock-backed `FrameProfiler` adapter in `apps/server` (new `src/perf-telemetry.ts`), injected
into `VoiceEngineHost`. On `frameEnd`: update aggregates (scalar math, pre-allocated map);
if any effect > 5ms or frame > 8ms, build the violation entry — breakdown top-3, pull
`telemetry?.(v.genState)` for effects in the breakdown, pixel/voice counts — push to the
500-cap ring. Emit a coalesced monitor `system` event (≥1 violation in the last second → one
event) via the existing bus. No disk yet.
**Accept:** □ fake-clock unit tests: effect-budget trip, frame-budget trip, both, neither
□ under-budget frames record aggregates but no ring entry, zero allocation (no entry object
built) □ ring caps at 500 □ telemetry pulled only on flagged frames □ legacy engine-host
untouched.

### S05 — Persistence: JSONL append + aggregates snapshot/boot-load `[server, plumbing]` (dep S04)
Append each violation to `PROJECTS_DIR/perf-violations.jsonl` (async `appendFile`,
fire-and-forget, never awaited on the render path). Aggregates persisted via
`createAutosaver` + `writeFileAtomic` to `perf-aggregates.json`; loaded (defensively — bad
file → fresh) on boot; flushed on shutdown alongside the project flush. Boot-time >5MB
rotation.
**Accept:** □ violations appear in the JSONL (integration test with temp dir) □ aggregates
survive a host restart □ corrupt/absent files don't crash boot □ rotation renames + restarts
the file □ no sync IO on the render path.

### S06 — Wire protocol + HTTP download route `[server, plumbing]` (deps S04, S05, S03)
Include aggregates in the existing 500ms stats broadcast (`main.ts:626-650` voice branch);
answer `{ t:'perfLog' }` from the ring (handler in `src/handlers/client-message.ts`). Add
`GET /diag/perf-log.jsonl` to the HTTP chain (`main.ts:192-196`, modeled on
`handleUpdateStatusHttp`) streaming the JSONL with a download content-disposition.
**Accept:** □ stats messages carry `perf` in voice mode □ perfLog request returns ring
entries newest-first □ HTTP route returns the file (and 200-with-empty when none) □ server
tests green.

### S07 — Client RAF jank monitor `[web]` (deps S01 (interface), S03 (budgets))
Browser adapter of `FrameProfiler` (session-scoped: per-stage aggregates + small ring +
`jank` flag, no disk) wrapping the store RAF loop stages (`sim.tick`, `renderFrame`,
`snapshot`, `tickDockDisplay` — store.svelte.ts:793-800) and the whole loop against the 8ms
frame budget. Store exposes runes for the Performance view.
**Accept:** □ store tests: stage timings populate; jank flag trips over-budget and clears
□ zero per-frame allocation under budget □ loop behaviour otherwise unchanged (existing
store tests green).

### S08 — Performance view `[web, ui-significant]` (deps S06, S07)
Add `'performance'` to the `View` union (`shell-nav.ts:12`), NAV entry directly below Monitor
(`LeftRail.svelte:22-29`), mount in `AuthorShell.svelte` beside the Monitor branch. New
`PerformanceView` (model on `docks/Monitor.svelte` workspace variant): per-effect SLA table
(effect, violations, maxMs, ewmaMs, lastMs; worst-first; over-budget rows use the `--live`
red), recent-violation feed (pull `perfLog` on mount; show context incl. confetti particles),
client UI-jank strip (S07 runes), **Download log** button hitting `/diag/perf-log.jsonl`
(base derived from the WS URL so it works from Vite dev too). Build from design-system
primitives; anything new + reusable → styleguide + `pnpm design-system` in the same change;
apply `/make-interfaces-feel-better`.
**Accept:** □ shell-nav reducer tests updated □ view renders populated + empty states
□ download button works connected via server AND from `:5173` dev □ `pnpm ui-shot` captures
(populated + empty), zero console errors □ design-system regenerated if primitives added.

## Dependency table / sequencing

| Slice | Depends on | Parallel-safe with |
|---|---|---|
| S01 | — | S02, S03 |
| S02 | — | S01, S03 |
| S03 | — | S01, S02 |
| S04 | S01, S02, S03 | S07 |
| S05 | S04 | S07 |
| S06 | S03, S04, S05 | S07 |
| S07 | S01, S03 | S04–S06 |
| S08 | S06, S07 | — |

Lane shape: `(S01 ∥ S02 ∥ S03) → (S04→S05→S06 ∥ S07) → S08`. No two slices edit the same
files except the protocol package (S03 owns it; S06/S07/S08 only import).

## Definition of done
- All slices merged with `pnpm test` and `pnpm typecheck` green.
- Under normal load, the violation log stays empty/near-empty (no false positives under 8ms).
- Triggering heavy confetti produces violation entries attributing the frame to
  `confetti-burst` with a particle count in context.
- Aggregates survive a server restart; the JSONL download returns the file.
- The Performance view renders server aggregates, the violation feed, and the client jank
  strip; ui-shot captures clean.
- Render output remains deterministic and byte-identical with telemetry enabled.

## Open questions (none blocking)
- None. All previously open decisions are locked in the table above. One watch-item: if the
  rig is ever run with the legacy engine (`LEDRUMS_ENGINE` unset), telemetry is silently
  absent — acceptable per the `setKitOutputs` precedent, but the Performance view should show
  an explicit "no server telemetry (legacy engine)" empty state rather than pretending all is
  well (folded into S08's empty state).

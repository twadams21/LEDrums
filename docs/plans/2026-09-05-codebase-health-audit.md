# Codebase health audit — 2026-09-05

## Next action

Land the contained repair batch, then tackle **P01–P03 (document/model lifetime correctness)** before cosmetic refactoring. Answer the four decisions below before their respective slices; independent reliability slices can proceed meanwhile.

**Source:** Trent's in-session request to audit performance, dead code, duplicated logic and reliability; fix obvious problems and plan the rest. Machine attribution: `scutil --get ComputerName` → Trent’s MacBook Pro. Recommendations below are audit recommendations, **not approved product decisions**.

**Scope:** current merged app, base `763c422` (`origin/main`, v0.3.0), in an isolated `ledrums-health-audit` worktree. The original checkout was an older prototype branch with an unrelated dirty planning file; neither its code nor its unmerged prototype commits belong in this repair PR. Read-only audits covered core, server/IO, web, desktop/release tooling and the ingest worker. Historical ROUTER entries were navigation, not evidence of present behavior.

**Evidence limits:** source review plus targeted probes/regression tests; this is not an exhaustive security audit or a hardware/load certification. No end-to-end speedup percentage is claimed. Quantities below are operation counts, retained-buffer sizes or synthetic reproductions, not measured drum-kit latency improvements. No production data or releases are modified.

## Contained repairs in this branch

| ID | Problem and repair | Evidence / contract preserved |
|---|---|---|
| F01 | `apps/server/src/main.ts` queued every binary preview frame even when a viewer's socket was congested. `preview-broadcast.ts` skips replaceable frames while `bufferedAmount > 0`, resumes at the next live frame. | Regression: 300 frame broadcasts previously produced 300 sends to the blocked client; now zero, healthy clients still receive all 300. JSON/control delivery is unchanged. This bounds **preview-added** backlog, not all JSON traffic. |
| F02 | Both `engine-host.ts` and `voice-engine-host.ts` initialized an engine-time FPS window with process uptime. Start/restart now anchors it to engine time and clears the sample. | Four regressions reproduce zero FPS after one second with a 60-second process uptime. **Remaining:** this reports ticks per simulated second, not actual wall-clock throughput; see measurement plan below. |
| F03 | Inactive pooled voices retained generator/modifier accumulators and Mix/Splice sub-voices that respawn discards anyway. One `deactivateVoice` helper now releases these references on reap and reset. | Tests cover both lifecycle paths, latch clearing, live-voice preservation and slot reuse. Retention was bounded by the pool, not an unbounded leak. Echo allocates 1,024 bytes per scoped pixel per voice: 16 expired 4,096-pixel Echo voices could retain 64 MiB solely in those rings. |
| F04 | `packages/core/src/canvas/scene.ts` rebuilt a model-change sampling cache into a local variable, leaving the caller's state stale forever. Retain the rebuilt fields in the caller-owned state. | Model replacement must rebuild once, then reuse the new sampling table; a rebuild allocates at least two pixel-sized Float32 arrays (8 bytes/pixel) plus sampling work. |
| F05 | `packages/core/src/voice/compositor.ts` reused Splice layouts across different models with equal pixel totals. Invalidate on model identity change. | Warm-cache same-total topology edit must match a fresh compositor. Synthetic old behavior: hoop sizes `[4,4] → [2,6]` retained `RRBBRRBB` rather than fresh `RBRRRBBB`. |
| F06 | `apps/server/src/telemetry/ship-queue.ts` acknowledged by key, deleting a newer same-key update arriving during shipment. Acknowledge only the captured entry identity. | Deferred-transport regressions cover replacement, reused payload objects, eviction/reinsertion, other-key arrivals, item/byte accounting and drop counters. |
| F07 | `workers/error-ingest/src/backups.ts` ignored R2 listing cursors. Read all pages before applying existing newest-first ordering. | Multi-page adapter regression places the newest backup beyond page one. HTTP contract is unchanged. |
| F08 | Remove unused npm `@tauri-apps/plugin-clipboard-manager` binding from desktop manifest/lockfile. | No JS/TS imports; shell uses `invoke` through the **retained** `@tauri-apps/api`. Rust clipboard plugin and capability remain: they are live, not dead code. |

All new behavior has colocated regression coverage except F08, which is dependency reachability cleanup. Validation results are recorded below after the integrated sweep.

## Follow-up plan: correctness first

Locations below refer to the audit base, so use symbols as well as line numbers after rebasing. Each row is a separate reviewable PR; do not combine these into a store rewrite.

### P01 — Isolate show replacement, Undo and simulator ownership · HIGH

- **Evidence:** `store.svelte.ts:365–368,1211–1215,1249,1278–1282,1338–1345`; `shows-controller.svelte.ts:311–329`. Undo snapshots carry no show identity and survive a switch. Probe: checkpoint in A, create B, Undo → B remains active but receives A's graph and BPM (177); autosave can persist that contamination. New/open also leave old voices, evaluation state and bus references alive: looping voice count stayed 1 and `sim.buses !== store.buses` after New Show.
- **Implementation:** centralize all new/open/adopt/delete-active transitions at one document-replacement module; bind history to document identity; clear/rebind the runtime, delayed fires, sequence/PRNG/latch state, and buses there. Include save-as and server adoption explicitly, rather than patching only the New button.
- **First safety slice:** prevent history from applying a checkpoint belonging to another document, regardless of the final history-retention policy. No decision is needed to prohibit cross-show writes.
- **Acceptance:** edit A → new/open B → Undo never changes B to A; repeat with save-as, delete-active and server library adoption. Switch with loops, delayed actions and advanced sequences; no stale voice or delayed fire survives and current bus policy applies. Verify offline and connected paths via browser/store tests plus `pnpm ui-shot`.
- **Decision Q1:** whether returning to A restores A's own history or starts a clean history. Both are safe if identity is enforced; current cross-show replay is not.

### P02 — One authoritative project replacement module · HIGH

- **Evidence:** `apps/server/src/main.ts:565–579` (`applyRestoredSnapshot`) and `handlers/projects.ts:44–47` replace only the legacy host's project/output. The active voice host retains old geometry, input map, transport and output while persistence/state messages describe the replacement.
- **Implementation:** use a shared replacement interface for load, restore and bulk replacement, with explicit responsibilities for project, show libraries, transport, old-output teardown and both runtime adapters. Do not call `adoptPatch` and assume it replaces composition/transport too.
- **Acceptance:** load/restore a project changing geometry, MIDI mapping, output destination and transport. Persisted snapshot, reported model and actual voice host must converge **without a browser reconnect or resync**. Failed validation/safety backup leaves all live state unchanged. Test operation ordering with fake outputs.
- **Dependency:** coordinate old-output teardown with P07; no UI redesign required.

### P03 — Invalidate live geometry-dependent effect state · HIGH

- **Evidence:** `voice/engine.ts:302–306`, `voice/generator-bridge.ts:85–87`, `modifiers/chain.ts:50`. `setModel` replaces output buffers but leaves live generator/modifier state sized for the old model. Feedback reads beyond its old accumulator after growth (`modifiers/impl/feedback.ts:40–46`); targeted audit probe produced 16 non-finite framebuffer values after four→eight pixels.
- **Implementation:** model identity/version ownership for generator/modifier state, including composite members and equal-total topology changes. Reset or remap state consistently in core and offline preview; F04/F05 fix specific caches but do **not** solve all live-state lifetimes.
- **Acceptance:** grow, shrink and reorder a kit during active feedback/echo/particles, Mix and Splice; all floats finite, all array accesses in range, deterministic output after reset. Repeat with equal pixel totals.
- **Decision Q2:** whether editing geometry may restart active visual trails/particles (recommended for the first safe slice) or must preserve/remap them.

### P04 — Render each generator once, then apply multi-range scope · HIGH

- **Evidence:** `voice/compositor.ts:509–511,317–318`, `voice/generator-bridge.ts:145–146`. Each selected hoop range invokes the whole-model generator with the same mutable state and full `dt`; both cost and state advancement multiply by range count. Audit probe: Pixel Accumulation state energy 16 for whole-kit versus 14.4774 for equivalent two-hoop scope after one frame.
- **Implementation:** separate whole-model generation from range masking/composition. Decide and encode whether temporal modifiers are full-output or range-local; merely passing `dt=0` after the first range does not make repeated rendering safe.
- **Acceptance:** fixed pixels with 1/4/16 selected hoops invokes each generator exactly once per frame; equivalent scopes are pixel-identical and range-order independent. Include Mix/Splice, temporal and spatial modifiers, seeded effects. Compare before/after p50/p95 runtime and allocations with identical input traces.

### P05 — Observable asynchronous output failures · HIGH

- **Evidence:** `packages/io/src/artnet.ts:48–62,71–74`, `sacn.ts:94–103,111–115`; `apps/server/src/output-manager.ts:210–215`. UDP bind/error callbacks are swallowed; manager increments successful-looking packet counts when Art-Net is not ready. Synchronous `try/catch` cannot catch these failures.
- **Implementation:** add readiness/error events behind `PixelOutput`; keep send fire-and-forget. Separate attempts from locally accepted sends; never imply a UDP send proves the controller received it. Coalesce repeat diagnostics and surface recovery.
- **Acceptance:** injected bind `EADDRNOTAVAIL` and send `ENETUNREACH`, close during pending bind, successful recovery. No unhandled error, false healthy summary or render-loop wait. Include both Art-Net and sACN adapters and existing output UI verification if status presentation changes.

### P06 — Controller test-mode transition state machine · HIGH

- **Evidence:** `controller-monitor.ts:228–233,445–450,491–495`. Last watcher can disconnect while `modeTestData` is pending; `testPattern` is still null, so cleanup skips returning to live. Failed `modeLive` also clears state too early, making retries no-op.
- **Implementation:** distinguish pending/active/reverting, owned by controller generation. If interest disappears during acquisition, revert after it settles. Clear active takeover only on successful revert; stale responses must not alter a newly adopted controller.
- **Acceptance:** deferred acquisition → final watcher leaves → response resolves → live command sent; first revert rejects → later retry actually sends. Also cover controller replacement and concurrent pattern requests. Hardware confirms controller returns to live, not merely that the request was issued.

### P07 — Blackout retired output coverage · HIGH

- **Evidence:** `output-manager.ts:99–127`. Same-destination topology edits do not teardown; destination changes blackout using the incoming map rather than the previously transmitted coverage. Removed universes can hold their last lit frame depending on controller loss behavior.
- **Implementation:** retain previous transmitted universe/channel coverage, clear removed universes/channels before adopting a new map or closing the old destination. Do not zero newly rerouted live data after the new frame.
- **Acceptance:** nonzero U1/U2 → U1-only sends zeros to U2; shrink channel count on the same universe; change destination and topology together sends old-map blackout to the old destination. Verify actual PixLite behavior as a hardware gate.

### P08 — Remove core/offline rendering and pool policy divergence · HIGH

- **Evidence:** `apps/web/src/lib/trigger-lab/render.ts:195–205,217–254` bypasses downstream modifiers for composites; `Effect → Mix → Levels(brightness=0) → Output` gave preview max RGB 59 while core gave 0. `sim.ts:518–645,769–784` retained 300 loop voices on a poly bus; core caps at 256.
- **Implementation:** first add pixel-level replay parity tests (not just action parity). Reuse the core compositor and voice lifecycle through an offline adapter where practical; otherwise ship temporary minimal parity repairs with explicit deletion follow-up. Avoid creating a third set of render/lifetime rules.
- **Acceptance:** post-Mix/Splice Levels, spatial and temporal modifiers match byte output; thousands of loop hits stay capped with the same deterministic steal/latch behavior. Respect section transport, scrubbing and browser ownership requirements during adapter design.
- **Dependency:** P03/P04 own shared lifetime/render behavior; coordinate, do not independently copy their new logic into sim.

### P09 — Own WebGL resource disposal · MEDIUM

- **Evidence:** `visualizer/Pixels.svelte:58–66,264–280,307`. Replacing uploaded BufferAttributes does not delete their old GPU buffers. Probe against installed Three internals: 9 allocations, 0 deletions across three rebuilds; final geometry disposal deleted only the latest 3. Geometry/material supplied as Mesh props are not separately registered by the installed Threlte disposal hook.
- **Implementation:** explicitly own geometry/material lifetime, disposing uploaded attributes before replacement or replacing/disposing the whole geometry; ensure instance colors also follow ownership. Apply the UI/design skills and screenshot verification even if appearance should be identical.
- **Acceptance:** balanced allocation/deletion across model replacements and repeated Perform/view mounts; preserve instancing, colors, picking and geometry. Verify in a real browser, not only jsdom.

### P10 — Debounce expensive persistence work; budget Undo memory · MEDIUM

- **Evidence:** `store.svelte.ts:915,1278–1285,1368–1374,1423–1434`; `shows-controller.svelte.ts:286–301`. Whole libraries are snapshotted **before** the debounce. Undo snapshots then structured-clones whole authored/project state, retaining up to 10,000 copies.
- **Implementation:** track dirty revisions cheaply, materialize snapshots at debounce/flush time while preserving unload and server-send ordering. Then use structural sharing or inverse operations with a byte budget for history. Keep identity rules from P01.
- **Acceptance:** large-library slider/drag trace produces one materialization per committed debounce burst, unload flush preserves the last edit, no save indicator lies. Measure main-thread time and retained history bytes.
- **Decision Q3:** acceptable undo memory budget/history guarantee; recommendation is a memory budget, not 10,000 full document clones. Do not silently reduce the current advertised depth.

### P11 — Move backup work off the render event loop · MEDIUM

- **Evidence:** `backups/snapshot-store.ts:217–233`; `main.ts:597–598`. Cadence uses synchronous read/gunzip/stringify/gzip/write/rotation. Async project autosave does not protect against these timer-driven stalls.
- **Implementation:** snapshot an immutable revision, serialize/compress off-thread, use async filesystem operations and serialize restore/snapshot transactions. Pre-risk mutations must await a durable safety snapshot and fail closed; changing every call to fire-and-forget would break recovery guarantees.
- **Acceptance:** delayed storage and multi-megabyte libraries do not block render timer progress. Simultaneous edits/restore/cadence produce coherent versioned bundles; backup failure refuses destructive mutation. Test shutdown durability explicitly.

### P12 — Pin every OTA checkout to the requested release commit · HIGH, release-only

- **Evidence:** `.github/workflows/release-ota.yml:91,116,188` checks out the dispatch ref, not `inputs.tag`; gate validates version, not commit identity. Two commits sharing a version can pass and publish the wrong code.
- **Implementation:** resolve the requested tag to a commit SHA once, export it from the gate and use it in every checkout, including publish helpers. Verify script versions cannot come from an unrelated dispatch ref.
- **Acceptance:** workflow fixtures with same-version/different-SHA dispatch and tag; every build and upload helper uses the resolved tag SHA. Test via dry run only; a real GitHub Release remains a separate explicit publish authorization.

### P13 — Match Node SEA generation and injection exactly · MEDIUM, release-only

- **Evidence:** `apps/desktop/scripts/build-sidecar.mjs:207,247,287–295` generates blobs using any active Node 22 but injects into pinned 22.23.1 binaries; CI selects floating Node 22.
- **Implementation:** one pinned version shared by build setup, generator and both injection targets; universal builds reject a mismatch before artifact creation. Preserve local fallback deliberately, not accidentally.
- **Acceptance:** mismatched active Node fails clearly, pinned universal build passes Mach-O checks and launches its sidecar. No publish required for validation.

### P14 — Decouple and atomically claim ingest notifications · MEDIUM

- **Evidence:** `workers/error-ingest/src/handlers.ts:59–80`, `discord.ts:17–22`. Notifications are awaited in the ingest loop without timeout/status checking; an unresolved fetch prevents processing the rest of a batch. Check-new/insert/notify and budget check/write are non-atomic; simultaneous first reports can both ping (audit probe reproduced this).
- **Implementation:** atomic D1 claims/budget increments; notification outside request-critical ingestion via `waitUntil`, bounded timeout and status handling. Use a durable outbox if retry delivery is required rather than promising exactly-once network delivery.
- **Acceptance:** stalled webhook does not stall ingest; concurrent duplicates cause at most one claimed notification; budget cannot overrun via concurrent checks. Explicitly test failed Discord HTTP responses.
- **Policy assumption:** best-effort notification is sufficient unless Trent requests guaranteed retry delivery; preserve error persistence regardless.

### P15 — Make dead-code tooling trustworthy, then delete in small batches · LOW

- **Evidence:** `knip.json:3–8` declares workspace entries at root. Actual Knip 5 run flags live `apps/desktop/shell/main.js`, web design-system entry and desktop `@tauri-apps/api`; usages are explicit in `prepare-bundle.mjs:53`, shell imports and `apps/web/design-system.html:10`. Raw scan reported 11 unused-file candidates; this is **not** 11 verified deletions.
- **Implementation:** configure entrypoints by workspace, include build scripts, styleguide/UI-shot seams and dynamic registry roots. Pin the tool/version and add a reproducible package command; ratchet verified findings rather than broad ignores. Only delete after checking runtime, script, test and registry reachability.
- **Decision Q4:** authorize removal of the held legacy Patch Graph/prototype surfaces after Settings parity/hardware sign-off? `PatchGraphView.svelte` has no current runtime importer and `?view=patch` redirects to Settings, but prior project instructions explicitly held deletion. Do not infer approval from unreachability.
- **Acceptance:** shell/design-system/API no longer false-positive; legitimate dead fixtures are found; production build, desktop shell preparation, design-system and UI-shot entrypoints remain valid after each deletion batch.

## Cross-cutting module and measurement work

Do this alongside the appropriate correctness slices, not as a standalone file-splitting exercise:

1. **Shared runtime rules, separate adapters.** Core/offline compositor/pool divergence has demonstrated output and lifetime defects (P08), not merely similar-looking source. Share those rules behind a small render/tick/reset interface and differential replay tests. The two server project adapters likewise need the single replacement module in P02.
2. **Store depth, not shorter files.** The large `store.svelte.ts` mixes document lifetime, persistence, undo and runtime ownership. Extract those ownership modules with small interfaces in P01/P10; avoid a facade exposing the same hundreds of methods from different files.
3. **Trustworthy measurements.** Correct the remaining FPS denominator to actual wall time in a separate telemetry change; retain simulated tick rate separately if useful. Record tick p50/p95/p99, maximum event-loop gap, active voices, pixels, scene/graph sizes and missed budget counts. Reuse the existing `docs/plans/perf-sla-telemetry.md` rather than invent a competing dashboard.
4. **Reproducible benchmark matrix.** Fixed seed/time/input replay, 1/16/64/256 voices, ordinary kit and larger pixel model, scoped effects, Mix/Splice and temporal modifiers. Warm caches, report allocations and before/after runtime distributions. UI workload adds large libraries, rapid edits and repeated model/view replacements. Hardware test checks MIDI/OSC→light and actual UDP destination/blackout behavior.
5. **Context hygiene.** `.mex/context/architecture.md` described the old Composition-first system, browser-only MIDI/no cloud backend and 41 effects. This batch adds a current-runtime correction and explicitly marks that original map historical: native desktop MIDI, the voice engine and ingest worker now exist. ROUTER remains a long historical ledger; verify facts against code and expand an up-to-date architecture/lifecycle map separately from history. This audit initially exposed exactly the stale-branch risk those docs must guard against.

## Decisions for Trent

1. **Undo across show switches:** clear history on switch (simpler) or preserve a separate bounded history per show? Recommendation: clear on replacement first, with document-ID protection either way.
2. **Live geometry edits:** may active trails/particles restart, or must they be remapped continuously? Recommendation: restart geometry-dependent visual state; never allow NaNs or stale-sized buffers.
3. **Undo budget:** keep a fixed action-depth promise or adopt a memory budget with a minimum useful depth? Recommendation: byte budget plus structural sharing, chosen against representative show sizes.
4. **Held code removal:** can legacy Patch Graph/prototypes now be removed, or is Settings/hardware parity sign-off still pending? Recommendation: retain until that specific gate is confirmed.

These are the actual ambiguous behavior choices. Fixing UDP error visibility, queue acknowledgements, invalid cache lifetimes or cross-show corruption does not need a product vote.

## Verification ledger

- Current-main baseline: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test` exited 0. Existing Svelte/jsdom warnings were present (including canvas mocks and `derived_inert`); green does not mean warning-free.
- F01: extracted original broadcast path → one targeted test failed (300 vs 0 blocked-client sends); fixed → 3/3 green.
- F02: four new start/restart FPS tests failed (0 vs 60/120); fixed → 4/4 green.
- F03: two new reap/reset tests failed on retained state; fixed → 10/10 pool tests and 78/78 engine tests green. Live-voice preservation is covered.
- F04–F08 and integrated final gates: pending closeout below.
- No UI components/styles changed in this batch; UI redesign and screenshots belong to the planned web changes. No hardware or live Worker/OTA deployment is claimed.

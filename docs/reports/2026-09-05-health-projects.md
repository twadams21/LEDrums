# Health audit P02 / P11 — project replacement and backups

**Next:** orchestrator integrates this branch with the later core/parity/state fixes and runs integration gates. No push/PR/merge/release/deploy or hardware action was performed here.

**Status:** P02 implemented locally; P11's async gzip/filesystem, revision capture, transaction ordering and shutdown barriers implemented. **JSON serialization is still synchronous: the audit's full off-thread-serialization goal is not complete.**

**Source:** Trent's resumed sa-19 request and P02/P11 in `docs/plans/2026-09-05-codebase-health-audit.md`; P05/P07 integration contract in `docs/reports/2026-09-05-health-output.md`. Machine: `scutil --get ComputerName` → `Trent’s MacBook Pro`. Worktree `/Users/trent/Documents/dev/ledrums-health-projects`, branch `fix/health-project-backups`. Existing implementation and shutdown commit `55c5393a` were preserved after the usage-limit interruption. No operation was run in the dirty original `../ledrums` checkout. This branch predates the orchestrator's later core/parity/state repairs; no attempt was made to copy them here.

## Ground: runtime and persistence contract

### Authoritative replacement

`project-replacement.ts` is the shared coordinator for named project load, backup restore and bulk `setProject` patching. The production handler receives that one coordinator from `main.ts`.

1. Capture the incoming revision; parse/validate project integrity and routing, validate library envelopes, construct fresh legacy and voice runtimes off to the side. Restore projects the persisted active show and referenced song-library closures into a protocol-validated runtime Show. Both engine modes reject malformed restored authored-show data before the safety operation. Canvas scene registrations are delayed until commit so rejected staging cannot change the current registry.
2. Await a successful pre-risk backup, flush earlier autosaves, then atomically persist the replacement. Validation, failed safety backup and failed persistence do not switch live engine/model pointers or publish a replacement state. Old rendering/input continues during slow IO.
3. Reuse the **existing active OutputManager** and apply replacement output settings/map before its first new frame. P07's owned old coverage drives old-destination/removed-prefix blackouts. The inactive legacy host in voice mode never arms a second adapter. An unexpected throwing output collaborator triggers a best-effort disk rollback before reporting failure; ordinary UDP failures use the manager's diagnostics, not a pretend network transaction.
4. Commit both hosts and the exact library slots synchronously, then send **one** authoritative state sync. New runtimes discard old voices, queued engine inputs/delays and evaluation state; model/frame sizes, input mapping, project transport and output map all belong to the replacement. Null libraries clear old slots instead of silently retaining them.

Load and bulk patch retain the current runtime Show definitions; restore rebuilds them from the restored libraries. Replacement resets engine time/beat and transient host controls. Restore queues the persisted active section for the new engine's first tick. Load/patch do not preserve the old runtime playhead/active-section position; fresh-engine defaults apply. These are observed implementation semantics, not a promise of a seamless live musical transition.

`main.ts` serializes authored WS operations around awaited load/restore, including async controller adoption. MIDI/OSC, recall and performance inputs remain immediate; queued operations re-check editor authority on execution. The OSC timestamp now comes from the actual active host clock.

### One on-disk authority

`project-storage.ts` writes `{version:1,files:{project,showLibrary,songLibrary}}` to **`default.state.local.json`** using the existing async same-directory temp-write/rename helper. All three autosavers write this same envelope through one FIFO queue. A replacement cannot leave a cold start combining three different file revisions; null slots survive restart.

On boot, a present valid envelope wins over `default.local.json`, `default.shows.local.json` and `default.songs.local.json`. The old three files are import-only once it exists and remain untouched for recovery. An unreadable/corrupt authority fails closed rather than silently loading those stale files. The authority filename is excluded from named-project listings and reserved against named-project writes; path separators/traversal are rejected. Named load/save/list use async filesystem operations at the control boundary.

**Durability definition:** success means the atomic writer's rename completed. Neither the existing helper nor this change calls `fsync`; sudden power loss is not certified. Older app versions do not understand the envelope and can reopen stale three-file state—downgrading requires an explicit export/recovery procedure, not deleting the authority casually.

### Async backups and queues

`SnapshotStore` now exposes Promise-based snapshot/list/read/restore plus drain/close. A snapshot stringifies all three slots **before queueing**: later in-place edits cannot leak into that captured revision. Async zlib gzip/gunzip runs through Node's worker pool, and directory reads, file reads, atomic writes and retention removals use async filesystem APIs. Snapshot writes/rotation are FIFO; concurrent restores are FIFO; production restores delegate validation/safety/commit to the coordinator without queue recursion. Failure rejects/refuses the operation without poisoning the next request.

Snapshot ids are monotonic against the current listing, same-millisecond calls and backwards clocks, so rapid pre-risk calls do not overwrite a recovery point. Unchanged cadence is skipped using the serialized content signature, including recovery of the latest signature after reopening. Existing retention budgets are preserved. Optional off-site handoff remains best-effort, after local completion.

### Shutdown

`55c5393a` makes host stop/OutputManager close awaitable: frames stop synchronously, retained coverage is blacked out, pending adapter drains settle before process exit, and already-retired adapters are included. The manager-level 500 ms deadline also bounds an uncooperative adapter (real UDP adapters have their own 250 ms drain bound). `main.ts` closes the authoring/replacement/backup queues and waits for storage; shutdown flushes the autosavers after that barrier. A disk-drain failure does not bypass the UDP barrier.

Resume review found that an already-queued ordinary `setOutput` could reopen an adapter after the first stop. `d49f9a68` repeats the idempotent host stop after accepted authoring drains and awaits that final adapter too. New input/work is refused once shutdown begins; accepted queued edits can still persist. A targeted test failed with one stop instead of two before this fix, then passed.

## Record: exact verification

### Recovered pre-interruption evidence

The prior sa-19 transcript was recovered from the project worktree's Pi session log, not inferred from the handoff summary. These commands exited 0:

```sh
pnpm --filter @ledrums/server typecheck
pnpm --filter @ledrums/io typecheck
pnpm --filter @ledrums/server exec vitest run \
  src/boot.test.ts src/output-manager.close.test.ts src/project-replacement.test.ts \
  src/backups/snapshot-store.test.ts src/backups/snapshot-store.async.test.ts \
  src/project-storage.test.ts src/main.integration.test.ts \
  src/handlers/projects.test.ts src/handlers/client-message.test.ts \
  src/engine-host.test.ts src/voice-engine-host.test.ts src/host-fps.test.ts \
  src/output-manager.test.ts src/output-manager.lifecycle.test.ts \
  src/output-manager.coverage.test.ts src/output-manager.udp.test.ts src/output-monitor.test.ts \
  src/autosave.test.ts src/projects.test.ts src/show-library.test.ts src/song-library.test.ts \
  src/backups/offsite.test.ts
```

**232 tests / 22 files passed**, 14.95 s. Expected stderr came from deliberately missing/corrupt backups and injected EACCES. A subsequent prior-agent command, after adding actual new-MIDI-map and library-projection coverage, passed **21 tests / 3 files**:

```sh
pnpm --filter @ledrums/server typecheck
pnpm --filter @ledrums/server exec vitest run \
  src/project-replacement.test.ts src/project-show.test.ts src/main.integration.test.ts
```

### Resumed final narrow checks

No full-workspace sweep was repeated. After the two review corrections (final output drain and legacy restore validation):

```sh
pnpm --filter @ledrums/server typecheck
pnpm --filter @ledrums/server exec vitest run \
  src/boot.test.ts src/output-manager.close.test.ts src/project-replacement.test.ts \
  src/project-show.test.ts src/project-storage.test.ts \
  src/backups/snapshot-store.async.test.ts src/main.integration.test.ts
```

**Exit 0: server typecheck; 33 tests / 7 files passed**, 6.40 s. Log: `/tmp/health-projects-resume-tests.log`. Across the recovered wide scoped set and the final narrow set, **237 distinct tests in 23 files** are covered; this is a union, not a claim that a fresh 237-test sweep ran. The IO files were not edited in this slice; their recovered scoped typecheck remains the IO evidence.

| Seam | Evidence |
|---|---|
| Replacement, 17 tests | Both modes: actual host/model/input/transport convergence, old U1/U2 blackout before new frame, same-destination prefix shrink with the same adapter, changed destination, exact null libraries, no browser resync, old frame progress during deferred safety IO, validation/backup/ENOSPC failures, disk rollback for injected output throw, concurrent restores/replacements and non-poisoned queues. Canvas preflight cannot publish a scene before safety succeeds. |
| Show projection, 2 tests | Referenced song closure, deduplicated references, pad-slot mapping, saved active selection and source immutability; null vs malformed authored envelope. |
| Async snapshots, 3 tests | Two captured revisions cannot absorb later mutation; one writer at a time; close waits behind a deferred 4 MB write while a 1 ms timer makes progress (>5 ticks in 80 ms); ENOSPC refuses restore and retry works; corrupt/version/path rejection. |
| Storage, 2 tests | Twenty writes queue in order and retain the call-time revision; null round-trips through a new store; only the authority file remains; corrupt authority cannot silently fall back. |
| Shutdown, 3 + 4 tests | Boot idempotence, disk failure still awaits UDP/controller, late reopened adapter is drained; OutputManager/host close waits for callbacks, deadlines bound uncooperative adapters, both host modes stop frames immediately and can restart. |
| Real main, 2 tests | Actual `src/main.ts` child process through `node --import tsx`, WS load → library edit → bulk patch → restore → exactly one state sync → SIGTERM exit 0 → cold restart. Both voice and legacy modes. Changed geometry yields 12 pixels, MIDI channel 9 and BPM 177. Restart prefers the envelope although the old project file still says `old`. |

Real-server fixtures allocate fresh temporary storage and unused local TCP/UDP ports, use only loopback WS clients, set pixel output **disabled**, loopback output host and broadcast false, and allowlist the child environment with `LEDRUMS_TELEMETRY=off`. No inherited tunnel/token/hardware configuration or external client is used. Tests clean up child processes/storage. These launch the real source entry, **not a packaged SEA/desktop bundle**; no full production build or desktop verification is claimed. The server's package `build` script is itself `tsc --noEmit` (the same check above).

Review red command: `pnpm --filter @ledrums/server exec vitest run src/boot.test.ts` → 1 failed / 2 passed, “expected spy to be called 2 times, but got 1”; `/tmp/health-projects-shutdown-review-red.log`. Only the shutdown-review regression is claimed as a new red→green proof in this resumed session.

### Conventions checklist

1. Core gained no Node/DOM/IO import: **PASS, no core edits**.
2. Persisted Project and runtime Show still use existing schema gates: **PASS**. New interfaces describe server collaborators/envelopes, not competing core model definitions.
3. Effect/render purity: **PASS, no effect/render changes**; clock/IO stay in the host.
4. Typed WS messages: **PASS, existing union unchanged**; async handling uses the existing discriminants.
5. Colocated regressions and scoped typecheck/tests: **PASS as above**; `git diff --check` and staged diff checks passed. Full integration sweep belongs to the orchestrator. No UI files changed, so no design-system/UI-shot work was required.

## Latency and allocation evidence — qualified, not a blanket performance claim

Reproducible committed probe:

```sh
pnpm --filter @ledrums/server exec node --expose-gc --import tsx \
  src/backups/snapshot-latency.probe.ts
```

Exit 0, Node **v25.8.2**, local temp files only. Raw resumed output: `/tmp/health-projects-snapshot-latency-allocation.json`. Fixture: **45,000 deterministic varied graph-like rows**, **6,445,592 bytes** per files envelope, **8 pre-risk snapshots**. The synchronous comparator performs JSON stringify + gzipSync + writeFileSync eight times; it is a **synthetic blocking baseline, not a checkout of the entire historical SnapshotStore**. The async path includes the real queued store, atomic writer and listing/rotation. Optional off-site handoff is absent. The 1 ms timer samples process memory too, so measurements include probe overhead and are not a controlled machine-wide benchmark.

| Measurement | Synchronous baseline | Queued real store | Serialization-only control |
|---|---:|---:|---:|
| Total elapsed | 1,324.15 ms | 1,514.83 ms | 348.90 ms |
| Timer gaps p50 / p95 / max | 1.38 / 6.11 / **1,325.60 ms** | 1.28 / 1.92 / **356.08 ms** | 1.34 / 1.39 / **350.21 ms** |
| Timer samples | 29 | 949 | 30 |
| Sampled peak heap-used delta | 13,099,224 B | **65,224,056 B** | 12,930,592 B |
| Sampled peak RSS delta | 31,232,000 B | **65,372,160 B** | 13,152,256 B |
| Sampled peak ArrayBuffer delta | 16,149,502 B | 24,228,478 B | 0 B |

Async **submission** p50/p95/max: **43.98 / 47.49 / 47.49 ms** (8 calls). Serialization-only per-call p50/p95/max: **42.92 / 46.99 / 46.99 ms**. After all eight captures, queued-work timer gaps p50/p95/max were **1.28 / 1.92 / 13.64 ms**, 934 samples (includes the short post-completion observation window). Thus compression/disk waiting yields to timers, but capture still causes a substantial burst stall. **Total wall time was longer**, not faster, for the queued path in this run.

Allocation/retention interpretation:

- Eight simultaneously pending immutable strings represent **51,564,736 bytes of UTF-8-equivalent payload**. This is a computed payload count, not an assertion about V8 one-/two-byte strings, ropes or object overhead. FIFO serializes compression/write concurrency; it does **not** impose a byte bound on captured requests.
- Sampled async heap after explicit GC stayed **6,710,904 B** above that phase's baseline, consistent with the store retaining its last serialized content signature; this is an observation, not a heap ownership proof. RSS after GC delta was 7,999,488 B; ArrayBuffer delta was 0 B. V8 external accounting can lag collection (reported external delta 24,228,478 B), so it is not added to retained heap or called a leak.
- Memory samples are process gauges, **not total allocated bytes or a full allocation profile**. Peaks inside blocking synchronous work can be missed. Earlier phase caches/allocator behavior and other machine work can affect the comparison. No allocation reduction, unbounded-queue safety, frame-budget compliance or MIDI-to-light speedup is claimed.
- The recovered prior uninstrumented probe also showed the same qualitative split: 1,208.10 ms synchronous max gap vs 341.44 ms queued max gap, 13.93 ms queued post-capture max; stringify submission median 42.34 ms. Different instrumentation/runs must not be treated as matched performance samples.

## Limits / integration risks

- **Residual main-thread work:** JSON stringify at capture/autosave, parse after gunzip, initial signature recovery, optional off-site bundle parse/queue work, project/schema/model staging and state serialization. P11 is not complete as an off-thread-serialization project. Large libraries can still miss render budgets, and queues retain one string per accepted pending snapshot. Add a measured byte budget/coalescing policy or real serializer worker in a separately reviewed slice; never coalesce required pre-risk recovery points silently.
- **Failure atomicity is local, not distributed:** single-file rename protects coherent cold recovery, not power loss or disk+hardware atomic commit. Catastrophic failure of disk rollback after an unexpected output-stage exception may leave disk/live disagreement; pre-risk recovery is the escape hatch. Autosaver's existing error handling logs failures rather than turning every shutdown into a guaranteed successful save. Storage/shutdown work has no new global timeout.
- **Output is best-effort UDP:** old-prefix zero submission/drain and callback settlement do not prove network ordering, controller receipt or optical blackout. Pending caps, drain deadlines, failed old destinations and abrupt termination remain P05/P07 limitations. Actual PixLite sign-off is still owed. An already-queued ordinary output edit can briefly reopen an adapter during shutdown; the final stop now drains it before exit.
- **Authored format boundary:** the new server projection follows this branch's current web-owned library shape and protocol Show gate; it is not a replacement for the browser's entire migration/hydration pipeline or a newly shared authoring model. Unsupported older malformed libraries fail closed. Load/patch retain runtime definitions but reset playback position. Reconcile this projection with later core/offline/state work at orchestration; no packages/core or apps/web changes were made here.
- No browser, visual, full-workspace, packaged desktop/SEA, release, off-site Worker/R2 or real-controller validation was run. No dependency/package-lock changes. No new outbound pixel traffic from the real-server tests; host/output tests use fakes. No live data was accessed.

## Local commit ledger

- `55c5393a` — existing preserved shutdown/OutputManager drain barrier.
- `d49f9a68` — resumed review fix: drain the output lifetime reopened by queued shutdown edits.
- `c450e4d6` — shared coordinator, staged hosts, async backups, atomic live-state storage, handlers, source-server regressions and reproducible latency/memory probe. These land together because the Promise API, coordinator and production call sites are interdependent.
- This report and the GROW scaffold/event updates are a separate documentation commit; see the final handoff commit list. No push is authorized.

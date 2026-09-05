# P11 — bounded inline backup worker

**Next:** integrate this owned change with the other agents' server corrections; no push, PR, merge, release or deployment is authorized here.

**Status:** the scoped backup-worker/admission implementation is implemented and measured locally, including actual Node SEA execution. The improvement is **bounded admission and removal of backup JSON work from the main isolate**, NOT faster per-call capture, faster restore, lower total RSS, or a render-budget guarantee. All accepted checkpoints are preserved independently; refused safety checkpoints abort the risk operation. The residual costs below are part of this result, not deferred claims of success.

Source: Trent's P11 follow-up request in this session, `docs/reports/2026-09-05-health-projects.md`, and the P11 audit goal. Machine identity: `scutil --get ComputerName` → **Trent’s MacBook Pro**. Started in the integration worktree at `0c25083d`; other agents advanced it through `e5543b1d`, `dd718051`, and P02 correction commit `36b03ff6` during this work. No other agent's core/UI edits, frozen `../ledrums-health-projects` review, or parent-owned integration report were edited. No new dependency, native addon or production storage/main wiring was needed.

## Implementation and explicit defaults

`apps/server/src/backups/serializer-worker.ts` owns **one lazy, persistent Node worker**. Its program is a literal JS string passed to `new Worker(source, { eval: true, execArgv: [] })`. Builtin `require('node:…')` calls are its only imports. It is not `function.toString()` (bundlers can introduce closure helpers), an external worker file, or a source-only TS loader. The same literal was exercised inside an injected SEA.

1. `snapshot()` admits a request **before `readCurrent()` or `postMessage()`**. `postMessage` synchronously clones the files before returning, preserving call-time revisions despite subsequent in-place mutation. JSON stringify, SHA-256, gzip and optional handoff JSON parse happen in the worker. The worker holds the captured JSON until the FIFO owner assigns its monotonic id and requests packing. Compressed bytes transfer back without copying a pooled Buffer slab. Atomic write and existing retention ordering are unchanged.
2. Required `boot`/`pre-risk` checkpoints never coalesce or hash-deduplicate. Cadence alone compares a **64-character SHA-256 digest of `JSON.stringify(files)`**; key order remains significant, as before. A theoretical SHA-256 collision can skip cadence, never a pre-risk checkpoint. Reopening recovers the previous digest in the worker. No full JSON string remains as the main-thread last signature.
3. Read opens/reads the file asynchronously **in the worker**, bounds compressed input even if it grows after stat, uses bounded gunzip, parses and checks the envelope/id there. Returning the decoded object still invokes structured-clone deserialization on the main isolate; this was measured and is expensive. The optional off-site bundle return has the same kind of object-copy boundary.
4. Capture errors are observed immediately, before waiting behind an older disk write. Worker error/exit/message error/timeout rejects every outstanding RPC; queued captures lost in a crash fail explicitly when packing, never commit without a checkpoint. Subsequent requests lazily create a fresh worker. Cleanup RPC failure resets the worker rather than stranding captured JSON. Disposal rejects outstanding requests and awaits termination of every retiring worker. Workers are referenced during RPCs, unreferenced when idle, and joined on store close. Read/restore/capture admissions close before accepted work drains; accepted restore safety uses the internal snapshot seam, avoiding queue recursion.

These are **agent-selected implementation defaults**, configurable through `SnapshotStoreDeps.admission` / `.serializer.limits`, not separately approved product decisions:

| Budget | Default | What it actually bounds |
|---|---:|---|
| Pending snapshots | **2** | Entire accepted capture → FIFO → write/rotation/handoff/cleanup lifetime, before clone |
| Pending restores | **2** | FIFO restore operations; each gets its own intervening-state safety checkpoint |
| Public reads | **2** | Read/decode/result delivery operations |
| Worker RPC requests | **8** | Outstanding posted requests, before posting; no unbounded transport backlog |
| Per-files JSON size | **32 MiB** | UTF-8 size **after worker clone/stringify**, before packing/write |
| Retained captured JSON | **64 MiB** | Sum of worker-held files strings' UTF-8 sizes, after serialization |
| Compressed read | **32 MiB + 64 KiB** | Read input including a growth-after-stat check |
| Decompressed envelope | **32 MiB + 1 KiB** | Gunzip output; files receive the separate 32 MiB check |
| RPC timeout | **30 seconds** | Includes time behind other worker requests; timeout kills/replaces worker |
| Worker old-generation heap | **256 MiB** | Node worker resource limit in constructor; **not** a process/RSS/Buffer ceiling |

**There is no exact pre-clone byte/heap guarantee.** The count cap is checked first; clone can still copy an arbitrarily large caller object before the worker discovers its serialized size. A single enormous main-thread clone can still exhaust process memory before any refusal is possible. Worker stringify can also transiently allocate over its JSON budget before measuring it. Plain JSON project/library values are the persistence contract; uncloneable functions and non-JSON values such as BigInt/cycles refuse instead of becoming silently different checkpoints. Worker OOM/crash is an explicit failed operation. Neither the count cap nor UTF-8 budgets imply an object-graph heap bound.

Saturation rejects with `SnapshotRefusal(code='busy')`; oversize rejects with `code='oversize'`. The existing production coordinator already awaits `snapshot('pre-risk')` before persistence and live commit, so these exceptions abort named load/bulk replacement/restore. No required checkpoint is silently dropped. Existing disk-write failures still return null and trigger the coordinator's existing fail-closed path. Closing a store now refuses new decoding reads too; callers reopen a new lifetime rather than resurrecting a disposed worker.

## Matched measurements — improvements and regressions

Pinned executable for source, SEA blob generator and injected runtime:

```
../ledrums-health-release/apps/desktop/.node-pin/node-v22.23.1-darwin-x64/bin/node
```

Both report **Node v22.23.1, x64**. Fixture is the previous probe's **45,000 deterministic varied rows, 6,445,592 UTF-8 bytes/files envelope, eight requested pre-risk snapshots**. The comparator is **the actual `snapshot-store.ts` from `0c25083d`**, compiled to CJS with its original async gzip/atomic writer, not the older synthetic gzipSync baseline. Source uses explicit GC; SEA does not expose GC. Synthetic 1 ms timers include process-memory sampling and a 20 ms observation window. One machine/run is not a frame SLA or MIDI-to-light benchmark.

Final measured artifacts (local temp only): `/tmp/ledrums-p11-source-c.json`, `/tmp/ledrums-p11-sea-c.json`; binaries/comparator in `/tmp/ledrums-p11-sea-20260905-c/`. These measured the final worker/store implementation, including rejection of undefined slots that would otherwise produce unreadable safety checkpoints. The probe uses `afterObservationDeltaBytes`, not a post-GC label, when GC is unavailable.

### Source, pinned Node

| Operation | Accepted / refused | Total elapsed | Max timer gap | Max gap after burst submission | Accepted submission p50 / max |
|---|---:|---:|---:|---:|---:|
| Exact old queued store, 8-call burst | 8 / 0 | 1,385.09 ms | **367.28 ms** | 13.82 ms | **45.70 / 47.10 ms** |
| Worker default, cold 8-attempt burst | 2 / 6 | 794.97 ms | **140.53 ms** | 1.91 ms | 72.98 / 72.98 ms |
| Worker default, warm 8-attempt burst | 2 / 6 | 736.99 ms | **152.05 ms** | 1.89 ms | 75.89 / 75.89 ms |
| Worker diagnostic capacity=8 burst | 8 / 0 | 2,956.04 ms | **634.94 ms** | 2.63 ms | 77.35 / 98.03 ms |
| Worker default, 8 paced successful calls | 8 / 0 | 3,357.11 ms | **92.54 ms** | see qualification below | 75.78 / 91.09 ms |

**Measured default warm burst-stall reduction: 58.6%, achieved by refusing six attempts before copying them.** This is not eight checkpoints for the cost of two. Repeating all eight successfully requires pacing/retry; that run's largest gap was 92.54 ms, but total wall time was **longer**, not faster. Main-thread clone submission is **slower** than the former stringify for this many-small-object fixture. Raising capacity to eight makes the burst **worse than before**. Do not remove the admission cap on the strength of “JSON moved off-thread.” The paced probe's `postSubmissionGaps` resets at each call; it excludes the capture intervals and is not a whole-run stall metric.

The prior report's **356.08 ms** burst / **13.64 ms** post-capture result was Node v25.8.2 and is historical, not the matched baseline used here. An earlier pinned run also showed the default improvement (376.56 → 122.08 ms warm), but the table deliberately uses the final run, not the best sample.

### Actual SEA, same operations

| Operation | Accepted / refused | Total elapsed | Max timer gap | Post-submission max | Accepted submission p50 / max |
|---|---:|---:|---:|---:|---:|
| Exact old store | 8 / 0 | 1,461.74 ms | **381.50 ms** | 15.86 ms | 46.28 / 59.65 ms |
| Worker cold default | 2 / 6 | 817.36 ms | **161.28 ms** | 1.70 ms | 86.33 / 86.33 ms |
| Worker warm default | 2 / 6 | 767.57 ms | **142.63 ms** | 1.68 ms | 70.85 / 70.85 ms |
| Worker diagnostic capacity=8 | 8 / 0 | 2,983.09 ms | **640.23 ms** | 1.91 ms | 77.10 / 98.04 ms |
| Worker paced eight | 8 / 0 | 3,368.48 ms | **83.99 ms** | excluded captures | 75.45 / 82.92 ms |

Default warm burst gap improves **62.6%** in the actual SEA, with the same explicit 2/6 admission tradeoff. `isSea()` reported true. The main-server SEA independently passed real named load, safety backup, restore, graceful shutdown and cold recovery in both modes.

### Memory: reduced main-isolate retention, not reduced total memory

Source sampled peak main-isolate heap delta: old eight-pending store **71,761,632 B**, cold default worker **2,225,296 B**, warm default **2,102,216 B**. After explicit GC: old **+6,699,624 B**, warm worker **+52,472 B**, consistent with eliminating the retained main-thread JSON signature. This is a process-gauge observation, not an ownership heap profile or total allocation count.

Old eight pending files strings represent **51,564,736 UTF-8-equivalent payload bytes**; default two accepted copies represent **12,891,184 bytes for this fixture**. Actual V8 object/string overhead is not that number. Worker strings and cloned graphs live in another isolate; `heapUsed` describes the calling isolate, whereas **RSS is process-wide**. Cold worker RSS peak delta **90,492,928 B** exceeded the old **86,642,688 B**, not a total-memory win. Diagnostic eight-accepted worker RSS peak delta rose to **158,511,104 B**. Warm worker RSS/GC is allocator-sensitive. SEA had no explicit GC, so its end-of-observation deltas are not retention evidence. No leak-free or lower-RSS claim is made.

## Measured residual boundaries — do not call this render-path stall-free

| 6.4 MB operation | Source elapsed / max timer gap | SEA elapsed / max timer gap |
|---|---:|---:|
| Old backup read (main parse after async gunzip) | 116.57 / **67.74 ms** | 120.21 / **80.58 ms** |
| Worker backup read (worker parse, returned object clone) | 381.05 / **145.37 ms** | 365.36 / **138.59 ms** |
| Unchanged atomic project-storage save | 61.65 / **52.78 ms** | 64.45 / **53.22 ms** |
| Unchanged atomic project-storage read | 81.16 / **70.81 ms** | 82.69 / **71.57 ms** |

- **Read regressed on this fixture.** Parsing is genuinely off-thread, but delivering a large decoded graph costs more main-thread time than the old JSON parse. This implementation does not claim that a large restore became smoother. The measurement includes delivery/deserialization and scheduling/GC, not a isolated pure-copy stopwatch.
- `project-storage.ts` still synchronously stringifies at `save()` (measured submission **51.19 ms source / 51.58 ms SEA**) and parses its async read result on main. Its FIFO still has no byte admission cap. These are the separate atomic live-state/autosave boundary, not the bounded backup queue. The worker change does not bound all persistence or all upstream authoring messages.
- The existing off-site outbox synchronously serializes/enqueues a returned bundle when telemetry enables it. Its JSON work and return-clone overhead were **not** certified by the telemetry-off probe. Only the worker's optional handoff parse moved; shipping semantics and credentials were untouched.
- Project/schema/geometry staging, protocol/state serialization and ordinary input paths remain outside this seam. Large call-time clone, large returned-object clone and live-state JSON can miss multiple render frames. No zero-capture-cost, whole-render-path completion, frame-budget compliance or hardware performance claim is made.
- Durability remains the existing same-directory atomic rename, not fsync/power-loss certification. There is no new global filesystem deadline; a never-settling injected/OS disk operation can still delay close. Worker nonresponse is separately bounded by the RPC timeout. No distributed disk/controller transaction is implied.

## Regression and packaging evidence

Owned worker gate on pinned Node: **38 tests / four files passed**, server `tsc --noEmit` passed:

```sh
export PATH="$PWD/../ledrums-health-release/apps/desktop/.node-pin/node-v22.23.1-darwin-x64/bin:$PATH"
pnpm --filter @ledrums/server exec vitest run \
  src/backups/serializer-worker.test.ts src/backups/snapshot-store.test.ts \
  src/backups/snapshot-store.async.test.ts src/backups/snapshot-store.worker.test.ts
pnpm --filter @ledrums/server typecheck
```

Coverage: immutable call-time revisions; no calling-thread stringify/parse; FIFO writes and two restores with distinct intervening-state safety backups; monotonic IDs; retention; cadence across reopen; no pre-risk coalescing; byte and aggregate oversize/retry; busy refusal before readCurrent/clone; clone and stringify exceptions; worker throw/clean exit while multiple RPCs are pending; captured-but-queued loss behind slow disk; timeout/disposal/close/drain settlement; idle CLI exits without dispose; explicit disposal joins workers; compressed/decompressed oversize; public read/restore caps; actual named-load coordinator **busy/oversize/crash** refusals before persistence/host/library/broadcast commit. Expected EACCES/corrupt-file logs come from injected failures.

Red proof: the compiled exact old store was run with a `JSON.stringify` spy counting calls whose first argument was the live files object; assertion `captures === 0` failed **`1 !== 0`**. The same invariant and the main-thread parse invariant pass in `snapshot-store.worker.test.ts`. The old latency regression is also reproduced by the exact matched comparator, not just a mock.

Source-server load/restore tests passed in both modes. Actual SEA command (same test body, not a listening-banner-only smoke):

```sh
P11_SEA_BINARY=/tmp/ledrums-p11-sea-20260905-c/server \
  pnpm --filter @ledrums/server exec vitest run src/main.integration.test.ts \
  -t 'loads, restores once'
# 2 passed; 8 other cases skipped by the targeted load/restore name filter.
```

These real-server fixtures use fresh temporary storage, disabled pixel output, loopback hosts/WS and an allowlisted child environment with telemetry off; no controller discovery/output or off-site service was exercised.

### Reproduce source + ACTUAL SEA measurements

The builder refuses a wrong Node patch and a pre-existing output directory. It uses existing desktop esbuild/postject dependencies, duplicates the production bundle options (CJS/node20/builtin externals/import-meta banner), injects the blob into that exact pinned executable, and ad-hoc signs only the **temporary** macOS binaries. No downloads, Tauri build, release signing, deployment or app-data directory is involved.

```sh
NODE="$PWD/../ledrums-health-release/apps/desktop/.node-pin/node-v22.23.1-darwin-x64/bin/node"
OUT="/tmp/ledrums-p11-sea-$(date +%s)" # must not already exist
"$NODE" apps/server/src/backups/snapshot-worker-sea.probe.mjs "$OUT"
P11_BASELINE_MODULE="$OUT/baseline.cjs" "$NODE" --expose-gc --import tsx \
  apps/server/src/backups/snapshot-worker.probe.ts > /tmp/p11-source.json
env -i P11_BASELINE_MODULE="$OUT/baseline.cjs" LEDRUMS_TELEMETRY=off \
  "$OUT/latency" > /tmp/p11-sea.json
P11_SEA_BINARY="$OUT/server" pnpm --filter @ledrums/server exec vitest run \
  src/main.integration.test.ts -t 'loads, restores once'
```

The historical `snapshot-latency.probe.ts` remains runnable, with explicit **diagnostic capacity=8** and corrected limitations. It no longer silently assumes the production queue accepts eight calls.

### Concurrent ownership / scoped gates

During the wider targeted server run, another agent added version-validation and shutdown tests to shared files before their production changes were finished: **124 passed / six failed** (four unsupported-library-version cases, two shutdown-client-order cases). Those six were not worker failures and were not “fixed” by deleting/changing their assertions. **After their owner completed those corrections, the final scoped run passed 138 tests / 11 files and server typecheck** (the 38 worker tests plus `project-replacement.test.ts`, `project-storage.test.ts`, `main.integration.test.ts`, `handlers/projects.test.ts`, `handlers/client-message.test.ts`, `boot.test.ts`, `backups/offsite.test.ts`). This includes ten real-source-main cases, not just the original two. The final C-binary SEA load/restore filter also passed both modes. No full sweep was run. Only this slice's small worker-lifetime/capacity harness hunks in `project-replacement.test.ts` and SEA executable-selection/name hunks in `main.integration.test.ts` belong to this change; the other agent's edits in those files are not to be staged with it.

Final 138-test scoped command (exit 0, followed by server typecheck):

```sh
pnpm --filter @ledrums/server exec vitest run \
  src/backups/serializer-worker.test.ts src/backups/snapshot-store.test.ts \
  src/backups/snapshot-store.async.test.ts src/backups/snapshot-store.worker.test.ts \
  src/project-replacement.test.ts src/project-storage.test.ts src/main.integration.test.ts \
  src/handlers/projects.test.ts src/handlers/client-message.test.ts src/boot.test.ts \
  src/backups/offsite.test.ts
pnpm --filter @ledrums/server typecheck
```

## GROW / conventions

- **Ground:** JSON/hash/gzip/backup read decode moved to a packaged-safe worker; pre-clone count admission and post-clone JSON budgets now refuse safely; default burst gap and main-isolate retention improved with measured copy/read/throughput regressions explicitly recorded.
- **Record:** updated only the P11 portions of `.mex/ROUTER.md`, `.mex/context/architecture.md`, the existing health-audit runbook and one `mex log --type decision` event (same-day `last_updated: 2026-09-05`). This report supersedes only the P11 synchronous-backup-JSON residual in `health-projects.md`; P02 atomic authority/coordinator semantics and its storage/durability caveats remain. Historical reports and broad review remain unchanged.
- **Orient:** retain the matched exact-old-store comparator, count accepted/refused requests separately, test literal eval workers in an injected SEA, and never equate a worker with free structured clone or a pre-clone byte budget.
- **Conventions:** pure core untouched by this slice; no IO/effect/WS model changes; no new dependencies; colocated targeted regressions/types and actual packaging exercised. No UI edits, therefore no UI-shot/design-system work. Shared-file hunks must be staged independently of concurrent edits.

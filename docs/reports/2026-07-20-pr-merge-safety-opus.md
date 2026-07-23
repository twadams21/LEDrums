# PR merge-safety review — 2026-07-20 (opus, stage 1 of 2)

Primary reviewer pass over six open PRs in `twadams21/LEDrums`. A second adversarial
agent attacks this report afterward. Every non-trivial claim below is anchored to
`file:line` at the branch tip and, where it mattered, verified by me directly (not just
relayed from a sub-reviewer). Line numbers are against each PR's **head branch**.

## Method & evidence base
- Diffs reviewed against the correct base per PR (`origin/main...origin/<branch>`, except
  #138 = `origin/feat/observability-122...origin/feat/backups-123`).
- Five focused merge-safety sub-reviews (one per substantive PR) + my own verification of
  the most attackable claims (#137 env-gating, #138 restore/sync-IO/stacking, #117
  conflicts, cross-PR file overlap).
- **CI (measured, not assumed):** `checks` **SUCCESS** and `desktop` **SUCCESS** on all
  five substantive PRs (#140, #136, #137, #138, #117). CI green is real automated
  evidence, but it is **not** proof a human exercised the live feature paths (real worker
  round-trip, real restore-from-snapshot, real hardware output). Scores treat those live
  paths as **human-untested** unless a hermetic test covers them.
- **GitHub mergeability (measured):** #140/#136/#137/#138/#124 = `MERGEABLE / CLEAN`;
  **#117 = `CONFLICTING / DIRTY`.**

## Verdict at a glance

| PR | Score | Base | One-line |
|---|---|---|---|
| #140 patch-graph static outputs | **4/5** | main | Pure-core, mutation-parity enforced, delete-freeze killed at source; one latent id-collision edge case, non-blocking. Merge after a 3-min smoke. |
| #136 reconnect-handle polish | **4/5** | main | Small, display-only state, no edge-data corruption path; one fragile shared `bind:reconnecting` stuck-invisible risk; no ui-shot evidence. |
| #137 observability | **5/5** | main | Double env-gated, fail-quiet, non-blocking, hermetic tests. Safe to merge with the Worker absent — verified. |
| #138 backups | **4/5** | **#137** | Restore double-guarded, atomic writes, correct rotation, strong tests; −1 for sync gzip/IO on the cadence timer + one fail-open pre-risk gap. **Must merge after #137.** |
| #117 gen3 final wave | **1/5** | main | CONFLICTING, 114 commits behind main, central deliverable targets a file main has since rewritten. Close-and-reslice; cherry-pick the CI hardening only. |
| #124 docs slice pack | **5/5** | main | Docs-only (9 files, plans + ROUTER). No code. Merge anytime. |

## Recommended merge order
1. **#137** (observability) — independent, main-based, 5/5. Land first.
2. **#138** (backups) — **only after #137**; it hard-imports #137's telemetry modules and
   will not compile on main without them (evidence below).
3. **#140** and **#136** — independent of the above and of each other; land in either
   order. Verified: sequential merges auto-merge with **0 conflict markers** despite shared
   files (see cross-PR notes).
4. **#124** (docs) — anytime.
5. **#117** — do **not** merge. Close-and-reslice; optionally cherry-pick CI hardening as a
   tiny standalone PR.

**Second-lander rule:** #140, #136, #137 share edited files (details below). Textual
auto-merge is clean, but whichever of these lands *second* must re-run `pnpm typecheck` +
`pnpm test` before pushing — textual-clean ≠ semantically-verified when two features add
handlers/test-cases to the same files.

---

## PR #140 — patch-graph static 4/8 outputs + kill delete-freeze

**Merge-safety score: 4/5.** Tightly scoped, `packages/core` stays pure, mutation-parity is
enforced across all three write paths, and the delete-freeze is fixed at the source; the
point off is a latent id-collision degradation that is unproven by any test and slightly
undercuts the headline "self-heals to 8" claim. CI green (checks + desktop). Already
two-axis reviewed + gate-swept this session (typecheck 0, 2801 tests) — this pass verifies
rather than repeats.

**Must-fix before merge:** none.

**Notable risks / edge cases (all non-blocking):**
- **Latent duplicate-output-id on the grow path.** `reconcileOutputs` mints appended ids
  `output:${current.length + i + 1}` (`packages/core/src/geometry/kit-schema.ts:527-533`).
  If a *surviving* output already holds an id in the appended numeric range (plausible for
  exactly the corrupted 3-output file this PR targets — e.g. surviving `output:1,2,8`
  growing 3→8 re-mints `output:8`), the kit carries a duplicate id. It does **not** crash:
  `buildOutputHalf` dedupes and keeps the first (`apps/web/src/lib/app/patch-graph.ts:135-144`),
  but the appended empty port is dropped, so the user sees **7 nodes instead of 8** and the
  corruption persists to disk (`routing-integrity.ts` checks drum/hoop claims only, not
  duplicate output ids). Low severity; worth a follow-up, not a blocker.
- **Fallback keying change is the highest blast-radius line.** `deriveFlatOutputs` now keys
  on `hasWiredOutput = kit.outputs.some(o => o.segments.length > 0)` instead of
  `outputs.length > 0` (`packages/core/src/geometry/dmx-map.ts:83-84`) — correct guard
  against reconcile-seeded empty ports darkening the rig, and directly covered by new
  `dmx-map.test.ts` cases. No defect; flagged because every un-patched rig's lighting
  depends on it.
- **Undo across a 4↔8 toggle** resyncs port count via `setKitOutputs`, not the `expanded`
  flag (`project-resync.ts`) — pre-existing behavior, not introduced here, but the one
  interaction a human should eyeball.

**Non-negotiable violations:** none. `reconcileOutputs` is pure (no Node/DOM/IO, no RNG,
deterministic over `KitConfig`). Mutation parity satisfied: `Engine.setKitGlobal`
(`engine.ts:318-321`), `VoiceEngineHost.setKitGlobal` (`voice-engine-host.ts:228-232`),
web `applyKitGlobal` (`trigger-routing.ts:74-76`) all reconcile on `expanded` change.

**Manual test plan:**
1. Open the app (`pnpm dev`) → Patch view → Controller inspector. Toggle **Expanded ON**:
   the output half must render **exactly 8** nodes. Toggle **OFF**: exactly **4**.
   *Failure:* a stale count (3 or 7), or nodes not appearing/disappearing on toggle.
2. On the Patch canvas, click an **output node** (or a wire) and press **Delete/Backspace**.
   Expected: nothing is removed and the canvas stays responsive.
   *Failure:* the node/wire vanishes, or the canvas freezes (the original delete-freeze bug).
3. On the **Trigger** graph, select a node and press **Delete**. Expected: it deletes
   normally (this PR only disables delete on the Patch graph). *Failure:* Trigger deletes
   stop working (over-broad disable).
4. Boot the server against the corrupted 3-output expanded project. Open the Patch graph:
   expected **8** output nodes with no hand-edit. *Failure:* still 3 — or (the collision
   edge case) **7** nodes with one wired output silently missing; inspect reloaded
   `kit.outputs` for a duplicated `output:N` id.
5. Load a fresh/unwired kit (all ports empty) in the visualizer. Expected: the rig still
   lights via the flat fallback. *Failure:* a fully dark rig after reconcile seeds empty ports.

---

## PR #136 — reconnect-edge handle polish (reveal-on-hover + dead-grab fix)

**Merge-safety score: 4/5.** Small, well-isolated UI polish touching two view components +
the styleguide + its generated HTML; all new state is display-only (the actual reconnect is
still committed by SvelteFlow's unchanged `onreconnect` handler), so no path here corrupts
graph edge data. Point off: one genuinely fragile shared-binding pattern that can strand
the grab dots invisible, and no `pnpm ui-shot` evidence in the PR (AGENTS.md requires it for
UI changes). CI green.

**Must-fix before merge:** none blocking.

**Notable risks / edge cases:**
- **Both anchors two-way-bind the same `reconnecting` variable** (`WireEdge.svelte:106` and
  `:115`, driving `showDots` at `:39`). If xyflow does not reliably reset the bound value to
  `false` when a reconnect drag is *cancelled* (dropped in empty canvas / released off a
  valid handle), `reconnecting` latches `true` and `showDots` stays `false` forever — the
  grab dots go permanently invisible on that wire even on hover. Only a full
  reconnect-cancel round-trip in the running app rules this out; no evidence it was
  exercised. **This is the thing to test hardest (step 2).**
- **`anchorHover` shared by both anchors** (`:107`, `:116`): moving the pointer directly
  source-dot → target-dot relies on `pointerleave` firing before `pointerenter`; if order
  inverts, the `wire-grab` accent drops mid-hover. Cosmetic, low likelihood.
- **Regex bezier parse has a degrading fallback** (`:48-66`): if `getBezierPath` ever
  returns a path the regex doesn't match, `ctrl` is `null` and the target anchor collapses
  onto the source end — reintroducing exactly the "dead grab / wrong hit-target" class this
  PR fixes. Safe against current xyflow output; unguarded assumption about a library's path
  format.

**Non-negotiable / design-system:** no blocking violations. Colors use tokens
(`--bg-perform`, `--border-strong`, `--accent`); resting wire stays **grey** (no
re-introduced colored wires — matches the locked "wires stay grey" intent); **no
transitions/motion** added (respects the "instant, no motion" graph contract); styleguide
extended in the same change (`SectionGraph.svelte:305` + regenerated `docs/design-system.html`).
Nits: `stroke-opacity: 0.35` and dot sizes `9px`/`13px` are raw literals rather than tokens
(consistent with pre-existing `8px`, not a regression). **No ui-shot capture in the PR.**

**Manual test plan:**
1. Open a graph (Trigger or Patch canvas). Hover a wire → both end dots appear **instantly**
   (~30px inboard, source hollow / target filled), no fade/slide. Move off → dots vanish.
   *Failure:* dots never appear, or they animate in.
2. Grab a dot and **drop it in empty canvas** (cancel the reconnect), then hover that same
   wire again. Dots must reappear. *Failure (the shared-`reconnecting` bug):* dots stay
   invisible on that wire forever.
3. Hover directly over one end dot (not the wire body) → the dot steps up to 13px accent AND
   its owning wire lights accent (`wire-grab`); other wire ends stay grey. *Failure:* wrong
   wire lights, or none lights (dead-grab / wrong-hit-target regression).
4. Drag a dot onto a different valid node handle and release → the wire re-points; old edge
   gone, new edge present, no duplicate/orphan. *Failure:* duplicated wire, snap-back, or
   the dimmed reconnecting run never restored.
5. Before merge, run `pnpm ui-shot` on the graph surface and confirm no console errors
   (AGENTS.md requirement not satisfied in the PR).

---

## PR #137 — observability: remote error reporting

**Merge-safety score: 5/5.** Remote shipping is double-gated behind two env vars that are
unset by default; every failure path is caught and logged locally; nothing runs on the
render loop; CI green on top of thorough hermetic unit tests. The app is safe to merge with
the Cloudflare Worker **absent** — verified directly below.

**Worker-absent safety (verified by me, not just relayed):**
- **Env-gated, two independent gates.** `isTelemetryEnabled(env, {servingBuiltWeb})`
  (`apps/server/src/telemetry/envelope.ts`) returns true only on `LEDRUMS_TELEMETRY=on` or,
  by default, when serving a built web root (packaged prod). The **second** gate is the
  explicit `if (endpoint && token)` at `apps/server/src/main.ts:254` reading
  `LEDRUMS_TELEMETRY_ENDPOINT` / `LEDRUMS_TELEMETRY_TOKEN`. I confirmed this in the branch
  source: with those two unset, no `reporter` is created — capture feeds only the local
  Monitor and **nothing leaves the machine**. The PR bakes in no endpoint/token, so a
  packaged build ships nothing by default even though `isTelemetryEnabled` is true in prod.
- **Fail-quiet.** A dead/absent worker → `fetch` rejects → caught in the ship queue
  (`ship-queue.ts`, `failures++`, local log only, exponential backoff to a 30-min ceiling);
  non-2xx throws land on the same path; `reporter.observe` is wrapped so it never throws;
  the web sink swallows + re-entry-locks; `client.send` no-ops while the socket is closed.
- **Non-blocking.** `observe`/`enqueue` is in-memory (Map upsert + bounded 20-entry ring);
  disk mirroring is a coalesced `unref`'d async atomic write; flush timers are `unref`'d.
  The only **sync** disk write (`persistSync`) is wired exclusively to the fatal/exit path
  (`main.ts` `process.on('exit')` + `process-errors.ts`), never the render loop.

**Must-fix before merge:** none.

**Notable risks (accepted, note before enabling):**
- **PII only when enabled.** Envelopes carry `hostname`; server stack traces can carry
  absolute paths (`/Users/trent/...`). Highest surface is the `console.error` tap
  (`error-capture.ts`) which joins **all** args into `message` and forwards them unfiltered
  — any `console.error` containing project names, OSC/Art-Net hosts, file paths or tokens
  would be captured and (if enabled) shipped. Bounded by size caps, content unfiltered.
  Scoped to Trent's own endpoint and opt-in — acceptable, but know it before pointing at a
  shared endpoint.
- **Errors are NOT hidden from the developer** (verified good): the console tap always calls
  the original `console.error` first; `uncaughtException` still `exit(1)`s after reporting;
  `unhandledRejection` is logged locally.
- Endpoint URL (not the token) is echoed to the Monitor bus. Non-secret.

**Non-negotiable violations:** none. `packages/core` is untouched by telemetry; all
fetch/fs IO lives in `apps/server`/`apps/web`; the HTTP transport and clock are injected;
capture is fire-and-forget.

**Manual test plan:**
1. **Worker-absent default:** build + run the packaged server (serving the built web root)
   with `LEDRUMS_TELEMETRY_ENDPOINT` and `LEDRUMS_TELEMETRY_TOKEN` **unset**. Expected: the
   Monitor shows "Remote error reporting: capturing to Monitor only (ingest endpoint/token
   unset)". In browser devtools run `throw new Error('probe')` and `console.error('probe2')`
   → both appear as `error` events in the local Monitor, **no** network POST, and **no**
   `error-reports.jsonl` created in the projects dir. *Failure:* any outbound POST, or the
   app freezing/crashing.
2. **Env pointed at a dead URL:** set `LEDRUMS_TELEMETRY=on`,
   `LEDRUMS_TELEMETRY_ENDPOINT=https://127.0.0.1:9/ingest`, `LEDRUMS_TELEMETRY_TOKEN=x`.
   Run, trigger a web error. Expected: app keeps running; console shows repeated
   `[ship-queue] ship failed (attempt N)` with widening backoff; `error-reports.jsonl`
   accumulates but is capped (200 items / 2 MB, drop-oldest). *Failure:* FPS/render stall on
   error, an unhandled rejection surfacing, or unbounded file growth.
3. **Enabled + working:** stand up a trivial local HTTP endpoint that returns 200 and logs
   the body (5-line Node http server). Set endpoint to it + a token + `LEDRUMS_TELEMETRY=on`.
   Trigger an error; within the 30 s flush the stub receives a `POST` with header
   `authorization: Bearer <token>` and body `{"reports":[…],"dropped":0}`; then
   `error-reports.jsonl` drains to empty. *Failure:* token missing/wrong in the header,
   payload containing authored project data beyond message/stack/breadcrumbs, or the queue
   never draining.
4. **Kill switch:** with step 3's env, add `LEDRUMS_TELEMETRY=off` → no reporter, no POSTs,
   Monitor still shows local errors. Confirms override beats the prod default.
5. **Crash durability:** with step 3 enabled, force an `uncaughtException` in a boot path →
   process exits non-zero; on the **next** boot the queued crash report ships from the
   reloaded `error-reports.jsonl`. *Failure:* crash report lost after restart, or the process
   hangs instead of exiting.

---

## PR #138 — project backups (snapshots, rotation, off-site push, in-app restore)

**Merge-safety score: 4/5.** Restore is genuinely double-guarded (UI `danger` confirm +
a server-side pre-risk snapshot taken **before** any apply), writes are atomic, rotation is
correct and well-tested, and automated coverage is strong (round-trip / retention /
restore-safety / corrupt-bundle / Worker trust-boundary tests). The point off is for
**synchronous gzip/rotate IO on the main thread** and **one fail-open gap** in the restore
safety net. CI green.

**Data-loss analysis (verified against branch-tip source):**
- **Restore safety — strong, with one fail-open gap.** `restore(id)`
  (`apps/server/src/backups/snapshot-store.ts:238`) reads+decodes the target **first** and
  returns `null` on unknown/corrupt id with nothing applied (`:244-247`); then takes a
  `pre-risk` snapshot of current live state **before** `applyRestored` overwrites it
  (`:248-249`). `applyRestoredSnapshot` re-`parseProject`s (validates) before touching the
  engine, so an invalid-but-decodable bundle throws before any live mutation and is caught
  by the WS handler (socket stays alive). The on-disk project file is untouched until the
  async autosave debounce fires, so a crash right after restore loses nothing. **Gap:**
  `restore` **ignores the return value** of `snapshot('pre-risk')` at `:248` — if that
  safety-snapshot write fails (e.g. disk full, where it returns `null`), `applyRestored`
  at `:249` still runs. Narrow (the on-disk pre-restore file survives; only the
  unsnapshotted in-memory delta is at risk) but it violates fail-closed: the destructive
  apply should be gated on the safety copy actually succeeding.
- **Write atomicity — safe.** Every bundle is written via `writeFileAtomicSync` = unique
  same-dir temp + `rename` (`atomic-file.ts`), called at `snapshot-store.ts:223`, wrapped in
  try/catch that returns `null` on failure. No truncate-in-place; a crash mid-write leaves
  the prior snapshot and the source project intact.
- **Rotation correctness — correct.** `keepIds` budgets pre-risk and boot/cadence
  independently; keeps exactly N (test asserts 48 survive of 60, not 47); pre-risk kept on
  its own budget immune to cadence churn; `rotate()` only deletes ids the policy excludes,
  so a kept snapshot is never at risk; `rmSync(..., {force:true})` tolerates concurrent
  deletion.

**Must-fix before merge:** none *strictly* blocking, but strongly recommended:
- `snapshot-store.ts:248` — `restore` should **abort** (return `null` + surface an error) if
  `snapshot('pre-risk')` returns `null`, rather than overwriting live state with no safety
  copy.

**Notable risks:**
- **Sync IO on the main thread (non-negotiable tension).** `snapshot()` uses **synchronous**
  `writeFileAtomicSync` (`:223`) + `gzipSync`, plus sync `readdirSync`/`rmSync` in `rotate()`
  and `readFileSync`+`gunzipSync`+double `JSON.stringify` for cadence content-hash gating.
  The cadence timer fires every 30 min on the main thread, and pre-risk runs before every
  bulk `setProject`/`loadProject`. On a large project+libraries this is a multi-ms
  synchronous gzip stall on the same thread as the engine/output loop — the autosaver went
  async for exactly this reason, and an async `writeFileAtomic` (extended to accept
  `Uint8Array` in this very PR, `atomic-file.ts`) exists but is unused by the store.
  AGENTS.md: "Never block the render loop with sync IO." Borderline (periodic, not
  per-frame) but real.
- **Restore validates path AFTER reading it (ordering nit).** `read(id)` (existsSync +
  readFileSync + gunzip on `join(dir, id + '.json.gz')`) runs at `:244` **before**
  `parseStem(id)` validates the id at `:246`. `id` is a client-controllable `z.string()`.
  A crafted `../…` id causes a filesystem read outside the backups dir. **Not exploitable**
  for state injection (parseStem requires an all-numeric prefix before the first dash, which
  any traversal breaks → `null` → nothing applied) and the read result is never returned to
  the client, and it is editor-gated — but validation should precede filesystem access.
- **Off-site leak — low.** Bundles ship the whole project+libraries to the user's own R2 via
  bearer token; controller credentials are stored as a Base64URL-SHA256 hash, never
  plaintext (`project-schema.ts`), so no plaintext secret leaves the machine. Push is
  env-gated (only when telemetry endpoint+token present), fire-and-forget with a disk-backed
  queue, and a throwing hand-off never fails the local snapshot (`snapshot-store.ts:229-234`,
  tested). Worker validates `machine`/`key` against separators/dot-dot/control chars and
  bounds reads to the `backups/` prefix.

**Stacking / merge-order note (verified):** **#138 hard-depends on #137 and must merge
after it.** `main.ts:48-51` imports `createShipQueue`, `createHttpTransport`,
`createReporter`, `isTelemetryEnabled` from `./telemetry/*`, and the off-site push reuses
#137's `LEDRUMS_TELEMETRY_*` env wiring (swapping `/ingest`→`/backups`). None of
`apps/server/src/telemetry/*` exists on `main`. **If #138 merges before #137 the server
will not compile.**

**Non-negotiable violations:**
- **Sync IO can block the render loop** (`snapshot-store.ts:223` sync write + sync
  rotate/read on the 30-min cadence timer and the pre-risk-before-bulk-op path). Real but
  borderline; switch cadence/pre-risk to the async `writeFileAtomic` or move gzip off-thread.
- `packages/core` purity: **OK.** All backups IO lives in `apps/server/src/backups/*`
  (node:fs/zlib) + `workers/*`; `packages/protocol` adds only pure types/schema; core does
  not import it.

**Manual test plan:**
1. **Round-trip:** `pnpm dev`, create a project with a couple of drums/songs, wait for the
   boot snapshot, open the Backups dialog (History icon in the TopBar). Expected: a "Session
   start" row. Change the kit / paste a bulk re-rig (`setProject`). Expected: a new "Before a
   big change" (pre-risk) row appears **before** the change takes effect. *Failure:* no
   pre-risk row, or its captured state already reflects the change.
2. **Restore is safe:** note the current project name; restore the boot snapshot via the
   confirm dialog. Expected: project/shows/songs revert and every connected screen reloads;
   re-open the dialog → a fresh pre-risk snapshot of the **pre-restore** state now exists
   (undo path). *Failure:* no pre-restore snapshot, or unsaved work vanished with no recovery row.
3. **Corrupt-bundle safety:** with the app running, overwrite one file in
   `apps/server/projects/backups/<id>.json.gz` with garbage
   (`printf 'not gzip' > <path>`), then restore it. Expected: a user-visible "Unknown
   backup"/error, **project unchanged, no crash, socket alive**. *Failure:* a server
   exception kills the connection, or state gets clobbered.
4. **Crash-mid-write atomicity:** `kill -9` the server during a cadence write; on restart the
   boot snapshot loads and `list()` shows prior snapshots intact (at worst a leftover
   `*.tmp`). *Failure:* a truncated `.json.gz` that `read()` returns `null` for.
5. **Rotation keeps the right N:** temporarily lower `retention.recent`, generate more than N
   distinct-content cadence snapshots (edit + wait/trigger), then `readdir
   apps/server/projects/backups`. Expected: exactly N `.json.gz` for cadence plus up to the
   pre-risk budget. *Failure:* N-1 kept, or a pre-risk file deleted by cadence churn.
6. **Off-site opt-in / fail-quiet:** run with telemetry env **unset** → snapshots still
   appear locally, `backups-outbox.jsonl` is absent, no network calls, no errors. Then set
   `LEDRUMS_TELEMETRY=on` + endpoint/token and trigger a snapshot → outbox grows and a POST
   hits `/backups`; kill the endpoint and confirm the local snapshot still succeeds.
   *Failure:* a shipping error surfaces as a failed local snapshot, or off-site fires with
   telemetry disabled.

---

## PR #117 — gen3 UX remediation, final wave (+ CI hardening)

**Merge-safety score: 1/5.** GitHub-confirmed `CONFLICTING`; `git merge-tree` produces 8
real content conflicts, the branch is **114 commits behind main** (merge-base `a652f302`,
main at `c280c12`), and the semantic risk exceeds the textual conflicts. It cannot merge
as-is. (CI is green **on the stale branch tip**, which says nothing about mergeability.)

**Conflict / superseded surface (git-measured):** `git merge-tree` emits `CONFLICT
(content)` in exactly these 8 files:
`apps/desktop/package.json`, `apps/desktop/src-tauri/Cargo.lock`,
`apps/desktop/src-tauri/Cargo.toml`, `apps/desktop/src-tauri/tauri.conf.json`,
`apps/web/package.json`, `apps/web/src/lib/trigger-lab/controller-monitor.svelte.ts`,
`docs/design-system.html`, `package.json`. Four more auto-merge **textually but not safely**
(both sides changed them): `store.svelte.ts`, `sim.ts`,
`OutputNodeInspector.svelte`, `PlayNodeInspector.svelte`.
**The landmine is `apps/web/src/lib/trigger-lab/store.svelte.ts`:** the branch *shrinks* it
(3877→3517, extracting controllers) while main *grew* it (→3941) with overlapping churn — a
clean textual auto-merge here will silently drop main's new code or leave dangling
references to the extracted controllers.

**Still-applicable value:**
- **CI hardening — alive and independently valuable.** `.github/workflows/ci.yml` was **not**
  touched on main since the merge-base; the diff adds a `concurrency` group with
  `cancel-in-progress` + `timeout-minutes` (10 checks / 20 desktop). Clean cherry-pick, no
  rebase needed.
- **R19 (plan output prune) — likely still applies.** `packages/core/src/voice/render-plan.ts`
  (+ test) was not changed on main (main churned neighbouring `compositor.ts`/`scope.ts`),
  so it is probably rebaseable — re-verify against main's voice-module changes for drift, and
  re-check purity/determinism per AGENTS.md on reslice.
- **R22–R24 (store split) — wanted intent, dead base.** The extracted controllers
  (`controller-test.svelte.ts`, `shows-controller.svelte.ts`, `sections-controller.svelte.ts`)
  are absent on main, so main never did this split; but they were carved out of the very
  `store.svelte.ts` main has since rewritten. The extraction must be **re-derived against
  current main**, not merged.
- **Dead/superseded:** lockfile/manifest/Cargo/Tauri conflicts are pure staleness artifacts
  from the desktop/OTA work that landed on main — take main's versions, salvage nothing from
  the branch side. `docs/design-system.html` is generated — regenerate, don't hand-resolve.

**Recommendation: close-and-reslice, with a CI cherry-pick escape hatch.** A 114-behind
branch whose central deliverable targets a file main has since rewritten is not worth a
rebase (the R22–R24 extraction must be re-derived against today's `store.svelte.ts`
regardless, at which point the rebase saves nothing). Concretely: (1) cherry-pick the
`ci.yml` concurrency+timeout hardening as its own tiny PR now; (2) open fresh current-main
slices for R19 and R22–R24; (3) close #117. Do **not** attempt merge-as-is or trust the
auto-merged `store.svelte.ts`.

**Must-fix / blockers:** the 8 content conflicts above (take main's for
lockfiles/manifests/Cargo/Tauri; reconcile `controller-monitor.svelte.ts`; regenerate
`design-system.html`) plus the `store.svelte.ts` semantic-merge hazard.

**Manual test plan:** N/A pending rebase/reslice. If CI hardening is cherry-picked
standalone: push two commits in quick succession to one PR ref and confirm the earlier run
is cancelled (`cancel-in-progress`), and that `checks`/`desktop` still pass within the new
10/20-minute `timeout-minutes` caps.

---

## PR #124 — docs slice pack (observability + backups)

**Merge-safety score: 5/5 (docs-only).** Nine files, all documentation: the
`docs/plans/2026-07-13-obs-backups/*` slice specs (B1–B3, E1–E4, INDEX) plus a 6-line
`.mex/ROUTER.md` update. No code, no build/test impact, `MERGEABLE / CLEAN`. Merge anytime;
independent of every other PR. Only nit: it documents the #122/#123 work, so it reads most
coherently landed alongside or after #137/#138 — but nothing blocks landing it first.

---

## Cross-PR interaction summary
- **#137 → #138 stacking is a hard compile dependency**, not a preference: #138 imports
  #137's `telemetry/*` modules (`main.ts:48-51`). Merge #137 first.
- **#140 / #136 / #137 share edited files** — #140∩#136: `GraphCanvas.svelte`;
  #140∩#137: server `main.ts` + `client-message.test.ts`; #136∩#137: only `docs/prompts/*`.
  I ran `git merge-tree` on the code-bearing pairs: **0 conflict markers** — they auto-merge
  textually clean. But the **second PR to land among these three must re-run `pnpm typecheck`
  + `pnpm test`** before pushing, because two features adding handlers/test-cases to the same
  files can merge textually yet break semantically.
- **#117 is isolated in its staleness** — it conflicts with main, not with the other PRs;
  resolving it is orthogonal to landing #137/#138/#140/#136/#124.

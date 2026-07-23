# PR merge-safety review — adversarial pass (stage 2 of 2)

Adversarial review of the stage-1 report (`2026-07-20-pr-merge-safety-opus.md`) and an
independent defect hunt over the same six PRs. Method: one independent reviewer per
substantive PR (each re-derived evidence from the branch tip via `git show`, read-only;
#136's reviewer additionally read the pinned xyflow library source), plus my own re-runs of
the git-measurable claims (#117 conflicts, cross-PR merge-trees, #124 file list). "Report
line N" cites the stage-1 report.

## Verdict at a glance (stage 1 → stage 2)

| PR | Stage 1 | Stage 2 | Why it moved |
|---|---|---|---|
| #140 static outputs | 4/5 | **3/5** | Undo across the expanded toggle re-creates and **persists** the exact output-count drift the PR exists to kill (new, must-address); the id-collision is a *stuck* state, not a one-time blemish. |
| #136 reconnect handles | 4/5 | **4/5 (rationale corrected)** | Stage 1's headline "stuck-invisible dots" risk is **refuted in library source**; the real point-off is the unmet `pnpm ui-shot` non-negotiable + zero automated coverage. |
| #137 observability | 5/5 | **4/5** | Worker-absent safety **survives the hardest attack** — but the documented dedup-collapse is **unwired in prod** (`keyOf` omitted) and the seam is untested; web payload is uncapped before the wire. |
| #138 backups | 4/5 | **3.5/5** | The pre-risk fail-open is at **three** seams (not one) and the `void` signature makes callers unable to gate; no `fsync` (not power-loss durable); off-site silently wedges for large projects. **Merge blocked on the one-line fail-closed fix.** |
| #117 final wave | 1/5 | **1/5 (confirmed)** | I re-ran the git measurements: 8 content conflicts, 114 behind, ci.yml/render-plan.ts untouched on main, store.svelte.ts churned on both sides. Close-and-reslice stands. |
| #124 docs pack | 5/5 | **5/5 (confirmed)** | Re-verified: 9 files, all docs (8 plan docs + `.mex/ROUTER.md`). No code. |

**Revised merge order:** unchanged in sequence (#137 → #138 → #140/#136 → #124; close #117),
but with new gates: **#138 must not merge until its C1 fail-closed fix lands**, **#140 should
not merge until the undo/resync gap (N1) is addressed**, and #136 needs its `pnpm ui-shot`
run. #137 is mergeable as-is; fix its C1 before *enabling* telemetry.

New-finding count: **#140: 4, #136: 4 (all low/cosmetic), #137: 5, #138: 6** (severities below).

---

## PR #140 — patch-graph static outputs

### Verdict on stage 1's 4/5: revise to 3/5

The mechanism is sound, `packages/core` stays pure (verified: `reconcileOutputs` has no
IO/RNG, identity-returns at count), and the DMX byte-stream is unaffected. But two
persistent-drift defects defeat the headline "self-heals to 8" guarantee, both reachable by
routine gestures, neither covered by any test, and the stage-1 manual plan would not catch
either.

### Report defects

- **Report line 78–80 ("undo resync… pre-existing behavior, not introduced here") — wrong
  framing.** Before this PR, `expanded` didn't drive `kit.outputs`, so the resync gap was
  inert. This PR makes `expanded` the sole driver of the count while leaving
  `projectResyncMessages` blind to it — the PR *activates* the drift. Promoted to N1.
- **Report line 69–70 ("7 nodes with one wired output silently missing") — detail wrong.**
  The dedup in `buildOutputHalf` keeps the **first** occurrence, which is the earlier wired
  survivor; the dropped node is always the appended **empty** port. No wired output is ever
  lost. The stage-1 failure text would send a tester hunting for missing wiring that isn't
  there.
- **Report line 53 ("mutation-parity is enforced across all three write paths") — incomplete.**
  True for the `expanded`-flip mutation, but the guarded invariant
  (`outputs.length === logicalOutputCount`) has a **fourth mutator — `setKitOutputs` — that
  never reconciles** (`voice-engine-host.ts:248-252`, raw assignment; server gate
  `validateRouting` checks routing legality, not count). N1 exploits exactly this.
- Line cites ±2 off in places (e.g. engine reconcile is at `engine.ts:321-322`); immaterial.

### New code findings

- **N1 (Medium-High, must-address): undo across an expanded toggle silently re-creates
  output-count drift and persists it.** Trace: toggle Expanded ON (4→8, undo snapshot holds
  `{expanded:false, 4 outputs}`) → Cmd-Z → `projectResyncMessages`
  (`apps/web/src/lib/trigger-lab/store/project-resync.ts:61-65`) compares only
  `global.mirror`, so **no `setKitGlobal` is emitted**; it emits only
  `setKitOutputs{4 outputs}` → server applies via `voice-engine-host.ts:249`
  (`this.kit.outputs = outputs`, no reconcile) with `expanded` still `true` → live state is
  `{expanded:true, length:4}` — the exact drift class the PR targets — broadcast and
  **autosaved to disk**. UI shows Expanded ON with 4 nodes. On next boot, load-time
  reconcile grows the file to 8/expanded, **silently discarding the user's undo**. Fix:
  resync `expanded` alongside `mirror` in `projectResyncMessages` (emit before
  `setKitOutputs`), plus defense-in-depth: server `setKitOutputs` path reconciles/clamps to
  `logicalOutputCount`.
- **N2 (Medium): the id-collision grow is a *stuck* state, not one-time.** Survivors
  `output:1,2,8` grow 3→8 minting duplicate `output:8`; `length` now equals target so the
  identity guard (`kit-schema.ts:520`) means **no reload ever re-heals**; re-wiring from the
  7-node graph emits 7 outputs → next boot re-collides → pinned at 7 usable ports in
  expanded mode indefinitely. A milder recurrence of the stuck-count symptom the PR
  advertises as fixed. Fix: mint appended ids past `max(existing numeric suffix)` (or filter
  against survivor ids), or add a duplicate-output-id class to `checkRoutingIntegrity`
  (currently checks drum/hoop claims only; output id schema is `z.string().min(1)` with no
  uniqueness anywhere).
- **N3 (Low-Medium): `setKitOutputs` is an unreconciled 4th mutator** of the count invariant
  — beyond the undo exploit, any future caller with a non-canonical length drifts the live
  kit until reload. The invariant rests on UI discipline, not the authoritative seam.
- **N4 (Low): silent shrink can discard wired outputs.** `current.slice(0, target)`
  (`kit-schema.ts:523-524`) on a `{expanded:false}` file carrying >4 outputs trims outputs
  5+ and their wiring **with no log**; positional keep means empties can survive while wired
  ports drop (arrivable via `setKitOutputs` ordering). Add a log/Monitor line when a
  **wired** output is trimmed.

### Test-plan patches

- **Replace step 4** with two cases: **4a benign heal** — corrupt survivors `output:1,2,3`,
  expect exactly 8 nodes, no duplicate id. **4b collision (forces N2)** — corrupt survivors
  `output:1,2,8`; current behavior: **7** nodes, two `output:8` entries in the file, count
  stuck at 7 across reload and rewire round-trip; the missing node is an *unwired* appended
  port (correcting report line 69).
- **Augment step 5**: 5a all-empty kit → flat fallback lights the rig; **5b (new)** partially
  wired kit → only the wired drum lights, no flat fallback (covers the other arm of
  `hasWiredOutput`).
- **New step 6 (catches N1)**: from normal (4 nodes) toggle Expanded ON (8 nodes), press
  Cmd-Z. Expected: back to 4 nodes **and** inspector reads Expanded OFF; reload → file still
  `{expanded:false, 4 outputs}`. Current failure: inspector ON with 4 nodes; restart grows
  the file back to 8/expanded.
- **New step 7 (catches N4)**: boot a legacy `{expanded:false}` file with 6 wired outputs.
  Expected: heals to 4 keeping the wired ports, with a log line noting the trim. Failure:
  wired routing silently vanishes.

---

## PR #136 — reconnect-handle polish

### Verdict on stage 1's 4/5: agree with the score, reject the rationale

The point-off is right; the reason stage 1 gave is not. The code is sound and safe to merge
once `pnpm ui-shot` is actually run.

### Report defects

- **Report lines 118–124 (shared `bind:reconnecting` can latch true on cancel → dots
  invisible forever, "the thing to test hardest") — REFUTED in library source.** At the
  pinned versions (`@xyflow/svelte@1.6.0`, `@xyflow/system@0.0.77`):
  `EdgeReconnectAnchor.svelte` sets `reconnecting=true` only after the drag threshold, and
  `@xyflow/system` `index.js:2505-2528` routes **every** drag termination (valid drop,
  empty-canvas drop, off-handle release) through the single `onPointerUp`, which calls
  `onReconnectEnd` whenever a connection started — set-true and set-false are perfectly
  paired; there is no Escape/keydown cancel path to escape it. The shared binding is correct
  by construction (one anchor drags at a time; the setter resets it). Downgrade from
  "genuinely fragile" to "safe under pinned xyflow, verified in source."
- **Report lines 125–127 (`anchorHover` enter/leave ordering) — confirmed but effectively
  unreachable**: the two anchors sit ~30px inboard from *opposite* ends
  (`ANCHOR_INSET=30`), so a direct dot→dot move crosses non-anchor territory anyway.
- **Report lines 128–132 (bezier-regex fallback) — confirmed, and the fallback is dead code
  today**: `getBezierPath` always emits `M… C…` (no straight-line branch); the regex
  captures all 8 groups against that literal format. Inert defensive assumption.
- **"No path corrupts edge data" — confirmed** (only `onreconnect` is wired; the PR reads
  `selected` and toggles three local display flags). Styleguide + regenerated
  `design-system.html` confirmed consistent (new `<li>` text present once in the bundle;
  diff churn matches a real `pnpm design-system` rebuild). Tokens/no-motion/grey-wires all
  confirmed.

### New code findings (all low/cosmetic, none blocking)

- **Multi-touch strands `reconnecting=true` (negligible, library-level):**
  `onPointerUp` early-returns while other touches are down; dots hide until all fingers
  lift. Self-heals.
- **`anchorHover` can lag true after a drag (cosmetic):** pointer capture moves to
  `document` during the drag, so `pointerleave` may not fire; dots linger until the next
  pointer move. Self-heals.
- **Regex omits `+` exponents (unreachable):** `[-\d.e]+` at `WireEdge.svelte:49`; widen to
  `[-+\d.eE]` if ever hardened.
- **Short-wire anchor overlap (cosmetic):** both insets cap at 45% of curve param, so the
  two dots can nearly coincide on tiny wires.

Explicitly checked and cleared: the `class` array reaches the same `<path>` as
`svelte-flow__edge-path` (compound selector matches — feature is live); pointer events
propagate to the anchor div (hover genuinely toggles); no stale `.reconnect-dot` rules
survive; anchor hit geometry unchanged (no hit-target regression).

### Test-plan patches

- **Fix step 2:** require a **visible >10px drag** into empty canvas before release (a
  sub-pixel "grab and drop" never crosses `dragThreshold=1`, so the cancel path is never
  exercised and the step passes vacuously); also assert the wire is not deleted.
- **Fix step 3:** at rest the dot is `display:none` — tell the tester to approach the
  **invisible ~25px grab zone** ~30px inboard from the node without hovering the wire body
  first; expect the dot to appear+enlarge and the owning wire to light accent.
- **Fix step 4:** name a **type-compatible input handle** as the drop target (incompatible
  drops silently no-op and read as bugs); assert exactly one new edge and no wire left
  permanently dimmed at 0.35 opacity.
- **Add step 6 (untested `selected` path):** click a wire to select → dots appear and stay
  with cursor off the wire; deselect → dots vanish.
- **Add step 7 (per-instance state):** with two crossing wires, hover only A → only A's dots
  appear; B stays grey (no shared-state bleed).
- **Elevate step 5 (ui-shot) to a hard merge-blocker** — it is the AGENTS.md non-negotiable
  and the actual reason this PR isn't 5/5. Note: every step here is manual; nothing pins the
  reveal/hide state machine in an automated test, so future refactors can silently regress
  it.

---

## PR #137 — observability

### Verdict on stage 1's 5/5: revise to 4/5

The core mandate — safe with the Worker absent — **holds under the hardest attack**, and
every claim in stage 1's "Worker-absent safety" section verified independently (fail-quiet
transport + backoff, never-throwing `observe`, re-entry-locked web sink, closed-socket
no-op sends, unref'd timers, caps enforced on load *and* append at `ship-queue.ts:190/204`,
`persistSync` try/caught so it can't mask the exit). But a perfect score doesn't survive:

### Report defects

- **Report lines 162, 168–175 ("double env-gated") — mischaracterizes the gating.** Capture
  and web→server forwarding are **ungated**: `installErrorCapture` installs unconditionally
  (`store.svelte.ts:908`), and the server re-emits `webError` to the Monitor bus with no
  telemetry check. Only *shipping* is gated (reporter creation: `isTelemetryEnabled` AND
  `endpoint && token`). Safety conclusion unaffected — nothing leaves the machine — but the
  "two gates protect capture" mental model is wrong, and the manual plan never checks that
  webError frames still flow with telemetry unset.
- **Report lines 163–164 ("thorough hermetic unit tests") — overclaims.** The
  reporter↔ship-queue seam is untested: `reporter.test.ts:71-72` uses a fake array-push
  queue (asserts length 2 for a repeated error — collapse is *delegated* to the queue), and
  every ship-queue upsert test passes `keyOf` explicitly — exactly the argument prod omits.
- **Report line 180–181 ("collapses to ONE queued entry") — false in prod.** See C1.

### New code findings

- **C1 (Medium): production queue omits `keyOf`; the documented dedup-collapse never
  happens.** `main.ts:272-275` constructs the queue with only `{path, transport}`;
  `keyFor` falls back to `String(seq++)` → append-only. A render-loop error at 120×/s
  enqueues 120 copies/s; the queue thrashes at the 200-item/2MB caps via drop-oldest and
  rewrites a ~1–2MB JSONL every second indefinitely with the Worker absent; when it ships,
  batches carry up to 200 near-identical reports instead of 1. Bounded and fail-safe (not a
  Worker-absent hole) but defeats a load-bearing design claim. Fix:
  `keyOf: (r) => r.dedupKey` at `main.ts:272` + a reporter-over-real-queue test asserting
  `size()===1` after N repeats.
- **C2 (Low-Medium): web side forwards uncapped message/stack.** `error-capture.ts:54-56,
  86-98` builds an uncapped `message` (console args joined); the 1000/8000 caps are
  server-side, *after* the WS frame. `console.error(hugeString)` repeatedly → multi-MB
  frames and unbounded browser send-buffer growth. (Objects are cheap — `String(value)` →
  `"[object Object]"`; large *strings* are the exposure.) Fix: mirror the caps in
  `error-capture.ts` before `sink()`.
- **C3 (Low, latent): no loop-breaker on the browser↔server echo path.** `inSink` blocks
  only synchronous re-entry; `window.onerror`/`unhandledrejection` arrive on later ticks.
  Captured error → `webError` → Monitor broadcast to all clients → `store.addMonitor` →
  panel re-render; if that path ever `console.error`s or throws, a self-sustaining
  cross-network amplification starts. Verified **not live today** (addMonitor doesn't
  console.error) but there is no architectural breaker or web-side rate limit.
- **C4 (Low, fail-safe): one corrupt JSONL line on boot discards the entire queue** (outer
  catch → start empty), not just the bad line.
- **C5 (Informational): `onUncaught` calls `monitor()` unwrapped before the try-wrapped
  `onFatal`** — fragile ordering, but the `process.on('exit')` persistSync registration
  saves the crash report regardless.

Non-negotiables clean: core untouched, all IO in apps/, transport/clock injected,
`sourcemap: 'hidden'` correct.

### Test-plan patches

- **Step 2:** add — fire the same error ≥300× rapidly; `error-reports.jsonl` must contain
  ~1 logical report with a high `count`, not hundreds of lines sharing one `dedupKey`
  (this is the only step shape that detects C1; the existing cap assertion passes with the
  bug present). Also observe that the file reaches a steady state rather than being fully
  rewritten every second.
- **Step 3:** assert the stub receives **one report with `count===N`** after N repeats, not
  N reports.
- **New step 6 (C2):** devtools `console.error('X'.repeat(10_000_000))` repeatedly →
  FPS unaffected, server Monitor shows ~1000-char truncated message, tab memory stable.
- **New step 7 (C3):** a `setInterval` console.error with the Monitor panel open →
  outbound `webError` rate tracks the source 1:1 (no amplification).
- **Step 5:** bound it — exit non-zero within N seconds, and assert
  `error-reports.jsonl` contains the crash report **before** restart (proves the fatal-path
  persistSync ran).
- **Step 1:** add — with telemetry unset, `console.error('probe2')` still reaches the
  **server** Monitor (documents that safety comes from reporter non-creation, not capture
  being off), while no POST and no jsonl occur.

---

## PR #138 — backups

### Verdict on stage 1's 4/5: revise to 3.5/5 — merge gated on the C1 fix

Stage 1's structural read is sound (rotation correct — the keep-set is a *union*, erring
toward retention, no off-by-one; traversal unexploitable — a `parseStem`-valid id cannot
contain a separator; corrupt-bundle safe; editor-gated; #137 hard-dependency stands). It
also **undersold a real strength**: restore is fully synchronous end-to-end (read →
pre-risk → applyRestored → broadcast, no `await`), so cadence/autosave can never observe
mid-restore state and two concurrent restores are impossible in the shipped config.

### Report defects

- **Report lines 252–256/268 (fail-open gap "at :248") — confirmed but UNDER-SCOPED.** The
  same fail-open exists at **three** seams: `restore()` in `snapshot-store.ts`,
  `client-message.ts:418` (`snapshotPreRisk()` then `setProject`), and `projects.ts:35`
  (before `loadProject` apply). Worse, the contract is **`snapshotPreRisk(): void`**
  (`client-message.ts:625-627` discards the meta) — even a fixed `restore` leaves the two
  bulk-apply seams structurally unable to observe failure. This is a
  fail-closed + mutation-parity violation across every risky-op path, not a narrow nit.
- **Report lines 257–260 ("write atomicity — safe") — overstated.** `atomic-file.ts` does
  write→rename with **no `fsync`** on the temp fd or parent dir. Safe against `kill -9`
  and concurrent readers; **not crash-consistent across power loss** — the rename can be
  durably recorded while data blocks aren't, yielding an existing-but-truncated `.json.gz`
  (→ `read()` null, snapshot silently gone). Blast radius: newest snapshot only.
- **Report lines 291–296 (off-site "low… bounded") — missed a silent wedge.** See C4.

### New code findings

- **C1 (Medium-High, MERGE BLOCKER): pre-risk safety net is fail-open at all three risky-op
  seams.** Scenario: `projects/backups/` read-only or ENOSPC while `projects/` is writable
  → `snapshot('pre-risk')` returns null (logged only) → `applyRestored`/`setProject`
  proceeds → autosave persists the new state over the on-disk file → pre-restore state
  (including unsaved authoring) is gone with **no recovery snapshot** and no prominent
  warning. Fix (one line + signature): in `restore`,
  `const pre = snapshot('pre-risk'); if (!pre) return null;` (safe: pre-risk never
  self-gates, so null always means write failure), and make `snapshotPreRisk` return the
  meta so `setProject`/`loadProject` can refuse instead of proceeding unprotected.
- **C2 (Medium): sync gzip/CPU on the cadence timer blocks the render/output loop — and the
  content-hash gate pays the full cost even when it skips.** Every 30-min tick, even idle:
  `readdirSync` + `readFileSync` + `gunzipSync` + `JSON.parse` of the whole prior bundle +
  **two full `JSON.stringify`** of project+libraries — before deciding to do nothing. On
  change, add `gzipSync` + sync write + rotate. Multi-ms-to-tens-of-ms stall on the engine/
  Art-Net thread — a frame hitch mid-show. The fix is **not** just the async
  `writeFileAtomic` (wired for `Uint8Array` in this PR but unused): the dominant cost is
  gzip/stringify CPU → needs async `zlib.gzip`/worker + a cheap stored digest instead of
  re-gunzip-and-double-stringify. (Pre-risk-before-bulk-op is rare and user-initiated —
  genuinely borderline; the cadence timer is the firm violation.)
- **C3 (Low-Medium): no `fsync` — backups are not power-loss durable** (detail above). For
  a disaster-recovery feature, fsync temp fd before rename + parent dir after, or document
  best-effort.
- **C4 (Medium, off-site only, silent): shipping wedges for large projects.** `doShip`
  batches the **entire** queue into one POST; the Worker caps `/backups` bodies at 16MB;
  bundles ship as **uncompressed JSON**. (a) A backlog batch >16MB → 413 → throw → batch
  retained → retries the identical oversized batch forever at the 30-min backoff ceiling;
  newer snapshots drop-oldest behind it. (b) A single bundle >`maxBytes` 8MB is dropped by
  `enforceCaps` **on enqueue** and never ships. Net: off-site DR silently stops for exactly
  the large projects that most need it (local cap 8MB is *below* the Worker's 16MB). Fix:
  per-item flush cap, gzip the bundle for the wire, align caps. Local snapshots unaffected.
- **C5 (Low, latent): `SnapshotBundle.version` is stamped but never read** on
  `read()`/`restore()` — add the envelope-version guard before a v2 ever exists.
- **C6 (verified, no finding): Worker trust boundary is solid** (`safeKeySegment` rejects
  separators/dot-dot/control chars on machine+key; prefix-scoped list; bearer on every
  route). R2 90-day retention is a manual bucket rule — operational cost risk only.

Config note: `preRiskBudget: 0` would rotate the safety snapshot away *before*
`applyRestored`; not reachable in shipped config (default 20, no override at `main.ts:557`).

### Test-plan patches

- **Step 2:** add the C1 probe — `chmod 000 apps/server/projects/backups` (restore perms
  after), then restore. Expected (post-fix): restore **refused** with a visible error, live
  state untouched. Current: restore proceeds and no pre-risk row exists — the data-loss
  path. As written, step 2 cannot fail on C1.
- **Step 3:** add the decodable-but-invalid case — gzip valid JSON that is not a valid
  Project, restore it. Expected: pre-risk taken, `parseProject` throws, WS handler catches,
  error reaches the client, socket alive, live state untouched (the path step 3 currently
  skips).
- **Step 4:** correct the claim — `kill -9` does not drop the page cache, so it proves
  rename atomicity only and will always pass; it does **not** exercise power-loss
  durability. Relabel, and note crash-consistency is unguaranteed without fsync (or fault-
  inject / hard-reset a VM if genuinely testing C3).
- **Step 6:** add a large-project run — a several-MB bundle must actually POST successfully
  and `backups-outbox.jsonl` must **drain**, and `grep` the server log for
  `ship failed`/drops (the current small-project run always fits and hides C4).
- **New step 7:** >20 restores/pastes in a session → exactly the newest 20 pre-risk rows
  survive, never evicted by cadence churn (exercises rotation live and guards the C1 fix
  against un-rotated pile-up).

---

## PR #117 — gen3 final wave

**Agree: 1/5.** Independently re-measured: `git merge-tree` emits exactly the 8 content
conflicts stage 1 lists; the branch is 114 commits behind main; `ci.yml` and
`packages/core/src/voice/render-plan.ts` are untouched on main since the merge-base
(cherry-pick/reslice viable as stage 1 says); `store.svelte.ts` is 3941 lines on main vs
3517 on the branch with overlapping churn — the semantic-merge hazard is real.
Close-and-reslice with the CI cherry-pick stands. No report defects found.

## PR #124 — docs slice pack

**Agree: 5/5.** Independently re-verified: 9 files, all documentation
(`docs/plans/2026-07-13-obs-backups/*` ×8 + `.mex/ROUTER.md`), 352 insertions, no code.
Merge anytime.

## Cross-PR claims

Re-ran the three code-bearing `git merge-tree` pairs among #140/#136/#137: **0 conflicts**,
and the shared-file lists match stage 1 exactly (`GraphCanvas.svelte`;
`main.ts` + `client-message.test.ts`). The second-lander re-run rule stands. The #138→#137
compile dependency re-confirmed by #138's reviewer (`main.ts:48-53` imports
`./telemetry/*`, absent on main).

---

## Stage-2 bottom line

1. **#137** — merge as-is (4/5); fix `keyOf` (one line + one test) before enabling telemetry.
2. **#138** — **hold** for the one-line C1 fail-closed fix (+ signature), then merge after
   #137; track C2 (cadence sync CPU) and C4 (off-site wedge) as required follow-ups.
3. **#140** — **hold** for N1 (resync `expanded`, ~3 lines) and preferably N2 (collision-
   proof id minting); then merge.
4. **#136** — run `pnpm ui-shot` (the actual gate), then merge. The stage-1 "stuck dots"
   scare is refuted; test the cancel path per the corrected step 2 anyway.
5. **#124** — merge anytime. **#117** — close-and-reslice; cherry-pick the CI hardening.

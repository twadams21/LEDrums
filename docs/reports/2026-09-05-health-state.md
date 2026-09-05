# P01 + P10 — document state health

Branch: `fix/health-document-state`. Source: user approval to implement all follow-ups without further questions, 2026-09-05. Integrating-agent defaults (not separately stated user decisions): clear Undo on replacement, document-ID guard, 32 MiB estimated history budget with a 10,000-entry ceiling. No sim/render/core edits, release operations, global context or design artifact changes. Integrated ui-shot belongs to the orchestrator.

## P01 evidence

`pnpm install --frozen-lockfile` passed (lockfile unchanged).

Targeted red: `cd apps/web && pnpm exec vitest run src/lib/trigger-lab/store.document-state.test.ts` — **9 failed** against the original implementation: every transition permitted old Undo, including same-ID server adoption, plus direct identity mismatch.

After repair: document-state + shows + server-library tests — **41 passed**. Web-only `pnpm --filter @ledrums/web typecheck` passed (0 errors, 0 warnings). Added connected equal-content Save As → setShow/recall/transport coverage, position-only edit suppression, and history/runtime preservation for save/rename/inactive delete/no-op open. The replacement test matrix exercises New, Open, Save As, delete-active, delete-last, Close, server cold adoption and viewer follow. Each arms a looping voice, pending delay, advanced sequence, live input tables and an unfinished edit gesture. After replacement there is no old Undo, no delayed/looping voice after 500 ms, sequence restarts at step 1, input tables empty, new buses are bound by identity, and new edits can Undo normally.

| Before | After |
| --- | --- |
| `shows-controller.svelte.ts`: New, Save As and delete-last bypassed the show-load hook. | All replacements pass through `activateDocument` → store `replaceDocument`; ordinary saves/renames/inactive deletion retain their lifetime. |
| `store.svelte.ts`: show-load only cleared delays; voices, sequence/PRNG/latches and registries survived. | Instantiate existing `Sim` with current resolved registries, buses, model and tempo; clear transient editor targets, learn arms, gesture suppression and visible local runtime state. No Sim contract change required. |
| Undo had no document identity and survived replacement. | Clear on replacement (including same-ID server adoption), additionally reject a foreign document ID at replay. |
| Equal-content Save As could be signature-suppressed by connected playback. | Replacement invalidates engine sync baseline and sends the replacement/recall and transport through existing interfaces. |

Visual design preserved: no markup, styles, tokens or components changed. Reviewed existing `SaveIndicator.svelte` against make-interfaces-feel-better and Impeccable product guidance: fixed-width status slot, interruptible crossfade and reduced-motion contract remain unchanged. The requested local `.agents/skills/impeccable` path was absent; loaded the existing sibling checkout's `.claude/skills/impeccable` and ran its context resolver against this worktree. `PRODUCT.md` exists; `DESIGN.md` does not.

## P10 implementation

| Before | After |
| --- | --- |
| `store.svelte.ts`: `currentLibrary()` and `currentSongLibrary()` ran inside the reactive effect on every edit, before the timer. | Effects only subscribe to dirty data; the timer captures neither document. Each graph has its own deep subscription, other authored fields and the canonical pool have independent subscriptions. A node drag does not walk unrelated graphs, inactive shows or the pool. |
| `shows-controller.svelte.ts`: deep-proxied inactive library caches were cloned with the whole library, including its stale active slot. | Immutable slot/map replacement + `$state.raw` ownership; materialize the live active document once and share already-detached inactive slots. Loading a slot still detaches it before editing. |
| Connected flush rebuilt libraries again for server sends. | One envelope per library is reused by local-cache writes and server pushes. Existing first-state, viewer and signature guards remain. Engine show push still ignores position-only edits. |
| Explicit Save bypassed autosave's sync/status pipeline; unload only flushed when a timer existed. | Explicit Save shares the same flush pipeline. Unload/stop read the latest runes synchronously, even if an edit's reactive effect has not run yet. Unload/stop remain local-only; no new WebSocket delivery promise. |
| Cache failures were swallowed before the indicator reported Saved. | Cache writers return success; failure cancels pending Saved transitions, returns to the existing idle presentation and uses the existing toast primitive. A later successful Save recovers. The 150 ms Saving floor, initial-mount silence and Saved hold remain. |
| History retained up to 10,000 full authored/project clones, with no byte limit. | `store/document-history.ts` owns identity, immutable structural sharing and reference-counted retention, bounded by 32 MiB estimated bytes AND 10,000 entries. Mutable source proxies are compared recursively, never trusted by identity. Restoring clones the immutable checkpoint before live edits. |
| An oversized checkpoint had no defined policy. | Drop older history rather than allowing Undo to skip over an unrecorded edit; keep the edit, show an existing-style toast explaining the 32 MiB limit, and resume normal history when checkpoints fit again. |
| Sim construction during a combined server state could precede adoption of the incoming canonical pool. | Reconcile the pool first, then replace the show/runtime, so referenced registry entries are available immediately, not eventually through an effect upsert. No Sim API changes. |

### Byte accounting and guarantees

The default is **33,554,432 estimated retained bytes**, not a promise of 32 MiB measured JS heap. Count each shared object once: 32 bytes/object or 24/array, 48/object for bookkeeping, 16/property slot, two bytes per UTF-16 key/string code unit, eight bytes per other primitive/reference, and eight per array slot. This intentionally conservative, deterministic model varies from a real engine's headers, string interning, ropes and GC. The live document, temporary traversal/restore allocations, serialized save strings and Svelte's dependency graph are outside history retention. No full-history serialization is used to enforce the budget.

Eviction removes oldest checkpoints, with shared-object references decremented on pop/eviction. Replacement releases the entire history, including the sharing/accounting index. No hidden last-checkpoint reference keeps an evicted document alive. A document bigger than the budget can still be edited/saved, but its checkpoint is an explicit Undo barrier, not a silently skipped step. The existing maximum depth is still achievable: a test pushes 10,010 small checkpoints and replays the newest **10,000** in exact reverse order.

### Red → green evidence

1. Original autosave: **2 failures / 3 passes** — 30 graph updates materialized 30 libraries before the debounce; unloading before the effect ran lost the last node position (0 instead of 999).
2. Count-only history extraction: **3 failures / 3 passes** — no structural sharing, no byte eviction, no oversized barrier. Additional tests caught and fixed two defects during implementation: object insertion-order drift and sparse-array length loss.
3. Combined server adoption: new registry-order regression failed (`remote-effect` undefined immediately after adoption), then passed after pool-first reconciliation.
4. Final targeted set covers identity/transition isolation; loop/delay/sequence/input reset; half-finished gesture cancellation; mixed graph/project Undo and gesture batching; optional-field/array deep dependencies; disposed outgoing subscriptions; canonical-pool edits; deferred counts offline/connected; pre-switch edits; unload-before-effect; explicit Save; failure/floor/recovery; signature suppression; and payload immutability across later edits.

### Measured workload

Reproducible opt-in probe:

```sh
cd apps/web
HEALTH_STATE_MEASURE=1 pnpm exec vitest run src/lib/trigger-lab/store.health-state-measure.test.ts
```

Machine: **Trent’s MacBook Pro** (`scutil --get ComputerName`), Node **v25.8.2**, pnpm **9.12.0**. Vitest/jsdom, no real RAF, fake debounce clock, real `node:perf_hooks` CPU timing. **24 shows × 40 graphs**, **2,725,634 UTF-8 bytes** in the initial library, 60 node moves in one gesture with a Svelte `flushSync()` after each, then one debounce flush and 100 independent BPM edits (101 history checkpoints total). Baseline ran at P01 before P10 edits; final run uses the committed probe. Times are one synthetic run per implementation on a shared development machine, not hardware latency or real-browser frame-rate certification.

| Measurement | Before | After |
| --- | ---: | ---: |
| Show-library materializations during 60 drag updates | 60 | **0** |
| Total materializations after the debounce flush | 60 | **1** |
| Per-update CPU p50 (mutation + reactive flush) | 991.77 ms | **0.51 ms** |
| Per-update CPU p95 | 1,213.11 ms | **0.76 ms** |
| Total CPU over 60 drag updates (includes first Undo checkpoint) | 57,755.48 ms | **82.46 ms** |
| Debounce callback CPU | 35.55 ms | **97.76 ms** |
| Retained checkpoint count | 101 | **101** |
| Same-accounting history estimate, without vs with across-entry sharing¹ | 42,490,094 bytes | **531,554 bytes (0.51 MiB)** |

¹ The before value in this row is an explicitly computed **unshared counterfactual for the final run's exact checkpoints**, using the same estimator with fresh ownership per checkpoint; it is not a GC heap measurement. The original baseline separately logged 23,072,632 bytes of UTF-16 serialized checkpoint payload (a different, lower-bound footprint). Do not equate either figure to actual retained process heap.

The callback is more expensive because snapshot work now happens **there**, not on every pointer update. Deferred work has not disappeared: serializing a multi-megabyte localStorage library is still synchronous at a save/flush boundary. The measured drag path is insulated from that work; no end-to-end rendering speedup is claimed. The canonical-pool and connected tests independently pin one materialization of **each** library per burst.

### Verification / handoff

Final commands (targeted only; no full sweep/build):

```sh
pnpm --filter @ledrums/web typecheck
cd apps/web
pnpm exec vitest run src/lib/trigger-lab/{store.document-state,store.autosave,store.shows,store.server-library,store.song-library,store.persistence,store.face-params,store.routing,store.add-node-wired,store.autowire,save-status}.test.ts src/lib/trigger-lab/store/{document-history,project-resync}.test.ts
```

Final results: **154 tests passed in 13 targeted files**; the opt-in measurement test also passed. Web typecheck: **0 errors, 0 warnings**. `git diff --check` clean. P01 commit: `fb9dbff`; P10 is the subsequent logical commit containing this report. Two incorrect test-fixture property names (`name`, then `triggerSource`) were caught by typecheck during development and corrected to the actual `GraphNode.source` field before the final green run. Integrated ui-shot remains the orchestrator's gate (affected interactions: show switching, Save As, Undo, drag autosave and existing status/toast presentation). No screenshot, browser-FPS, hardware, server-durability acknowledgement, full sweep, push/PR/merge or deployment claim. No new reusable UI primitive or design artifact was needed; existing SaveIndicator and toast design are preserved.

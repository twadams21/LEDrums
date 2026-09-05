# Health audit P05 + P07 — output lifecycle

**Status:** implemented and committed locally on `fix/health-output-lifecycle`, based on `ea18f61` (merged audit PR #202). No push, PR, merge, release, deployment, or live-controller output.

**Source/scope:** the user's approved P05/P07 follow-up request and `docs/plans/2026-09-05-codebase-health-audit.md`. Ownership is `packages/io` pixel output, `apps/server/src/output-manager.ts`, and their tests. Server main/hosts, core, protocol schemas, UI, design artifacts, and global context/ROUTER documents are unchanged.

## Ground: implemented behavior

### P05 — observable UDP lifecycle and honest accounting

- Both Art-Net and sACN implement latched, replayable `onStatus` subscriptions: binding, ready, error (phase/message/errno), and closed. Bind, broadcast/multicast setup, synchronous send, asynchronous send, and socket failures are observable. sACN now binds its configured source interface for unicast as well as setting the multicast interface.
- `send` is still synchronous/fire-and-forget. Its return value distinguishes **queued** (`true`) from **skipped/rejected** (`false`); only its completion callback can establish **local UDP acceptance**. Neither signal acknowledges controller receipt.
- Manager `packetsSent` now counts successful completion callbacks observed in the owning generation, including blackout packets. Dry-run, pre-bind skips, failed sends, and unconfirmed legacy calls do not increment it. Separate attempt/accepted/skipped/unconfirmed/simulated counters are available in `OutputManagerStatus` and explicitly named in Monitor summaries.
- Binding/closed/error conditions reuse `lastError`; readiness and recovery also reach Monitor. Repeated errors, recovery transitions, and blackout retries are coalesced with a default 1-second window and a bounded 32-key diagnostic cache. Summary windows cannot move a previous dry-run's counts to a new destination.
- Send failures retain the existing failsafe intent: asynchronous failures queue safety zeros **before the next frame**, never send zeros from a late callback. The engine does not wait for the network. Send recovery is observed through a later successful UDP completion; failed bind/setup or unexpectedly closed transports can be rebuilt by explicitly reapplying settings, including unchanged settings.
- The shared UDP lifecycle bounds pending sends at 1,024. Further submissions are skipped with `EOUTPUTBACKPRESSURE`, not queued indefinitely. Close rejects new work, releases status subscribers and per-send client callbacks immediately, and drains already-queued datagrams before socket disposal. Drain time is bounded at 250 ms; failures/timeouts reach a separate close completion callback. These bounds are defensive implementation choices, not hardware-tuned throughput guarantees.

### P07 — retained old wire coverage

- The manager owns copied `(universe, prefix-length)` coverage for live datagrams that were queued or legacy-unconfirmed. It does **not** borrow a mutable `DmxMap` or consult the incoming project to discover old coverage. Pending sends are conservatively included because they may reach UDP before their callback runs.
- `applySettings` retires removed/shrunk coverage before a new-map frame. `sendFrame` performs the same reconciliation for callers that change maps without reapplying settings, including in-place mutation of the same map object.
- Removing U2 from U1/U2 issues zeros to U2. Shrinking U1 from six channels to three issues a **six-channel zero prefix**, followed by the new three-channel live frame. Zeroing the full old prefix is intentional: short DMX packets cannot clear the old tail. Retained live channels are restored by the following frame.
- Destination/protocol/interface/priority changes and leaving armed issue blackouts using **old transmitted coverage and the old adapter**, then close that adapter. `close()` itself also blackouts retained coverage, so callers cannot accidentally drop it by omitting an explicit blackout.
- Failed/skipped retired blackouts stay in a retry set and retry before a later frame. One synchronous universe failure does not prevent attempts on the other old universes. Callback identity guards prevent an older cleanup completion from retiring a newer cleanup request; a live frame submitted after an earlier pending blackout still receives its own final blackout on close.
- Reconfiguration unsubscribes old status listeners and fences late per-send results by generation. Old drain failures are reported against the old destination and retained separately in `lastError`; a healthy new adapter does not silently erase an unresolved old-output failure.

## Record: regression evidence

`pnpm install --frozen-lockfile` succeeded without manifest/lockfile changes.

**Final targeted result: 78 tests passed (45 new), IO and server scoped typechecks passed, `git diff --check` clean.** No full sweep, build, UI-shot run, running application, or hardware test was performed.

| Seam / file | Passing tests | Evidence |
|---|---:|---|
| `packages/io/src/output-lifecycle.test.ts` | 22 new | Same lifecycle contract for both adapters: bind/error replay, pre-bind skip, sync and async failures, recovery, older-success/newer-failure race, bounded backlog, expected/unexpected close, pending-bind close, drain timeout and callback disposal. Includes real loopback encoded-send/drain and immediate-close-during-bind tests for both protocols. |
| `packages/io/src/artnet.test.ts`, `sacn.test.ts` | 8 existing | Encoder/header, padding, priority, and multicast-address regressions retained. |
| `apps/server/src/output-manager.lifecycle.test.ts` | 10 new | Attempts versus acceptance, bind/send failure and recovery, unchanged-settings rebind, generation fences, coalesced diagnostics, unexpected-close health, legacy semantics, dry-run destination attribution, deferred async failsafe ordering. |
| `apps/server/src/output-manager.coverage.test.ts` | 9 new | U1/U2 → U1; same-universe shrink with an in-place map mutation; destination+topology together; old send/close failure isolation; retry ordering; close after a pending cleanup followed by new light; never-transmitted coverage; empty incoming map; bounded retry diagnostics. |
| `apps/server/src/output-manager.udp.test.ts` | 4 new | Manager → real Art-Net/sACN adapter → fake OS socket. Byte-exact old-prefix zeros, old-destination ownership, submission ordering, delayed local acceptance, drain-before-disposal, and old asynchronous blackout failure visibility. No network traffic. |
| `apps/server/src/output-manager.test.ts`, `output-monitor.test.ts` | 25 existing | Packing, per-output RGB order, identify, state transitions, and diagnostics. Old expectations deliberately changed for dry-run/legacy counts and “Blackout requested” rather than “sent”. |

### Red → green record

Tests were added and run before their implementation slices, rather than only checking the finished code:

- Both adapters initially failed readiness tests (`onStatus` absent), asynchronous-completion tests (callbacks swallowed), and close/drain tests (immediate disposal and retained listeners).
- The manager's initial pre-bind test reproduced the audited false count: `packetsSent=1` instead of zero.
- The initial U2-retirement test failed with only the new U1 frame and no U2 blackout. A later pending-retirement/close test caught a second ordering bug: the older zero preceded new light and could not serve as the final blackout.
- Diagnostic stress tests reproduced 63 readiness output events instead of at most four, and 60 blackout-retry events instead of one within the window.
- Further red cases pinned backlog overflow, unexpected close, failed factory readiness, unchanged-settings bind retry, dry-run window attribution, and asynchronous failsafe ordering.
- **P07 trip proof:** temporarily restored only `output-manager.ts` from P05 commit `f97c27c`, leaving all nine coverage tests in place: **9/9 failed**. Restored the implementation and reran the final targeted set green. No historical code was left in the worktree.

Reproduce the final scoped checks:

```sh
pnpm --filter @ledrums/io exec vitest run \
  src/artnet.test.ts src/sacn.test.ts src/output-lifecycle.test.ts
pnpm --filter @ledrums/server exec vitest run \
  src/output-manager.test.ts src/output-manager.lifecycle.test.ts \
  src/output-manager.coverage.test.ts src/output-manager.udp.test.ts \
  src/output-monitor.test.ts
pnpm --filter @ledrums/io typecheck
pnpm --filter @ledrums/server typecheck
git diff --check
```

## Orient: P02 project-replacement worker handoff

### Ownership and call ordering

1. **Keep the existing OutputManager alive across project/model replacement.** Its retained coverage, retirement requests, destination snapshot and transport generation belong together. Do not replace it with a fresh manager and silently abandon the old one.
2. After validation/safety backup succeeds, call `applySettings(nextProject.output, nextDmxMap)` **before the first replacement frame**. No old-map argument or caller-owned coverage snapshot is needed: same-destination retirement and old-destination teardown are handled internally. Then route subsequent frames through `sendFrame(frame, nextDmxMap)`.
3. If a manager truly must be discarded, call its `close()` before dropping it. `blackout()` now accepts **no argument** to clear retained coverage. The existing `blackout(map)` form remains an emergency union of supplied coverage plus retained coverage; do not use an incoming map as a substitute for old coverage.
4. P02 still owns convergence of the actual active voice/legacy host, input map, transport, libraries and reported/persisted project. This change does not repair load/restore routing in main/hosts. It supplies the output-lifetime behavior those replacements should reuse.

### API changes

```ts
// PixelOutput: additive; existing void fake adapters remain structurally valid.
send(universe, channels, done?): boolean | void;
onStatus?(handler): () => void;
close(done?): void;

// OutputManager: existing call sites remain valid.
applySettings(settings, dmxMap): void;
blackout(dmxMap?): void;
close(): void;
status(): OutputManagerStatus;
```

- `PixelSendCallback` is `(error: Error | null) => void`. Successful send completion means local acceptance. Close completion reports aggregate drain/close failure; repeated close is a no-op.
- The optional status method and void return are **deliberate legacy compatibility**, not fallback success. Such adapters are marked `unobservable`; void sends are counted as `unconfirmed`. Their blackout is issued once without pretending acceptance. Throws and supplied callback errors remain visible. Use the real adapters with fake sockets for asynchronous lifecycle tests, not a void fake that cannot model them.
- Art-Net and sACN constructors accept an optional second socket factory for deterministic OS-boundary tests. Their encoders and sequence behavior remain protocol-owned; shared lifecycle is in `packages/io/src/udp-output.ts`.
- `OutputManagerStatus` extends the existing status with `readiness`, `packetsAttempted`, `packetsAccepted`, `packetsSkipped`, `packetsUnconfirmed`, and `packetsSimulated`. **No protocol schema or host return type was changed.** The existing wire `packetsSent` has corrected semantics and existing `lastError`/Monitor carry failures now. If a future UI needs typed access to the additional fields, coordinate protocol schema/type updates separately.
- Manager `close` is still fire-and-forget, not an awaitable transaction barrier. P02 needs no new API for ordered blackout **issuance**. A caller requiring an explicit local-drain settlement barrier (for example before forcing process exit) would need a manager-level completion/awaitable API and host wiring outside this worker's fence; `PixelOutput.close(done)` is the lower-level seam for it.

## Limits and remaining gates

- **UDP is not acknowledgement.** Tests establish packet contents, submission ordering, local callback outcomes and disposal ordering, not controller receipt, optical blackout, packet ordering across the network, or PixLite loss/merge behavior. Old zeros are submitted before new-map data; a new destination need not wait for the old destination's callbacks. Hardware P07 sign-off remains outstanding.
- Blackout is best-effort. Failure of the old transport, the pending-packet cap, the 250 ms drain deadline, or abrupt process termination can prevent delivery. Same-adapter failures retry at later frames. After destination disposal, unresolved failures remain latched for the manager lifetime; there is no new operator acknowledgement/reset control in this slice.
- Counters are cumulative manager observations, not a billing-grade wire total: callbacks arriving after generation retirement are intentionally not credited, even if drain later succeeds. Blackout requests and dry-run formation counts are explicitly separate from confirmed local acceptance.
- Full-prefix shrink blackout can briefly zero still-live channels before the replacement frame. No smooth hardware transition or latency improvement is claimed. There is no new sACN stream-termination/retransmission protocol or automatic background rebind timer.
- Actual tests used fake transports or sockets bound to `127.0.0.1` with ephemeral ports. No broadcast/multicast datagrams were emitted. UI presentation files were untouched, so no UI redesign/styleguide/screenshots were part of this change.

## Write: local commit ledger

- `f97c27c` — observe UDP readiness and local send acceptance.
- `73b4eeb8` — retain/retire old wire coverage, failure isolation, generation/recovery diagnostics, and deferred failsafe ordering.
- `52cbf0cc` — bound pending sends and verify lifecycle over loopback.
- This report records the scoped ownership, rationale, verification and repeatable regression procedure without changing global scaffold documents.

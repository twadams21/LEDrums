# Device sources and timing — independent review

**Historical first-pass findings; all three were corrected before final integration.** The resolution record follows the original review below.

## Scope and evidence boundary

Reviewed the working-tree additions under `integrations/ableton/**`, `scripts/perf-dev/**`, `apps/server/src/frame-timing.ts`, and **only the timing changes** in `apps/server/src/voice-engine-host.ts` against `efbf269230ba23c77e1adbc243b059c0b59835e4` (also HEAD during review). New/untracked files were included, not omitted because the committed diff is empty.

Requirements: this review request and `docs/plans/2026-09-14-stage-spatial-ableton.md`. Producer authority: `packages/protocol/src/track-input.ts`. Parent-owned protocol/main/input-handler code was read only to establish caller contracts. The parent's non-timing host/`oscRelease`, device/runtime UI and serial benchmarks remain outside this review.

Only this report was written. No source, `.mex`, git-history/index edits, installs, servers, benchmarks, desktop applications, real sockets, MIDI/audio devices or physical output were used. This is **not Live/Max certification**.

## Spec / actionable defects

### R1 · P1 — Ordinary stats packets terminate every real timing run

**Location:** `scripts/perf-dev/driver.mjs:223–232`; related metadata at `:114–115` and guidance in `scripts/perf-dev/README.md:133–153`.

The parent intentionally includes `timing` only once per second while ordinary stats continue every 10 ms (`apps/server/src/main.ts:854–873`). After `setShow` acknowledgement, the driver's `else if (phase === 'running')` treats the first ordinary packet without `timing` as failure: **“Server stopped returning timing snapshots.”** That packet is expected, not lost telemetry.

A pure fake-WS probe delivered presence, disabled state and one timing-bearing stats packet, acknowledged adoption, then delivered ordinary stats without `timing`. Result: `ok: false`, that exact error, and immediate runtime cleanup. The existing successful fixture always attaches timing and misses this integration failure.

**Correction:** accept snapshotless stats; retain the last actual timing snapshot separately for preflight, epoch and metadata, and use the existing advancing-timing timeout to detect loss. Merely deleting the throw also leaves `stats = message` clearing the metadata source on ordinary packets. Keep observing output/voice safety on ordinary stats. Update the README's cached-payload instructions rather than restoring a 100 Hz timing payload in main.

**Regression:** 100 Hz stats with a new timing snapshot only at 1 Hz must finish, preserve server metadata and retain only actual non-overlapping windows; missing/stalled timing must still time out.

### R2 · P2 — Closing the UDP socket immediately cancels the queued `bye`

**Location:** `integrations/ableton/udp.cjs:49–55`; callers `integrations/ableton/device-runtime.cjs:125–127` and `integrations/ableton/synthetic-sender.cjs:64–68`.

Both shutdown paths call `client.close()` (submitting `bye`) immediately followed by `transport.close()`. The transport tracks pending sends but ignores that count when closing. The comment that `dgram.close` waits for submitted sends is insufficient here: in the installed Node v25.8.2 source, unconnected `Socket.send` first performs an asynchronous lookup **even for literal `127.0.0.1`**. `close()` clears the handle; the later `doSend` returns without sending if that handle is gone. Thus normal shutdown can cancel the departure packet before local dispatch, not merely lose it somewhere on UDP.

Source inspection of Node's embedded `dgram`, `internal/dgram` and `dns` modules established that ordering without opening a socket. An injected deferred-lookup fake reproduced it: submitted `[hello, bye]`, locally sent `[hello]`, cancelled `[bye]`. Existing socket tests only record submission and do not test this drain boundary.

This leaves notes/macros/source presence dependent on lease expiry even after graceful stop. A quick reopen with the saved UUID and a new nonce can consequently receive `duplicate-id` and latch quarantine.

**Correction:** stop admission, allow accepted local sends to finish through a bounded drain, then close. Normal runtime/CLI/signal shutdown should join that drain; retain expiry as the crash/error fallback and keep delivery claims best-effort. Coordinate the signal entrypoint's exit deadline with the drain.

**Regression:** defer send completion, dispose immediately after submitting `bye`, and assert the socket stays open until completion or the explicit timeout. Cover bind-pending disposal and permanently missing callbacks without a real UDP socket.

### R3 · P2 — The measurement gate permits an input mode that drops all synthetic audio

**Location:** `scripts/perf-dev/options.mjs:57–67`; workload use at `scripts/perf-dev/workload.mjs:86–99`.

`assertStateSafe` checks output, transport and isolation but permits a non-null `project.inputMap.trackAudioInput`. In that supported configuration, the public WS `audioFeatures` handler deliberately drops browser-style frames (`apps/server/src/handlers/voice-input.ts:134–138`). The driver exclusively sends that message type, so its advertised four-band synthetic modulation never reaches the host. Audio can instead remain zero or come from the selected track.

A pure probe added `trackAudioInput: 'saved-audio-source'` to the otherwise safe fixture: the gate accepted it, while the real handler with an injected host forwarded **zero** synthetic audio frames. The generated brightness mapping has a nonzero lower bound, so active voices/nonzero preview alone cannot expose the missing modulation.

**Correction:** refuse selected-track audio during preflight, before `setShow`, and explain that this workload requires the browser/WS audio route on the disposable server. Do not silently change the input map; that would violate the driver's mutation boundary.

**Regression:** a selected-track fixture must send no mutations; the default-route fixture must prove the synthetic feature frame reaches the engine, not just that voices exist.

## Standards / checked boundaries

No additional actionable standards violations found in the scoped changes. In particular:

1. **Packets and identity:** 15 boundary packets from the foreign CJS writer passed the actual producer schema. MIDI integer/channel limits, finite normalized audio/macros, identity/sequence bounds and strict fields agree. Name validation is deliberately stricter on the client. Tests cover running status, release velocity, one runtime nonce, saved UUID restoration, explicit New identity and collision quarantine without automatic takeover.
2. **Patch source:** generated files match the generator exactly. Source topology preserves direct MIDI/stereo pass-through; analysis stays parallel; RMS packing fills the hot inlet last. Ready/state replay, Node message routing, stored-only identity/name parameters and stable automated macro names are structurally plausible. Declared connection ranges are not proof of Max object instantiation.
3. **Timing:** recorder clocks are injected; host clocks remain outside core. Fixed-step scheduling/clamping is unchanged. Quantiles use nearest rank with null empties; warmup excludes crossing starts; completion-window boundaries, full long durations, capacity flags and bounded storage are explicit. Client/server epochs remain separate; window percentiles are not aggregated into a fictional run-wide percentile.
4. **Safety and claims:** disabled-output and sole-editor gates precede mutation; no takeover/output/project/library writes are sent. Isolation loss stops further mutation. README limitations correctly distinguish source from packaged/Live-tested devices, filtered RMS from browser FFT, WS arrivals from physical latency, and this machine from the live machine. The R1 cadence guidance is the exception requiring correction.

## Verification performed

```sh
node integrations/ableton/generate.cjs --check
TSX_DISABLE_CACHE=1 node --test --test-concurrency=1 integrations/ableton/*.test.cjs scripts/perf-dev/*.test.mjs
```

**72 tests passed.** These use synthetic values/injected sockets; the workload behavior test runs 44 fixed host steps with output disabled and an adapter factory that throws on physical output. It does not start host timers or benchmark durations.

Additional inline Node probes established R1, R2 and R3, checked canonical packet acceptance, and checked recorder warmup/long-duration/shared-edge behavior plus acceptance by the actual timing schema. No probe files were written. No workspace sweep, running-server measurement or Live/Max behavior was claimed.

## Integrating-session resolution — 2026-09-14

1. **R1:** Driver retains `latestTiming` separately from 100 Hz ordinary stats. Ordinary packets
   still enforce isolation/foreign-voice checks; missing/stale timing still times out.
   Regressions cover interleaved 100 Hz/1 Hz reports and preflight ordering. Timing work and
   payload stay 1 Hz.
2. **R2:** Admission stops immediately; runtime, Max signal handlers and CLI join a **250 ms
   bounded local send drain**. Injected tests cover deferred/missing callbacks, bind-pending
   closure, reentrant failures, repeated signals, startup failure and shared deadlines
   (**75 producer tests passed**). Actual isolated-server integration observed both departures
   within 800 ms of CLI exit, then immediate successful restart—before the old 3-second lease
   could rescue a lost bye. This proves that loopback run, not guaranteed UDP receipt.
3. **R3:** Selected-track Audio fails preflight before mutation. The workload regression removes
   the modulation floor and checks real dark/lit RGB across 49 fixed host steps, not just voice
   count. Separate named-source dev integration proved RGB sum **0 → 193,994 → 0** after audio
   freshness expires, and scoped macro **215,992 → 0** on departure on the disposable
   **2,192-pixel** kit.

Producer/registry interoperability also required bye to preserve the ordering watermark rather
than permanently close a nonce. The actual CJS session can round-trip port/saved-identity edits
with a higher-sequence hello on the same peer; delayed packets cannot reset admission.

All **102** combined integration/driver Node tests passed after correction. Max/Live loading,
packaging, audio/MIDI fidelity and hardware stick-to-light latency remain outside verification.

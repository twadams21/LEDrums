# Isolated dev-server performance observations

## Run (parent/operator only, once other agents are quiet)

Against an **already-running isolated voice-mode LEDrums dev server**:

```sh
node scripts/perf-dev/run.mjs --url ws://127.0.0.1:4399/ws --allow-mutations --voices 8 --warmup 5 --duration 15 > /tmp/ledrums-perf-local.json
```

The port is an example, not a server the script starts. Use the actual isolated server's port.
The server must use disposable project storage, output disabled, a non-default OSC port,
manual transport, browser/WS audio selected (no `trackAudioInput`), no sharing tunnel, and have no other WS clients. The driver cannot prove the
storage path through the public protocol; the operator must establish that isolation first.
The driver never installs dependencies, starts software, opens MIDI/audio devices, sends UDP,
or changes output/transport/input-map/project/library settings. It refuses default ports,
non-literal-loopback URLs, a viewer role, or multiple clients. `blackout`/transmit mute is **not**
accepted as disabled output. A room requiring authentication is intentionally unsupported.

`--allow-mutations` authorizes replacing the **ephemeral runtime Show** only. A successful run
clears that runtime with another `setShow` and waits for its revision acknowledgement. It does
**not** save a library, reconstruct a prior runtime from persisted content, or restore the old
runtime. If ownership/output/project identity changes, it closes without further mutation—even
cleanup—rather than touching someone else's state. Interruptions otherwise attempt the same
bounded cleanup. An acknowledgement/close timeout is at most one second each; handshake and
stale-stats limits are ten seconds. A normal Node event-loop stall can delay any timer.

Inputs are synthetic public `midi` and `audioFeatures` messages. Stable existing kit MIDI
mappings supply real drum origins; global-control-bound notes are excluded (especially transmit
and tempo controls). One kit-wide Spatial Field per mono bus, eight sustained lanes by default,
receives a deterministic retrigger burst each second. Core's minimum release ramp temporarily
adds outgoing voices; JSON reports actual total voice counts rather than claiming exactly eight
at every instant. Four deterministic bands modulate brightness at 30 Hz. Client timer delays
skip to the current sequence index and count skipped emissions; no burst catch-up is hidden.
No MIDI clock messages or audio capture are involved. Show/kit/input-map hashes, source mappings,
parameter defaults and the transport snapshot identify the actual workload.

## Read the JSON correctly

- Every timing is a **machine-local observation**. The older Intel Mac is not the live machine;
  no proportional speed-up, SLA, or live-kit latency prediction follows from these results.
- `metadata.host` is the **server's** OS/release/arch/Node/CPU identity. `metadata.client` is the
  driver's runtime, recorded separately even on loopback. Pixel count comes from the server.
- `serverTiming.windows[].timing` contains actual returned snapshots, selected after server
  warmup and with **no overlap**. Nearest-rank p50/p95/p99 are per window. Do not average those
  percentiles or claim a run-wide render percentile from them. Samples are assigned by completion
  time, retaining the FULL length of a stall even if it began before the selected window. Recorder
  warmup excludes samples started before readiness; driver warmup selects later completed windows.
  Gaps between accepted windows are possible; bounds and counts are retained. Run-end boundary
  alignment can exclude the last window. A truncated window is explicitly flagged in each metric.
- `preview.arrivalGapMs` is the nearest-rank distribution of client WS binary arrival gaps,
  excluding warmup and its crossing interval. It is **not** browser paint, WS RTT, or physical
  input-to-light latency. Server and client monotonic clocks have separate epochs; they are not
  subtracted to infer an input/output latency. Existing `latencyMs` is deliberately not used.
- Driver warmup is measured from `setShow` acknowledgement for preview; timing warmup is measured
  from the server's recorder reset on `setShow`. These boundaries are explicit, not assumed to
  be physically simultaneous. `durationMs` is requested duration; actual client elapsed is also
  reported. Synthetic message values/order are deterministic, their OS/WS delivery times aren't.

The host uses seven 2,048-entry metric rings plus one shared sort scratch (352 KiB of doubles).
Window = trailing 1,000 ms; recorder warmup = 2,000 ms after start/show/project replacement.
The driver's bounded sample arrays hold up to 32,768 preview/voice-count/FPS observations each,
plus 256 returned timing windows; overwrite counts remain visible. No RGB frame is retained.
CLI bounds: 1–32 sustained lanes, 0–120 s warmup, 2–120 s duration. The server's recorder warmup
plus one complete window must fit inside the chosen warmup (at least 3 s with defaults).
The trailing window is `(start, end]`; the initial recorder-ready boundary is inclusive. Adjacent
windows do not double-count shared-edge completions. `ticksObserved`/`loopsObserved` include
warmup since reset, unlike the window's distribution counts.

## Scoped tests (no server, benchmark or hardware)

```sh
pnpm --filter @ledrums/server exec vitest run src/frame-timing.test.ts
node --test scripts/perf-dev/*.test.mjs
```

Node tests use an injected fake WS and clock for safety/lifecycle coverage. One behavior test
loads the existing server's `tsx` dependency and drives the real host through 49 fixed steps,
with an output factory that throws if any physical adapter is requested. It does not run the
host's timers or assert wall durations. The executable resolves `ws` through
`createRequire(new URL('../../apps/server/package.json', import.meta.url))`.

## Wire and test integration

`packages/protocol/src/frame-timing.ts` owns the schema for optional top-level `stats.timing`.
`main.ts` takes **and sends** a snapshot at 1 Hz: neither sorting nor the extra JSON payload
runs at the legacy 100 Hz stats cadence. Legacy-mode stats are unchanged. The driver waits for
current recorder-epoch observations after `setShow`; `onShowChanged` supplies adoption/cleanup
acknowledgements.

`pnpm perf:dev -- …` aliases the driver. `pnpm test:integrations` runs its synthetic tests and
the Ableton source-helper tests; the root `pnpm test` includes that gate. There are no dependency
or lockfile changes. See `docs/reports/2026-09-14-performance-method.md` for measurement limits.

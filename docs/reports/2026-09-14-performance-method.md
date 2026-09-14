# Performance measurement foundation — 2026-09-14

Scope/source: Trent's approved performance workstream on `feat/stage-spatial-ableton`.
`VoiceEngineHost`, its colocated timing recorder/tests and `scripts/perf-dev/` observe the
existing scheduler; protocol/main glue exposes optional timing snapshots at 1 Hz. This document
specifies the method, not measured results. Separate spatial/preview/input changes are covered
by the build plan and implementation report.

## Observation definitions

All timestamps are monotonic milliseconds supplied by the server host (`performance.now`).
No new clock reads occur in pure core. The existing fixed timestep, recursive timeout, elapsed
clamp, maximum step count and backlog rule are unchanged.

| Field | Exact observation |
| --- | --- |
| `tickIntervalMs` | Difference between actual starts of consecutive `engine.tick` calls; catch-up calls can be tightly spaced. Not the constant simulation dt. First tick supplies a baseline, not a gap. |
| `renderDurationMs` | Synchronous `engine.tick` return minus entry. Includes synchronous diagnostics inside that call; excludes host transport calculation, output packing/send, preview conversion/send, and observer recording. Not GPU time. |
| `loopIntervalMs` | Raw `now - lastWall` read by each timer callback before the elapsed clamp, including callbacks with no ticks. First callback measures from the existing start/reset baseline. |
| `timerLatenessMs` | `max(0, callbackStart - (timerRequestTime + requestedDelay))`. This is lateness against the recursive timer request, not an ideal absolute 120 Hz schedule; Node delay truncation may produce early callbacks, recorded as zero. |
| `clampedElapsedMs` | Exact raw elapsed minus elapsed admitted by the existing 100 ms clamp, associated with that callback. |
| `discardedBacklogMs` | Exact accumulator value erased by the existing post-loop backlog-drop branch. Separate from elapsed clamping; no rounded/fabricated "dropped frames" count. |
| `stepsPerLoop` | Actual fixed steps executed by a callback, including zero. Shows catch-up bursts without calling them dropped frames. |

Per-metric summaries contain count, sum, min, max, mean, p50/p95/p99 and a truncation flag.
Quantiles are **nearest rank**: sort ascending, take index `ceil(p*n)-1`; no interpolation.
Empty count/sum are zero; empty extrema/mean/quantiles are null. Zero is a valid observation.
Invalid/non-finite/negative/reversed input is rejected before it can poison a baseline; rejected
call counters are explicit. Constructor bounds are checked.

Seven metric rings each hold 2,048 observations; timestamp/value columns plus one shared sort
scratch use 352 KiB of doubles per host. Recording does not allocate samples or sort. Snapshot
sorting operates on scratch, not the retained observations. Old snapshots don't change on wrap.
Capacity eviction is flagged when it may truncate the requested window.

Default recorder warmup is 2,000 ms after host start, runtime show replacement, or project
replacement. It excludes observations **started** before readiness, including crossing gaps.
The rolling window is the latest 1,000 ms of **completions**, retaining a full long stall rather
than clipping it or silently losing it because it began before the window. The lower boundary
is exclusive except the initial ready boundary, which is inclusive; upper boundary is inclusive.
Callback discard totals are attributed to the callback, not spread over the lost elapsed time.
Lifetime observed/rejected counters include warmup; quantile counts describe only the window.

`getFrameTiming()` is an independent snapshot seam; existing `getStats()` and `latencyMs` retain
their old shape/meaning. Main computes and sends timing at 1 Hz, not the 100 Hz stats rate.
The server's OS/release/architecture/Node/CPU metadata is collected on the cold construction
path. See [executable usage and isolation requirements](../../scripts/perf-dev/README.md).

## Experiment boundary

The driver connects only to an already-running, operator-isolated, output-disabled dev server
on non-default literal-loopback HTTP/WS and OSC ports. It starts no software. Explicit mutation
consent plus sole-client/editor presence is mandatory; it never takes over or disables output.
The public protocol cannot prove disposable project storage: operator setup remains necessary.

A deterministic kit-derived runtime Show uses existing, non-global-control-bound MIDI notes,
kit-wide Spatial Fields on independent mono buses, and four synthetic audio modulation bands.
Retriggering refreshes per-voice disturbances each second. Core's existing minimum release tail
briefly adds outgoing voices beyond the requested sustained lanes; actual voice counts are
reported. No authored library is saved or changed. Safe completion clears the ephemeral runtime
and waits for its acknowledgement. Isolation loss stops mutation, including cleanup.

JSON retains actual returned non-overlapping timing windows; it never aggregates their
percentiles into fictitious run-wide percentiles. It separately summarizes bounded client
preview-arrival gaps, discarding the first warmup-crossing gap. Preview receipt is not browser
paint, WS RTT, physical input-to-light latency, or a kit output acknowledgement. Client/server
clock epochs remain separate; input payload/order is deterministic, OS/WS delivery is not.
Skipped client input emissions and retention truncation remain visible.

Every timing produced by this tooling is a **machine-local dev observation**. This older Intel
Mac is not the live machine. No proportional prediction, physical latency claim, or CI SLA is
established. Measure only after parallel work settles. Scoped correctness tests use fake WS/clock
and disabled-output host behavior, not wall-duration thresholds. No external software, real
inputs, controller or physical output is needed by the measurement procedure.

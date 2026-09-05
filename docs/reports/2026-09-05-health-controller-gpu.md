# P06 / P09 / FPS verification

Source: approved follow-ups to `docs/plans/2026-09-05-codebase-health-audit.md`.
Implementation only; no controller commands were sent to physical hardware and nothing was published.

## P06 — controller takeover ownership

`controller-test-mode.ts` captures the destination/client before queuing a command, serializes acquisition and return-to-live, and queues old-controller cleanup before replacement-controller commands. Last-watcher departure and shutdown now return to live even if acquisition was still pending. Failed return-to-live keeps the active state retryable rather than clearing it before acknowledgement. Failed acquisition remains eligible for cleanup because a missing response does not prove the device ignored it. Poll responses from retired client generations cannot overwrite replacement status. Shutdown awaits cleanup alongside autosave flushes.

Four regressions failed against the previous implementation (watcher departure during acquisition, failed return-to-live retry, controller replacement during acquisition, out-of-order requests). After implementation, all six added lifecycle regressions passed; controller-monitor + client-message suites: **81 tests**, server typecheck: green.

This is best-effort remote cleanup, not a guarantee an unreachable controller returns to live. Failures remain observable with the captured destination. Real PixLite timing/reconnect verification remains outstanding.

## P09 — GPU buffer lifetime

`pixel-resources.ts` owns the visualizer's geometry/material. Rebuild disposal happens **before** attribute replacement: Three's disposal handler reads the current attribute objects to free uploaded GPU buffers. Empty geometry clears attributes and draw range; teardown disposes geometry/material once. `Pixels.svelte` uses this owner and rebuilds when scale changes as well as model identity. No visual primitives, styling, tokens or interaction changes; existing design-system visuals are preserved.

Evidence:
- Two ownership tests pass (retire-before-replace, empty model, idempotent teardown); removing disposal demonstrated regression failure.
- `scripts/health-webgl.mjs` instruments actual browser WebGL buffer creation/deletion, repeatedly revises model geometry and remounts Monitor/Perform three times.
- Baseline component: **26 → 44 live buffers**, **18 retained**, assertion failed.
- Fixed component: **23 live buffers** throughout revisions/remounts, **zero growth**.
- This is an allocation/lifetime measurement, not a measured frame-rate improvement.
- Clean connected capture: `UI_SHOT_BASE=http://localhost:5411 pnpm ui-shot --view perform --target 'main.center' --name health-pixels --strict`, exit 0. Inspected `.ui-shots/health-pixels.png`: stage geometry and strip view render as before; strict console check passed. Initial attempts used a web-only server (WS error) and IPv4 URL against an IPv6-only Vite listener (timeout); neither is counted as clean verification.

The real-browser probe is reproducible against the dev screenshot seam, with isolated project storage and output disarmed. It does not connect to a drum kit.

## FPS denominator

`tick-rate.ts` measures completed ticks over actual wall time, independent of clamped simulation delta. Both hosts reset the sample on restart. Regressions cover normal throughput, half throughput with clamped simulation and restart. Demonstrated red before the fix; **38 host tests** and server typecheck passed. This makes the metric honest; it does not itself speed up rendering.

# E1 — Error capture net → Monitor bus

Spec: #122. Effort: **medium**. Wave 1 (parallel with E3, E4).

## Mission

Every error-shaped event in the running app becomes a `MonitorEvent{type:'error'}` on the server's Monitor bus. Web errors travel over the existing WebSocket via one new client message; server process faults emit directly. After this slice, the drummer's `each_key_duplicate`-class errors are visible in the local Monitor view and its replay buffer — before any remote shipping exists.

## What to build

1. **Protocol**: one new client message `{t:'clientError', message: string, stack?: string, source?: string}` in `@ledrums/protocol`, with its zod schema (the protocol package locks message types to schemas by type-level assertion — follow that pattern additively).
2. **Web capture module** (new, `apps/web/src/lib/` — pure logic split from DOM wiring for testability):
   - `window.onerror` + `unhandledrejection` handlers.
   - `console.error` tap: wrap, forward, always call through to the original. Guard against recursion (a tap-caused error must not re-enter the tap).
   - Send via the existing WS client when open; buffer up to 50 in memory until the socket opens (boot-time errors matter), drop-oldest beyond.
   - Local rate cap (e.g. max ~20 forwards per second) so an error storm can't flood the socket — the server-side Reporter (E2) owns real dedup.
3. **Server handler**: the new message emits onto the Monitor bus — `type:'error'`, `direction:'in'`, `source:'web'`, `label` = message (truncated sanely), `detail` = stack. Malformed payloads rejected without crashing (existing handler conventions).
4. **Server process handlers** (boot wiring): `process.on('uncaughtException')` / `('unhandledRejection')` → emit onto the bus, log, then **preserve default fatal behaviour** for uncaughtException (emit-and-exit; do not swallow — fail closed). E2 later adds best-effort queue persistence here.

## Anchors to verify

- `packages/protocol/src/index.ts` — message unions + the schema-lock pattern (`./schemas`).
- `apps/web/src/lib/ws/client.ts` — the WS client seam and how messages are sent/queued today.
- `apps/server/src/handlers/client-message.ts` + its test suite — handler + rejection conventions.
- `apps/server/src/monitor.ts` (`createMonitorBus`) and `apps/server/src/main.ts` / `boot.ts` — where the bus lives and where process handlers belong.
- `MonitorEvent` already has `type:'error'` — no protocol change needed for the event itself.

## Scope fence

May touch: `packages/protocol/src/**`, `apps/web/src/lib/ws/**`, new web capture module + its boot wiring point, `apps/server/src/handlers/client-message.ts`(+test), `apps/server/src/main.ts`/`boot.ts` (process handlers only), new tests.
Non-goals: no dedup/queue/shipping (E2), no Worker (E3), no enablement flags (capture is always-on and local), no UI.

## Tests

Handler test: well-formed `clientError` → correctly shaped bus event; malformed → rejected, no crash (prior art: existing `client-message.test.ts`). Capture module: jsdom tests for handler installation, console tap pass-through + recursion guard, pre-open buffering, rate cap. Process handlers: emit-then-default-behaviour, testable via injected bus/exit.

## Escalation triggers

- The protocol schema lock demands anything non-additive.
- The console tap fights dev tooling (Vite overlay, svelte dev warnings) in a way that needs a policy call.
- The WS client has no clean "queue until open" seam and adding one would restructure it.

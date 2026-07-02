# 01 — IO confidence (MIDI/OSC in, Art-Net/sACN out) + PixLite Mk3 integration

> Part of the 2026-07-02 "rock solid" initiative. See [INDEX.md](INDEX.md).

## Problem

The settings UX for MIDI/OSC input and Art-Net/sACN output gives the user no confidence that
messages are actually being received or sent. Trent wants direct integration with the Advatek
PixLite A4 Mk3 controller: discover it on the network, connect, read its IP, and — critically —
verify from the controller itself that lighting data is arriving.

## Current state (verified 2026-07-02)

### The confidence plumbing already exists server-side — the UI never reads it

- `packages/protocol/src/index.ts:128-137` — `OutputStatus { state: 'disabled'|'dry-run'|'armed',
  protocol, host, packetsSent, lastError, universeCount }`. Sent to every client in the `state`
  message on connect and in `stats` every 500ms (`apps/server/src/main.ts`, `stats` broadcast).
  **No web code reads `output` off the stats message.**
- `apps/web/src/lib/app/chrome/OutputPill.svelte:16-31` — the only "am I live?" surface. Shows
  LIVE/SYNC/LOCAL from **WS link state only**. Art-Net can be failing (`lastError` set, packets 0)
  while the pill shows green LIVE.
- `apps/server/src/output-manager.ts:73-250` — output state machine (disabled → dry-run → armed),
  tracks `packetsSent`/`lastError` (:201-210), emits coalesced 1s output summaries onto the
  monitor bus via `apps/server/src/output-monitor.ts:31-82`.
- `apps/web/src/lib/app/docks/Monitor.svelte` — the event log renders those summaries, but that is
  forensic reading, not an ambient indicator.

### Input side: events flow, indicators don't exist

- Config surfaces: `TriggerSourceInspector.svelte:126-189` (MIDI note/CC + Learn, OSC address),
  `PatchZoneInspector.svelte:54-91` (per-zone MIDI note + OSC address + Learn),
  `AppSettingsDialog.svelte:57-65` (global MIDI channel filter).
- None show "last heard" activity. MIDI Learn shows "Listening" but there is no confirmation after
  binding that the bound note is ever heard again.
- WebMIDI: `apps/web/src/lib/midi/webmidi.ts:106-155` enumerates + hot-plugs devices, but no UI
  lists devices. OSC: port hardcoded to 9000 (`packages/io/src/osc.ts:113-138`), no UI to change,
  no "port open" confirmation.
- Server monitors every input (`apps/server/src/main.ts:177-220` `monitorInput`; OSC UDP at
  :500-519; native MIDI HTTP at :384-430), so per-binding activity data already transits the WS.

### Output transports are fire-and-forget by design

- `packages/io/src/artnet.ts:38-84`, `packages/io/src/sacn.ts:85-125` — UDP send, socket errors
  swallowed, no replies possible at the protocol level. This is correct per the non-negotiables
  (never block the render loop). Confirmation must come out-of-band → the PixLite management API.

## PixLite Mk3 API (from `docs/pixlite-api/PixLite Mk3 API v1.7 (20251009).md`)

Full extraction lives in the summary below; doc section refs included so agents don't reread 187KB.

- **Transport**: HTTP/1.1 (port 80) + WebSocket (wss on 4443); strict-ordered JSON messages
  (first member must be `req`/`resp`). Auth = `user` + `auth` query params where
  `auth = Base64URL(SHA256(password))`; empty-password default works unauthenticated for `/ver`.
  (Doc §4, §5, §6.)
- **Discovery**: `GET /ver` — unauthenticated, no API version needed. Returns `prodName`,
  `nickname`, `fwVer`, `apiVer`, `authReqd`. **There is no broadcast/mDNS discovery in this API**
  — "find it on the network" = sweep the subnet with short-timeout `GET /ver` probes. (Doc §7.15.)
- **Rx verification** (`statisticRead`, or `statisticSubscribe` push over WS, doc §7.13):
  - per-universe: `ethProt.inUni.sACN` / `.artNet` → `uniNum`, `timedOut` (false = receiving!),
    `inGood`, `inBadSeq`, `inLowPri`, `priority`, `sourceName`.
  - rates: `pixData.inFrmRate` (network rx Hz) vs `outFrmRate` (pixel output Hz).
  - health: `dev.temp`, `dev.bankVolt`, `pixPwrOuts.stat` ("Good"/"OvrCur"/"FuseBlwn"), `eth.extp`
    link state.
- **Identify**: `{"req":"identify","params":{"duration":120}}` flashes the status LED (doc §7.5).
  **Test pattern**: `modeTestData` (setColor/rgbwCycle/colorFade, per-port/per-pixel) (doc §7.7.2).
- **Config**: `configRead`/`configChange` for network (`net.ipMode/staticIpAddr/...`) and pixel
  ports (`pixPort.pixCount/startUni/startCh/colorOrder/intensity`). Network changes disconnect all
  WS clients (`NETWORK_CHANGE`). `action:'apply'` (volatile) vs `'save'` (persistent). (Doc §7.1.)
- **Gotchas**: sequential requests only (wait for each response); WS client count limited
  (controller evicts LRU client); statistic-subscription count limited (STATSUB_ERROR); strict
  JSON member ordering; firmware upload is single-client with 5s inter-block timeout.

## Proposed design

### Module 1 — `PixliteClient` (new, `packages/io/src/pixlite/`)

A deep module: small interface, all HTTP/WS/JSON-ordering/auth complexity inside.

- Interface (sketch): `probe(host, timeoutMs) → ControllerIdentity | null`;
  `connect(host, auth?) → session` with `readStats(paths)`, `subscribeStats(paths, periodMs, cb)`,
  `identify(durationS)`, `readConfig(paths)`, `applyConfig(partial, action)`. Plus a pure
  `sweep(cidr | ifaceAddrs, probe)` discovery helper that takes the prober as a dependency
  (testable without a network).
- Implementation notes: enforce the sequential-request rule inside the module (internal queue);
  serialize JSON with explicit member ordering (hand-build strings or ordered maps — do NOT rely
  on object key order surviving transforms); hold WS sessions only while a consumer is subscribed
  (controller evicts idle clients anyway).
- Seam: lives in `packages/io` beside the other transport adapters, behind an interface so the
  server can inject a fake. Two adapters (real HTTP, in-memory fake for tests) = a real seam.
- `packages/core` never touches this (non-negotiable).

### Module 2 — controller monitor service (`apps/server/src/controller-monitor.ts`)

- Owns discovery + adoption + a polling/subscription loop against the adopted controller.
- Emits onto the existing monitor bus (`monitor.ts:8-27` pattern) AND a new protocol message
  `{ t:'controllerStatus'; status }` carrying: identity (name/model/fw/ip), per-universe rx
  (receiving? good/bad counters), inFrmRate/outFrmRate, temp/voltage/port status, lastSeen.
- New client→server messages: `{ t:'discoverControllers' }`, `{ t:'adoptController'; host }`,
  `{ t:'identifyController'; durationS }`. Discovery sweep scope: derive candidate subnet from the
  configured output `host`/`iface` (`OutputSettings`), fall back to local interface subnets.
- Persist the adopted controller (host + nickname) on the server `Project` (new optional
  `project.controller` field in `packages/core/src/model/project-schema.ts` — data only, no IO).

### Module 3 — the confidence UI

1. **Output truth in the pill**: `OutputPill` derives from `stats.output` (`OutputStatus`), not
   just link state: armed+packets-flowing = live; `lastError` → error tone + tooltip; dry-run and
   disabled shown honestly. This alone kills the worst lie in the app.
2. **Output status panel** (Patch controller node Inspector, `PatchControllerInspector.svelte`):
   state, packets/s, universes, last error, and — when a PixLite is adopted — the controller's own
   rx stats ("controller is receiving U0–U7 @ 44fps, 0 bad") + temp/voltage/port health +
   **Identify** button + **Adopt IP** (copy discovered IP into `OutputSettings.host`).
3. **Input activity badges**: tiny last-heard indicator (`note · velocity · age`) beside the
   MIDI/OSC fields in `TriggerSourceInspector` and `PatchZoneInspector`, fed from the existing
   `input`/`monitor` WS traffic filtered by binding (pure matcher, unit-testable). Global MIDI
   device list (from `initMidi`'s `inputs`) in `AppSettingsDialog` with hot-plug refresh.

### End-to-end confidence chain this buys

app fired graph (monitor `graph` events) → server sent packets (`OutputStatus.packetsSent`) →
**controller received them** (`inUni.artNet.timedOut=false`, `inGood` rising) → controller
outputting (`outFrmRate` > 0, port status Good). Each link has a UI home.

## Touch list

- new `packages/io/src/pixlite/` (client, discovery, types, fake), `packages/io/src/index.ts` export
- new `apps/server/src/controller-monitor.ts`; wire in `apps/server/src/main.ts` + handlers
- `packages/protocol/src/index.ts` — `controllerStatus` + discovery/adopt/identify messages
- `packages/core/src/model/project-schema.ts` — optional `controller` persistence field
- `apps/web` — `OutputPill.svelte`, `PatchControllerInspector.svelte`, `TriggerSourceInspector.svelte`,
  `PatchZoneInspector.svelte`, `AppSettingsDialog.svelte`, store (`stats.output` adoption, new msgs)

## Tests

- `PixliteClient`: response parsing + strict-order serialization against fixture JSON captured from
  the doc's examples (§7.15 fig 35, §7.13 tables); sequential-queue behavior; sweep with fake prober.
- Controller monitor: fake client adapter → status message shape, lastSeen aging, adopt/persist.
- Pure input-activity matcher (binding × monitor event → badge state).
- OutputPill derivation: pure function of (link, OutputStatus) → tone/label; table-driven.

## Decisions (LOCKED 2026-07-02)

- **v1 scope = read-only + identify + test patterns** (Trent's call): discover/adopt/verify/
  identify PLUS the controller's `modeTestData` test patterns (setColor/rgbwCycle/colorFade,
  per-port/per-pixel) for verifying physical wiring without the engine. **While a test pattern is
  active the controller ignores the Art-Net stream** — the UI must make that state loud (banner on
  the controller panel + OutputPill warning tone) and always offer one-click "back to live data".
  Config-write (IP, pixel ports) is explicitly deferred to a later slice ("eventually write would
  be nice").
- Transport: server polls `statisticRead` at 1–2s while any web client has Monitor/Patch open
  (HTTP, no WS client-limit concerns).
- Auth UX if a controller has a password set: prompt + store the auth hash on the server Project
  (never the plaintext). Empty-password default needs nothing.

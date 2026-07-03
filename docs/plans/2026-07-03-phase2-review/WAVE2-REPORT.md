# Wave 2 report — correctness fixes

Branch `wave-2/correctness` off `rock-solid`, 4 item commits (`fd6694f`, `66c8a18`, `321b9cb`, `744f5e9`).
Gates at handoff: `pnpm typecheck` 0 errors; `pnpm test` 1812 passed / 0 failed / 0 skipped
(core 548, web 1046, server 204, io 13, protocol 1); live smoke across all six views with a
clean console (favicon 404 only — wave-3 chrome scope).

## Item 1 — trigger-graph fixes (`fd6694f`)

All nine mapped defects addressed; verified live before/after in the running app.

- **Spawn stacking (5)**: pure ring-walk `findFreePosition` over xyflow's measured rects —
  `views/node-placement.ts` (+5 tests). Used by TriggerGraphView `spawnAt` AND PatchGraphView
  addDevice.
- **Duplicate wires (2)**: port canonicalisation (`''`/`'in'`/null → undefined) + `sameSlot`
  dedup identity in `store/graph-wiring.ts` (`normalizeFromPort`/`normalizeToPort`, tests);
  store persists canonical ports so no bypass path re-introduces dupes.
- **Unselectable wires (3)**: `BaseEdge interactionWidth={24}` + transparent-stroke fix for the
  `.svelte-flow__edge-interaction` hit path (unpainted strokes never hit-test otherwise).
- **Z-order churn (6)**: `elevateNodesOnSelect={false}` — wires under nodes, selection never
  reorders.
- **Selection clone churn / node XY (4)**: selection-only projection changes now clone the
  PREVIOUS node (positions survive rebuilds) — `trigger-flow-projection.ts` + regression test.
- **Modifier handle placement (7)**: handles moved inside the card wrapper, positioned from card
  layout (no hardcoded 74%).
- **Inspector follow (8)**: AuthorShell clears node selection only when a REAL graph lacks the
  node (transient null no longer wipes selection).
- **Hover (9)**: one pattern — pure CSS, instant; removed NodeCard `hovered` prop + palette
  transition; styleguide demo updated, `docs/design-system.html` regenerated.
- **(a) Delay corruption**: reproduced as the spawn-stacking pointer-theft illusion (wave-1
  concurrence); fixed by placement. **(b)** shared `ui/theme-tokens.ts` (`readThemeTokens`)
  replaces both self-referential `$effect` `getComputedStyle` reads. **(c)** `guardFlowCallback`
  extended to every PatchGraphView flow callback → `store.reportError('patch-graph', …)`.
- **Needs manual verify**: wire-release curve shift (1.1) — no concrete defect found in preview
  vs committed coords; could not reproduce. Watch for it during master review.

## Item 2 — one render truth (`66c8a18`)

- Web sim's 6 `Math.random()` → seeded core `Prng` (engine seed `0x1a2b3c4d`); module-global
  voice counter → per-Sim instance (cross-instance determinism).
- **Per-trigger seeding**: `Voice.seed = deriveSeed(0x1ed5eed5, voiceSeq)` in core voice-pool
  AND web sim; `createState(model, seed)` threaded through generator-bridge/render into
  confetti-burst, pixel-accum, sacred-hogs, gravity-wells, starfield, comet-trails.
- Idle rAF waste: client render loop skips `renderFrame()` while the server link renders.
- Tests: `packages/core/src/voice/determinism.test.ts` (replay determinism via Float32Array
  frame snapshots, A+A=2×A, per-trigger decorrelation + exact replay, retrigger overlap with
  independent envelopes, hoop geometry-only diff) + `apps/web/.../sim-determinism.test.ts`
  (visualiser-input seam through chance/random/confetti). S26 compositor tests gained a
  counter-priming param so retrigger-vs-fresh seed sequences align.

## Item 3 — LayersDock smoothing (`321b9cb`)

- Confirmed first: meters stepped at ~430–500 ms (2 Hz stats adopted raw).
- Pure `dock-smoothing.ts`: frame-rate-independent exponential approach (τ=150 ms,
  `1−e^(−dt/τ)`), snap-to-converge (0.004), settled objects returned BY REFERENCE (zero churn),
  one-pass `groupVoicesByBus` replacing per-bus `filter()` (+7 tests). Store advances display
  values per rAF frame; server stays the only truth.
- After: meter transform changes at median 17 ms intervals under live voice load; 60 ms CSS
  transition removed (double-smoothing).

## Item 4 — Share/tunnel in-app start/stop (`744f5e9`, rescoped spec)

- **Protocol**: `TunnelInfo` gains `status: off|starting|live|error` (+`error` text); new
  `{ t:'tunnel', action:'start'|'stop' }`; `tunnel` always present on `state` now.
- **Server**: new `TunnelControl` status machine over the untouched `TunnelManager` — one truth
  for boot-env starts AND in-app starts; restart-after-error builds a fresh manager; unexpected
  exits surface as error status (never silent). `createMutablePinGate.ensurePin()` runs BEFORE
  every spawn — a public URL can never exist un-gated (verified live: PIN present already in the
  `starting` broadcast). Clients admitted with cf-* headers are tracked (WeakSet) and refused
  tunnel control with a visible error — even after `takeover`; viewers are refused by the
  deny-by-default editor gate.
- **Web**: `store.setSharing(on)`; ShareInfo is ALWAYS visible with a status dot and a 4-state
  popover — off→Start sharing, starting→progress, live→URL+PIN+per-row copy+**Copy invite**
  (one click, URL and PIN on separate lines — Trent's ask)+Stop, error→server's plain-language
  explanation+Try again. Viewer sees state read-only with an explanation.
- **Tests**: `tunnel-control.test.ts` (7 — lifecycle over a fake spawner incl. stop-while-
  starting and unexpected-exit), mutable pin gate (2), handler authz (5 — editor ok, viewer
  refused, tunnel-rider refused post-takeover, no-op wiring safe), decode, store send (1),
  ShareInfo states (13). Existing `tunnelConfigFromEnv`/`parseTunnelUrl` suites untouched+green.
- **Live acceptance** (plain dev server, NO env flag): WS-protocol run — off → start →
  starting(PIN minted) → live `https://…trycloudflare.com` + PIN → stop → off. UI run — Share
  popover Start→live URL+PIN→Stop in a real browser (screenshots in session). Error path: server
  with cloudflared off PATH → `status:'error'` with the install-hint message. PIN gate proven:
  a fresh tab after sharing started was PIN-gated; entering the run PIN admitted it.

## Surprises

- `pointer-events: visibleStroke` never hits an unpainted stroke — xyflow's edge interaction
  path needs `stroke: transparent`, not just width.
- Frame snapshots via `Uint8Array(frame())` silently truncate float RGBA to zeros — vacuous
  determinism tests; use Float32Array + byte-view compare.
- Playwright's trusted `click` on buttons inside the Bits UI popover is swallowed (focus-trap
  timing); JS-dispatched clicks and real users are fine — worth knowing for ui-shot scripts.
- Per-run PIN persists after Stop sharing (by design — stable for the server run); local
  browser tabs opened after a share need the PIN. Desktop app is unaffected (host token).

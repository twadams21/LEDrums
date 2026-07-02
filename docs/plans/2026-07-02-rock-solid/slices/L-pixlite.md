# Group L — PixLite Mk3 integration

Context: [doc 01](../01-io-confidence-pixlite.md) (§ PixLite API + design) · Parent PRD: #45 · Stories: 3–8

## S46 — PixliteClient in io `plumbing`

**Blocked by:** none.

**What to build:** The PixLite client module behind an interface in the io package: /ver probe
(unauthenticated identity), statisticRead (per-universe rx counters, frame rates, temps/voltages/
port status), identify, auth hashing (Base64URL-SHA256), strict JSON member ordering, and an
internal sequential-request queue (API forbids concurrent requests). In-memory fake as the second
adapter. Pure subnet-sweep helper taking the prober as a dependency. Core never touches this.

**Acceptance criteria:**
- [ ] Response parsing + strict-order serialization against fixture JSON from the API doc
- [ ] Sequential queue verified (interleaved calls serialize); timeouts handled
- [ ] Sweep with fake prober finds/ranks controllers; fake adapter covers all client methods

## S47 — Discovery + controller-monitor service `plumbing`

**Blocked by:** S46.

**What to build:** Server-side controller monitor: discovery sweep (candidate subnet derived from
the configured output host/interface), adopt-a-controller (host + nickname persisted on the
server Project), and a polling loop (statisticRead at 1–2s while any client has Monitor/Patch
open) emitting a new controller-status protocol message (identity, per-universe rx, frame rates,
health, lastSeen) plus monitor-bus events. New client messages: discover, adopt, identify.

**Acceptance criteria:**
- [ ] With the fake client: discover → adopt → status messages flow with correct shape; lastSeen
      ages when the controller goes quiet
- [ ] Adopted controller persists and rehydrates with the Project
- [ ] Polling gates on client interest (no idle traffic)

## S48 — Controller panel UI `ui-significant`

**Blocked by:** S47, S03 (output status panel hosts it).

**What to build:** The controller inspector's status panel extends with the adopted controller:
identity (name/model/firmware/IP), per-universe rx verification (receiving?, good/bad counts,
active priority), in/out frame rates, health (temp, voltage, port status), Discover + Adopt-IP
(copies the discovered IP into output settings), and an Identify flash button. This completes the
confidence chain: app fired → server sent → controller received → controller outputting.

**Acceptance criteria:**
- [ ] Panel renders discovery results and live controller status (driven by fake-backed server in
      tests; live spot-check item for real hardware)
- [ ] Adopt-IP updates output settings in one click; Identify triggers the flash
- [ ] "Not receiving" states are visually unmissable (universe timed-out, controller lost)
- [ ] Applies `/make-interfaces-feel-better`

## S49 — Controller test patterns + takeover state `ui-light`

**Blocked by:** S48.

**What to build:** Drive the controller's built-in test-data mode (set colour / rgb cycle /
colour fade; per-port or per-pixel) from the controller panel — with a LOUD takeover state while
active (banner on the panel + warning tone on the output pill: the controller is ignoring live
Art-Net) and one-click "back to live data". Auto-revert on panel close/disconnect.

**Acceptance criteria:**
- [ ] Test patterns start/stop from the panel (fake-backed test; hardware spot-check item)
- [ ] Takeover state visible on panel AND output pill the entire time a pattern runs
- [ ] Back-to-live single click; auto-revert on disconnect verified

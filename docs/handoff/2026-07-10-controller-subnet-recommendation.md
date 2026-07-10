# Handoff — Controller subnet recommendation + Adopt-by-IP + global font bump

**Date:** 2026-07-10
**Branch:** `feat/controller-subnet-recommendation`
**Status:** Code + tests + typecheck green. **OWED: live `pnpm ui-shot` verification** (blocked on the Windows box — the ui-shot harness `waitForFunction` timed out here; finish it on the Mac where ui-shot works).

---

## Why

The PixLite A4 wasn't being seen by the app. Root cause is **not** an API problem — the app's PixLite client is read-only + identify + test-patterns (it deliberately does **not** use the PixLite `configChange` API to set the controller's IP; see ROUTER "PixLite v1 read-only" decision). Discovery is a **unicast subnet sweep** (`@ledrums/io` `sweep` → `probe GET /ver`), whose candidate `/24` is derived from the output host/iface, falling back to the machine's local NIC subnets. So if the controller sits on a different subnet than the PC, it is never probed → "different IP addresses".

Trent asked for two things:
1. The app should **tell the user which subnet/IP to set the controller to**, based on the network adapter it's using — and let the user **select the adapter** the PixLite is plugged into.
2. **Increase every UI font by 2 points.**

## Decisions locked (via AskUserQuestion)

- **Recommendation form:** *Specific IP + mask* — compute a concrete free-ish host in the selected adapter's subnet (e.g. `192.168.1.50` / `255.255.255.0`), not just a subnet range. Computed **server-side** (one tested implementation); the web is a pure renderer.
- **Adopt-by-IP:** *Yes* — a manual "type an IP and Adopt" field, so you can connect to a known controller even when Discover can't see it (still on a different subnet / across a router / simply missed).

---

## What was built

### 1. Font bump (global, +2px)
`apps/web/src/styles/tokens.css` — every `--text-*` step raised +0.125rem (+2px) with px annotations updated. Interpreted "2 points" as **+2px additive per step**. Verified nothing in the web UI hardcodes a font-size outside the token scale (grep clean), so it lifts the whole UI uniformly. `docs/design-system.html` regenerated.

### 2. Network-adapter recommendation feature (4 layers)

**Protocol** — `packages/protocol/src/index.ts`
- New `NetworkAdapter` interface (`name, address, netmask, cidr, subnet, recommendedIp`).
- Client msg `{ t: 'listNetworkAdapters' }` (pure read); server reply `{ t: 'networkAdapters', adapters }`.

**Server**
- `apps/server/src/network-adapters.ts` (NEW) — `listNetworkAdapters(enumerate?)` enumerates non-internal IPv4 NICs; pure `recommendControllerIp(address, netmask)` picks a memorable in-subnet host avoiding the PC's own address + network/broadcast/`.1`. OS table injected for tests.
- `apps/server/src/network-adapters.test.ts` (NEW) — 10 tests (recommendation math incl. /24, /16, /29, /31, self-avoidance; enumeration incl. loopback/IPv6 skip, legacy-family, parse-failure skip).
- `handlers/client-message.ts` — `listNetworkAdapters` added to `UNGATED_NON_INPUTS` (a read; viewers allowed), new `listNetworkAdapters?()` dep, reply-to-sender branch.
- `main.ts` — wires `listNetworkAdapters: () => listNetworkAdapters()`.
- `ws-protocol.ts` — re-export `NetworkAdapter`, added to `CLIENT_TYPES`.
- Handler tests +3 (`client-message.test.ts`): replies to sender, ungated (viewer gets it), empty when no enumerator.

**Web**
- `ws/protocol-types.ts` — re-export `NetworkAdapter`, `networkAdapters` in `SERVER_TYPES`.
- `ws/client.ts` — `onNetworkAdapters` callback + dispatch case.
- `trigger-lab/controller-monitor.svelte.ts` — `adapters` state, `ingestNetworkAdapters`, `requestNetworkAdapters`, `recommendationFor(iface)` (iface-bound adapter wins, else first).
- `trigger-lab/store.svelte.ts` — `onNetworkAdapters` wiring; getters `networkAdapters` / `controllerRecommendation`; forwarder `requestNetworkAdapters()`.
- `store.controller.test.ts` — +3 tests (ingest, ungated request, recommendation picks iface-bound then first).

**UI**
- `PatchControllerInspector.svelte` — requests NICs on mount; **Interface free-text → adapter `Select`** (detected NICs + "Default (auto)"; a persisted-but-unknown iface preserved as a "(manual)" option); passes `recommendation` to the status panel.
- `OutputStatusPanel.svelte` — threads `recommendation` through.
- `ControllerStatusPanel.svelte` — **recommendation card** ("Put the controller on your subnet" → PC adapter + `Set the A4 to <ip>` + copy button + mask/subnet hint) and **Adopt-by-IP** field (input + Adopt, placeholder pre-fills the recommended IP), both shown in the **un-adopted** branch and under the **LOST** alert. Applied `/make-interfaces-feel-better`: press-scale `0.96`, entrance matching the sibling `.alert`/`.takeover` callouts, tabular/mono IPs, tokened colors.
- `styleguide/sections/SectionComposites.svelte` — controller demo stubs now pass a `recommendation` so the design system documents the new card + Adopt-by-IP.
- `app/shot-seam.ts` — `mockController` gained a `discover` kind (un-adopted state) so ui-shot can capture the recommendation card + Adopt-by-IP in the real app: `--state "controller:discover"`.

---

## Gates (green)

- `pnpm typecheck` — **0 errors** (all packages; web svelte-check 2464 files).
- `pnpm --filter @ledrums/server test` — **239 passed** (incl. new network-adapters 10, handler +3).
- `pnpm --filter @ledrums/web test` — **1417 passed** (incl. store.controller +3).
- `pnpm design-system` — rebuilt `docs/design-system.html`.

---

## OWED — finish on the Mac

The `pnpm ui-shot` captures did **not** complete on Windows (harness `waitForFunction` timed out — environment, not code; the dev server itself served 200). Run on the Mac:

```bash
# un-adopted: Discover + recommendation card + Adopt-by-IP
pnpm ui-shot --state "controller:discover" --target "Controller status" --name controller-recommend-discover --settle 800

# lost/needs-password: subnet guidance under the LOST alert
pnpm ui-shot --state "controller:needs" --target "Controller status" --name controller-recommend-lost --settle 800

# adopted + healthy (regression — panel unchanged in this state)
pnpm ui-shot --state "controller:auth" --target "Controller status" --name controller-adopted
```

If `--target "Controller status"` still won't resolve, run `pnpm ui-shot --discover --state "controller:discover"` to get the exact target string (the panel is `<section aria-label="Controller status">`; try `role:region[name='Controller status']`).

**Also eyeball:** the +2px font bump across the app (perform/objects/sections/trigger/patch), and the adapter `Select` in the Patch → Controller inspector's Interface row.

**Real-hardware spot-check (with an actual A4):** set the PC and A4 on different subnets → the recommendation card should name the PC's adapter + suggest an in-subnet IP; set the A4 to it → Discover finds it (or Adopt-by-IP connects directly). Confirm the adapter dropdown selection updates the recommendation to that NIC.

---

## Not done (intentionally)

- We still do **not** write the controller's IP via the PixLite API. Changing the box's IP remains a manual step (Advatek Assistant / the controller's own web UI, or set the PC/adapter to the box's subnet). The app now *guides* that step; it does not perform it. If we ever want in-app IP assignment, that's a separate feature using the PixLite `configChange` `net.ipMode`/`net.staticIpAddr` API (doc §, lines 633–634/851) — deliberately out of scope per the locked "read-only" decision.

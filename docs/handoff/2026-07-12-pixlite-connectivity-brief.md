# Briefing: Diagnose PixLite connectivity drops (for the Claude instance on the drummer's PC)

**Date:** 2026-07-12
**Problem statement:** The LEDrums app cannot *maintain* a connection with the PixLite controller — it connects (or discovers/adopts) but the app's controller status keeps flipping to LOST / unreachable. You are on the same machine as the running app AND on the same LAN as the controller, so you can test both planes directly. Your job: find out **why the app's management-plane polling to the controller fails intermittently**, and report the evidence back.

---

## 1. The hardware

- **Controller:** Advatek **PixLite A4 Mk3**, running in **expanded mode**, dense pixel routing.
- **Kit pixel counts (authoritative):** Kick 196, Snare 108, Tom1 108, Tom2 136 → 548 pixels total ≈ 1,644 RGB channels ≈ 4 DMX universes.
- The full **PixLite Mk3 API v1.7 doc** is in the repo at `docs/pixlite-api/PixLite Mk3 API v1.7 (20251009).md` (the repo should be on that machine — the app runs from it).

## 2. What "connection" means in this app — two independent planes

**There is no persistent TCP connection to the controller.** "Connected" in the app is a *derived status*, and it can only be lost on one plane:

### Plane A — pixel data (Art-Net over UDP, fire-and-forget)
- The Node server sends ArtDmx packets over UDP to the controller, **port 6454**, one packet per universe per frame, from `packages/io/src/artnet.ts`. No ACKs, no connection, cannot "drop" from the app's perspective.
- Optionally bound to a specific local NIC (`iface` output setting) so packets leave the right adapter on a multi-NIC machine.

### Plane B — management/health (PixLite HTTP API, polled) ← **this is what "loses connection"**
- The server holds one `HttpPixliteClient` (`packages/io/src/pixlite/client.ts`) for the adopted controller and polls **`statisticRead` every 1.5 s** — but **only while someone has the Monitor/Patch controller panel open** (no watchers ⇒ zero traffic).
- **Any single failed poll (error OR timeout) immediately flips the status to unreachable/LOST** (`apps/server/src/controller-monitor.ts`, `pollOnce`). There is no retry/grace window — one 2-second timeout = LOST in the UI. `lastSeen` freezes and ages.
- So "cannot maintain a connection" = **individual HTTP requests to the controller's port-80 API are intermittently failing or timing out**.

## 3. Exact wire protocol the app uses (replicate this yourself)

**Unauthenticated identity probe** (used by discovery + adopt + first poll):

```
GET http://<controller-ip>/ver
```
Expected: HTTP 200, JSON with `"resp":"version"` and `result.prodName/nickname/fwVer/authReqd`.

**Authenticated management call** (the 1.5 s poll):

```
POST http://<controller-ip>/v1.7/?user=admin&auth=<AUTH>
Content-Type: application/json
Connection: close

{"req":"statisticRead","id":1,"params":{"path":[""]}}
```

- `<AUTH>` = `Base64URL(SHA256(password))`, no padding. For the **default empty password** it is the well-known constant:
  `47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU`
- Expected: HTTP 200, JSON `{"resp":"statisticRead", "id":1, "result":{"statistic":{...}}}`. A JSON `err` object means an API-level error (e.g. bad auth) — that is *different* from a network failure and would be a steady failure, not intermittent.
- **Member order in the request JSON matters** (`req` before `id` before `params`) — keep the body exactly as above.
- The app uses a **2000 ms per-request timeout** and a **400 ms timeout for discovery-sweep probes**.

**Two hard-won protocol facts already baked into the app (don't rediscover them):**
1. **The controller closes its TCP connection after every response** (API doc §4.4). A client reusing keep-alive sockets gets timeouts/ECONNRESET on the *next* request. The app forces one connection per request with `Connection: close` and no agent. If you script your own poller, do the same (`curl` does this naturally per invocation).
2. **Requests to one controller must be strictly sequential** — never two management requests in flight at once. The app enforces this with an internal queue.

Curl one-liners (Windows `curl.exe` works fine):

```bash
curl -s -m 2 http://<IP>/ver

curl -s -m 2 -H "Content-Type: application/json" \
  -d "{\"req\":\"statisticRead\",\"id\":1,\"params\":{\"path\":[\"\"]}}" \
  "http://<IP>/v1.7/?user=admin&auth=47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU"
```

## 4. How discovery/adoption works (in case adoption itself is flaky)

- Discovery is a **unicast sweep of /24 subnets** (probe `GET /ver`, 400 ms timeout per host) derived from the configured output host/iface, falling back to the PC's local NIC subnets. **If the controller is on a different subnet than the PC, it is invisible to discovery** — this was the root cause of a previous "can't see the A4" episode (2026-07-10). The app now shows a recommendation card ("set the A4 to <ip>") and has manual Adopt-by-IP.
- The app is **deliberately read-only** against the controller: statisticRead, identify, test patterns, mode-live only. It **never** writes network config (`configChange`) to the box. Changing the controller's IP is manual (Advatek Assistant or the controller's own web UI).
- The adopted `{host, nickname, auth-hash}` persists on the Project and rehydrates on server restart.

## 5. What to look at on the app side (same machine as you)

- The app's **Monitor view** (left rail) logs every poll failure as `Controller poll failed (unreachable)` **with the underlying error message** — this detail string is the single most valuable datapoint. Distinguish:
  - `timed out after 2000ms` → controller up but slow/unresponsive on port 80, or packets lost.
  - `ECONNRESET` / socket hang up → TCP established then killed (controller HTTP stack under stress, or something else on its single-connection HTTP server).
  - `EHOSTUNREACH` / `ETIMEDOUT` at TCP level / ARP failures → L2/L3 problem (link drop, IP conflict, subnet/DHCP change).
  - HTTP non-200 or PixLite `err` JSON → auth/config problem (steady, not intermittent).

## 6. Ranked hypotheses — test in this order

1. **Baseline reachability & its stability.** Continuous `ping -t <IP>` for several minutes while the app runs. Any loss bursts? Check `arp -a` for the controller's MAC before/after a drop — a **changing MAC = IP conflict**; a vanishing entry = link/L2 drop.
2. **Soak-test the management plane exactly like the app does:** loop the `statisticRead` curl every 1.5 s for 10–15 min, log timestamp + HTTP code + latency (`curl -w "%{time_total}"`). Measure the failure rate and latency distribution. If p95 latency approaches/exceeds 2 s, the app's fixed 2 s timeout is the proximate cause and the finding is "controller answers slowly under X".
3. **Correlation with the Art-Net stream.** Run the soak twice: once with the app actively rendering (UDP frames flowing at full rate to :6454) and once with the app's output stopped. If HTTP only fails under pixel load, the controller's HTTP server is starving under the UDP stream (then check frame rate / packet rate the app is producing; consider whether output settings use broadcast vs unicast — broadcast spams every device on the segment).
4. **Competing management clients.** Is **Advatek Assistant** (or a browser tab on the controller's web UI) open on any machine? The controller's HTTP stack is single-connection-oriented; a second client hammering it can starve the app's polls. Close everything else and re-run the soak.
5. **DHCP / addressing drift.** Is the controller on DHCP? A lease change mid-session makes the adopted (persisted) IP stale → permanent LOST until re-adopt. Check the controller's current IP vs what the app has adopted. Static IP on both the controller and the PC's NIC for the LED subnet is the recommended end state.
6. **Windows NIC power management.** On the drummer's PC (Windows): Device Manager → the NIC's Power Management tab ("Allow the computer to turn off this device"), and Energy-Efficient-Ethernet/Green-Ethernet in Advanced properties. These cause exactly this intermittent-drop signature, especially on an otherwise idle direct link.
7. **Physical/link.** Cable, switch port, controller power (dense pixel loads brown-out cheap PSUs; the statisticRead response itself includes `dev.bankVolt` and temperature — read them from your successful polls and check they're sane and stable).

## 7. What to report back

1. The exact **error strings** from failed polls (yours and the app Monitor's), with timestamps.
2. **Failure rate + latency distribution** from the soak test, with vs without pixel output running.
3. Ping/ARP stability results, controller's current IP + how it's assigned (DHCP/static), PC NIC config.
4. Controller health from successful `statisticRead`s: temperature, bank voltages, per-universe rx counters (`inGood`/`inBadSeq`/`timedOut`), and in/out frame rates.
5. Whether any other management client was in play.
6. Your verdict: which layer fails (L2 link / IP addressing / controller HTTP under load / competing client / app timeout too tight), with the supporting evidence.

**Do not** change the controller's configuration (IP, output config) without flagging it first — the app deliberately treats the controller as read-only, and Trent should sign off on any config change. Identify (LED flash) and test patterns are fine.

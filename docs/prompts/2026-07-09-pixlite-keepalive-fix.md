# Addendum for the trivial-fixes agent: retraction + PixLite fix #8

## Retraction — wire colours

Disregard the earlier orchestrator directive to "restore EVERYTHING that 5d29eeb commented out". That was wrong: **Trent commented the wire-edge role colours out himself — wire edges stay grey / uncoloured.** Follow the direction Trent gave you directly in this pane about the GraphCanvas block (his instructions supersede both the orchestrator message and item #1 of `docs/prompts/2026-07-09-trivial-fixes-impl.md` wherever they conflict). The non-colour parts of item #1 stand as you already agreed with him: delete the dead commented-out CSS remnants, and add the handle `aria-label`s in `TriggerNode.svelte`.

## Fix #8 — PixLite: disable HTTP keep-alive (spec §4.4)

This was sent earlier via twux message but never landed; here it is as a file.

**Symptom:** stats reads fail on real hardware while the `GET /ver` probe succeeds (controller detected, then "stats unavailable").

**Root cause (from the diagnosis agent, verified against the PixLite Mk3 HTTP API spec):** the `statisticRead` request itself is byte-for-byte correct (body, member order, method, path, auth hash, id). The failure is at the socket layer: spec §4.4 says an HTTP client *should close its connection after a response if it has no next request ready* — the embedded controller closes per-response, but Node ≥19's global agent defaults to `keepAlive: true`, so the first `statisticRead` POST after the adopt-probe reuses a socket the controller already closed → timeout / `ECONNRESET`. Unit tests can't catch it because Node's test HTTP server handles keep-alive fine.

**Fix:** in `packages/io/src/pixlite/client.ts`, `nodeHttpTransport` (~line 49): disable keep-alive — pass `agent: false` (or a shared `new http.Agent({ keepAlive: false })`) and add `Connection: close` to the request headers. Spec-compliant regardless of whether keep-alive is the confirmed root cause. Update any `packages/io` tests that assert request headers. Run the io package tests.

**Also include in the commit:** the uncommitted hardware probe script at `scripts/pixlite-probe.mjs` (usage: `node scripts/pixlite-probe.mjs <controller-ip> [port] [password]` — isolates keep-alive vs path vs auth vs genuine silence against the real controller).

**Commit message:** `fix(pixlite): disable HTTP keep-alive per spec §4.4`

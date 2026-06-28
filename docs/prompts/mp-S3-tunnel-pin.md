# Slice S3 — Remote access: tunnel + PIN

_PRD: `docs/plans/2026-06-28-multiplayer-tauri-prd.md` · ready-for-agent · Blocked by: S1 (independent of S2 — runs in parallel)_

Use the `/implement` skill. You are in a git worktree — read `docs/prompts/_worktree-note.md` first. **Do NOT touch `packages/core`.**

## What to build
Let a remote browser reach the locally-running server through an **outbound Cloudflare tunnel** (no inbound port opened, no account), gated by a **room PIN**. On boot the server starts the tunnel and surfaces the public URL; a joining client must supply the correct PIN before it can view or edit.

End-to-end: start the server → it prints/exposes a `https://<id>.trycloudflare.com` URL + a PIN; open that URL from another network, enter the PIN, and join as a live viewer (frames + state). A wrong/absent PIN is refused.

## Scope (current pointers — verify)
- **`apps/server/src/tunnel-manager.ts`** (NEW) — manages `cloudflared` as a child process with the process behind an **injectable interface** (so it's unit-testable). Two modes selected by config:
  - **quick (default):** `cloudflared tunnel --url http://localhost:<port>` — parse the `https://*.trycloudflare.com` URL from stdout.
  - **named (optional):** driven by a configured token/hostname for a stable URL — same manager, different spawn args + credentials. Switching is config, not a call-site change.
  Lifecycle: `start()` → resolves the URL; `stop()` → tears down; report on unexpected exit/crash.
- **`apps/server/src/main.ts` / `boot.ts`** — start the `TunnelManager` on boot (behind a config flag so plain `pnpm dev` can opt out); expose the resolved URL to the UI (e.g. on the `state` message or a small status field/endpoint).
- **PIN gate** — require a room PIN to complete a WS session. Add a connect-time auth step (e.g. `ClientMessage` `{ t: 'auth'; pin }` handled before any view/edit, or a PIN in the connect URL query/fragment validated on `connection`). Connections without the correct PIN are refused (close with a clear code) before they can receive state/frames or mutate. The PIN value comes from server config/env (generated per run if unset) and is surfaced alongside the URL.
- **Web** — a minimal PIN-entry gate before the session is usable, passing the PIN on connect (`apps/web/src/lib/ws/client.ts` + a small gate UI). A basic surface of the share URL + PIN (the prominent in-shell surface is S4/Tauri).

## Acceptance criteria
- [ ] On boot (tunnel enabled), the server starts a cloudflared **quick** tunnel and resolves the public `https` URL.
- [ ] **Named** tunnel works via config (token/hostname) with no call-site code change.
- [ ] A WS session requires the correct room PIN; a wrong/missing PIN is refused before any view/edit/frames.
- [ ] The resolved URL + PIN are available to the UI.
- [ ] `pnpm dev` (tunnel disabled by config) still works unchanged for local dev.
- [ ] Tunnel/PIN failures are reported, not silent.

## Tests to write
- **`apps/server/src/tunnel-manager.test.ts`** (unit, fake child-process): selects the correct spawn for quick vs named mode; parses the URL from stdout; `stop()` tears down; an exit/crash is reported.
- **Server PIN gate**: a connect with a wrong/absent PIN is refused; a correct PIN admits the session (handler/integration harness).

## Verify
`pnpm typecheck` (0) and `pnpm test` (green; add the new tests). The actual cloudflared reachability is verified live by the orchestrator (manual), not in unit tests. Report commit SHA(s) + files.

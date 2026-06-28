# Slice S4 — Tauri desktop app

_PRD: `docs/plans/2026-06-28-multiplayer-tauri-prd.md` · ready-for-agent · Blocked by: S1, S2, S3_

Use the `/implement` skill. You are in a git worktree — read `docs/prompts/_worktree-note.md` first. **Do NOT touch `packages/core`.** No native addons / node-gyp in the app code (cross-platform non-negotiable still holds); Tauri itself is the desktop shell.

## What to build
A double-click **Tauri desktop app** the (non-technical) drummer runs: it boots the node server (as a sidecar) serving the built web UI, starts the Cloudflare tunnel (S3 `TunnelManager`), and shows the shareable **URL + PIN** prominently. Quitting stops everything cleanly. Authored state persists to the local filesystem (the existing server autosave), relocated under the OS app-data directory so a packaged app persists across restarts.

End-to-end: double-click the app → it shows the URL + PIN → the drummer and Trent join → edits persist locally → quit cleanly stops server + tunnel.

## Scope (current pointers — verify)
- **`apps/desktop`** (NEW Tauri app) — the Tauri shell:
  - Runs the existing node server as a **sidecar** and serves the built `apps/web` UI from it (single origin → UI + WS share the tunnel).
  - Starts the `TunnelManager` (S3) on launch; surfaces the resolved **URL + PIN** prominently in the shell window.
  - Clean shutdown: stop the server + tunnel on quit.
  - Bundle/resolve the `cloudflared` binary as a sidecar resource.
  - Tauri config + `package.json` scripts (dev + build/bundle). Mac-first target with **signing/notarization** configured so the drummer can open it without Gatekeeper friction. Keep the build cross-platform (Trent can run it too).
- **Persistence** — make the server's projects/show-library directory (`PROJECTS_DIR`, currently `projects/`) configurable so the packaged app writes under the OS app-data dir; wire the Tauri shell to pass that path. (Existing autosave of `projects/*.local.json` + the show library is reused — do not change its logic.)

## Acceptance criteria
- [ ] Double-clicking the built app launches the server + tunnel + serves the UI, and shows the URL + PIN prominently.
- [ ] Quitting the app cleanly stops the server and the tunnel (no orphaned processes).
- [ ] Authored state persists to the local FS under the app-data dir and survives an app restart.
- [ ] The Mac build is signed/notarized and opens without a Gatekeeper block.
- [ ] The build stays cross-platform (buildable for Trent's machine).
- [ ] `pnpm dev` / the non-Tauri server path is unaffected.

## Tests to write
- Mostly **manual** (build + double-click run/quit + persistence-across-restart + Gatekeeper) — covered by the orchestrator's live two-machine checklist.
- Any pure logic introduced (e.g. app-data path resolution, or config plumbing for `PROJECTS_DIR`) gets a small unit test.

## Verify
`pnpm typecheck` (0) and `pnpm test` (green). Document the build/run commands in the app's README. The packaged-app behaviors are verified live by the orchestrator. Report commit SHA(s) + files.

# 02 — Deprecate the desktop loading shell; unify update UX with real progress

> Part of the 2026-07-02 "rock solid" initiative. See [INDEX.md](INDEX.md).

## Problem

The "splash screen/second window" adds no benefit; its screens don't match the app's design
language; it shows the URL-share info at the wrong times (including during updates — the PIN it
shows regenerates after the update restart, so sharing it mid-update hands out a dead PIN). Two
places can download an update (that screen + the settings modal) and neither shows progress.

## Current state (verified 2026-07-02)

- **There is no second window anymore.** `apps/desktop/src-tauri/tauri.conf.json:13-26` defines a
  single `app` window whose `frontendDist` is `../shell` — the *loading shell page* occupies the
  main window, then navigates to the local server URL when ready (`lib.rs` `open_app_window()`
  ~:341). The splash-window capability was removed in `9f7d92b` (2026-06-30). "Deprecate the
  second window" therefore means: **deprecate the shell page as a UX surface**.
- Shell: `apps/desktop/shell/index.html` (styles inlined, **hardcoded hex colors** — not the OKLCH
  tokens from `apps/web/src/styles/tokens.css`) + `apps/desktop/shell/main.js:27-85` (state
  machine: `starting | running | no-tunnel | updating | error`; renders local URL + tunnel URL +
  PIN whenever available — including while `updating`). Bundled by
  `apps/desktop/scripts/prepare-bundle.mjs:48-58`.
- Update flow:
  - Startup check: `apps/desktop/src-tauri/src/lib.rs:417-523` — background task, native dialog
    prompt (:452-466); on accept downloads **with progress callbacks** (:488-509) published as
    `stage:'updating'`, `"Downloading update… {pct}%"` via `publish()` → `boot://status` event +
    `get_boot_status` command. **Only the shell listens.** Restarts on success (:515).
  - Manual check: `apps/web/src/lib/app/chrome/AppSettingsDialog.svelte:20-73` → 
    `apps/web/src/lib/app/desktop-updater.ts` (`check_for_update_now`, `install_update_now`
    commands, lib.rs:87-113). UI shows static strings `'Downloading update...'` /
    `'Restarting to install update...'` (:46-48) — **no progress, ever**, because nothing in the
    web app subscribes to `boot://status`.
  - Server-side info endpoint: `apps/server/src/main.ts:360-490` `/api/update-status`
    (`canInstall:false` — informational for browsers).
- Tauri detection: `desktop-updater.ts:9-15` — dynamic import of `@tauri-apps/api/core`, null in
  browser.
- Share info in the web app proper already exists and is well-behaved:
  `apps/web/src/lib/app/chrome/ShareInfo.svelte:15-21` (popover, gated on `store.tunnel`).

## Root causes

1. Progress events exist (Rust `publish()`), but the only subscriber is a page the user has
   usually already navigated away from.
2. The shell conflates three concerns — boot status, update status, share surface — and renders
   all of them whenever data is present, with its own divergent styling.
3. Two update entry points (startup dialog, settings modal) with different UX and no shared state.

## Proposed design

### One module: `desktop-bridge` (deepen `apps/web/src/lib/app/desktop-updater.ts`)

Make the web app the single UX surface; the Rust side stays the implementation.

- Interface: `bootStatus` (reactive: stage, message, progressPct, localUrl, tunnelUrl, pin,
  version info) + `checkForUpdate()` + `installUpdate()` + `isDesktop`.
- Implementation: subscribe to the existing `boot://status` Tauri event (via
  `@tauri-apps/api/event`, dynamic-imported like `invokeTauri`) and call `get_boot_status` once on
  boot for the snapshot. **Add a structured `progressPct: Option<u8>` field to the Rust
  `BootStatus` struct** (lib.rs) instead of parsing it out of the message string.
- Both consumers (boot overlay + settings modal) read this one module → the two download paths
  become one state, one progress bar, rendered twice.

### Shell reduced to a dumb bootstrap

- Keep the shell page only as the pre-server placeholder: app title + spinner + fatal-error text.
  Remove URL/PIN/update rendering from `shell/main.js` entirely. Navigate to the web app as early
  as the server responds (current behavior).
- Styling: inline the handful of needed token values at build time — have `prepare-bundle.mjs`
  read `apps/web/src/styles/tokens.css` and substitute the shell's CSS custom properties, so the
  shell can't drift from the design system again.
- In-app **boot overlay** (new small component in `apps/web/src/lib/app/chrome/`): while
  `bootStatus.stage` is `updating`, render a token-styled overlay with the progress bar; on
  `error`, render the error. This is where "right information at the right time" is enforced:
  share info (URL/PIN) renders **only** via the existing `ShareInfo` popover, which additionally
  gates on `stage === 'running'` (one-line change).

### Update UX unification

- Startup path: replace the native Rust dialog (`lib.rs:452-466`) with the same in-app flow —
  Rust publishes `updateAvailable` in `BootStatus`; the web `desktop-bridge` surfaces it (toast or
  settings badge); install always goes through `install_update_now`. (Alternative: keep the native
  dialog for the cold-start-before-webview case only. PRD decision; recommend keep-native only
  when the webview hasn't loaded yet, since an update prompt with no UI host needs *somewhere*.)
- Settings modal (`AppSettingsDialog.svelte`): progress bar + percentage from
  `bootStatus.progressPct`, disable the button while downloading, show restart notice.

## Touch list

- `apps/desktop/src-tauri/src/lib.rs` — `BootStatus.progressPct`, drop/gate native dialog,
  (keep `publish()`/`boot://status` as-is)
- `apps/desktop/shell/index.html`, `shell/main.js` — strip to bootstrap; `prepare-bundle.mjs`
  token substitution
- `apps/web/src/lib/app/desktop-updater.ts` → deepened `desktop-bridge` (event subscription)
- new boot-overlay component; `AppSettingsDialog.svelte` progress UI;
  `ShareInfo.svelte` stage gate
- `apps/desktop/src-tauri/permissions/` — event listen permission for the app window if needed

## Tests

- Pure reducer for boot/update state (stage + progress transitions, share-info gating predicate)
  — unit tests in web.
- `desktop-bridge` with a fake invoke/event adapter (null-in-browser path, progress stream path).
- Rust: keep the update task compile-checked; behavior verified by the existing manual OTA runbook
  (`pnpm ota`). Add a spot-check item: mid-download progress visible in settings modal AND overlay.

## Decisions (LOCKED 2026-07-02)

- **Fully in-app** (Trent's call): kill the native startup dialog entirely. Startup check surfaces
  an in-app badge/toast ("Update available — install & restart"); download/install only on user
  action, progress in the boot overlay + settings modal via `desktop-bridge`. Never interrupts a
  boot; never auto-restarts.

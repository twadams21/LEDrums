# Group C — Desktop shell & updates (issue #48, lane 4)

Lane-4 orch group report. Branch: `group/C` (off `rock-solid` @ `ed2b19e`; integrated with
`rock-solid` @ `ba391ca`; head `ea001c5`). Three slices; S06 tracer then S07 ∥ S08 parallel.
Context: [doc 02](../../plans/2026-07-02-rock-solid/02-desktop-shell-updater.md).

## Slices

- **S06 — Boot progress field + desktop-bridge** (`slice/S06` @ dba5884, impl `S06-desktop-bridge`,
  opus/high): Rust `BootStatus.progressPct: Option<u8>` from the updater byte callbacks (no message
  parsing); deepened `desktop-updater.ts` → reactive `desktop-bridge.svelte.ts` (singleton
  `desktopBridge`: `bootStatus`, `isDesktop`, `checkForUpdate`, `installUpdate`, idempotent `start`)
  over an injectable adapter seam + pure `boot-reducer.ts`. Fake-adapter tests in jsdom. No UI change.
- **S07 — Settings update progress + in-app badge** (`slice/S07` @ 7fa98a4, impl
  `S07-settings-progress`, opus/medium): killed the native OS update dialog (lib.rs) — startup now only
  publishes `updateAvailable`; single `UpdateControl` runs check→install with a streamed progress bar
  (relocated the download from startup→user-triggered install); `UpdateBadge` in the TopBar opens the
  same flow. Install only on user action; never auto-restarts.
- **S08 — Boot overlay + shell reduction + share gating** (`slice/S08` @ 0eb1b69, impl
  `S08-boot-overlay`, opus/high): reduced the native shell to a dumb bootstrap (spinner + fatal error);
  `prepare-bundle.mjs` now generates `shell/index.html` from a template + `tokens.css` (zero hardcoded
  hex — drift-proof); token-styled `BootOverlay` (starting/updating+progress/error) driven by the S06
  bridge; `ShareInfo` gated on `stage==='running'` (no dead mid-update PIN). Styleguide demo + regen.

## Merges

- S06 → group/C fast-forward. S07 → group/C fast-forward (group unchanged since S06).
- S08 → group/C true 3-way, **clean** — S07/S08 file ownership was fenced disjoint (S07: lib.rs,
  AppSettingsDialog, UpdateControl/Badge, TopBar; S08: shell/, prepare-bundle, BootOverlay, ShareInfo,
  App.svelte). Only nominal shared file was `design-system.html`, which S07 deliberately left untouched.
- `rock-solid` (@ ba391ca, master tracker commit) merged into group/C — clean (docs only).
- Integrated full sweep (S07+S08 combined): **typecheck 0** (6 pkgs) · **all green, 0 skips** —
  web 1104 · server 204 · core 548 · io 13 · protocol 1 · desktop 6 (node:test shell-tokens).

## Group review (full diff vs doc 02 + slice files + AGENTS.md)

Verdict: **PASS after one review fix (below).**

- 🔴 **Finding (fixed) — desktop detection false-positived in every browser.** S06's
  `loadTauriAdapter` inferred desktop from whether `import('@tauri-apps/api/core')` resolved — but that
  package is an installed dep, so the import succeeds in a plain browser too → `isDesktop` went true
  everywhere → S08's `BootOverlay` permanently covered the web app (a first-class browser surface:
  WebMIDI, `pnpm start`). The fake-adapter unit tests never exercised the real detection, so it passed
  every gate. **Caught by the mandated live smoke-load, not vitest** (the app rendered only "Starting
  LEDrums"). Fix (`ea001c5`, lane-orch direct — small + fully understood): guard on the Tauri runtime
  global `window.__TAURI_INTERNALS__` (injected on the remote server URL too, via the capability's
  `remote.urls`) + the browser-path regression test the fakes missed. Re-smoke-load: app renders fully,
  no overlay, clean strict console; web reverify typecheck 0 / **1105 tests**.
- Core purity intact (S06–S08 never touch `packages/core`; its 548 tests unchanged). Bridge uses the
  injectable-adapter/fake pattern per the verification contract. Design system engaged (S08 BootOverlay
  demo + regen).
- Acceptance criteria all evidenced in the committed tests + the live smoke-load screenshot.

## Deviations accepted

- S08: `shell/index.html` is now generated + gitignored (source = `index.template.html` + `tokens.css`)
  — the drift-proof seam doc 02 asked for. Desktop pkg gained a `node:test` script (no new dep).
- S07: the update progress bar was kept local to `UpdateControl` (not promoted to the design system) to
  avoid a parallel `design-system.html` collision with S08. It is token-styled + self-contained.
  **Minor coherence follow-up** (non-blocking): consider promoting a shared progress-bar primitive later.
- No `ui-shot` for the S07 surfaces (desktop + update-availability gated — unrenderable in a plain
  browser); covered by component tests.

## 🟡 LIVE SPOT-CHECK for the final gate (per doc 02's verification contract — defers desktop runtime)

Cannot be verified without a signed desktop build; **do NOT block the group**, verify at the final gate
via the manual OTA runbook (`pnpm ota`):
- Mid-download: the streamed progress % shows in BOTH the settings `UpdateControl` and the `BootOverlay`.
- The remote-loaded web app actually receives `boot://status` (confirms the `core:default` event-listen
  grant reaches the `remote.urls` context) — overlay transitions starting→running on real boot.

## Context pack for dependent groups/lanes

- Boot/update is now app-root infra: `App.svelte` calls `desktopBridge.start()` once + mounts
  `<BootOverlay active={desktopBridge.isDesktop} …>`. Anything reading boot/update state uses the
  `desktopBridge` singleton's reactive `bootStatus`; `isDesktop` is the authoritative "are we in the
  desktop shell" flag (now correct in browsers).
- **Group L (S48) still extends the S03 `OutputStatusPanel`** (per group-B's note) — unaffected by C.
- No protocol changes in group C.

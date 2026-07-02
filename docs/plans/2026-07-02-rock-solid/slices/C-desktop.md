# Group C — Desktop shell & updates

Context: [doc 02](../02-desktop-shell-updater.md) · Parent PRD: #45 · Stories: 12–15

## S06 — Boot progress field + desktop-bridge `plumbing`

**Blocked by:** none.

**What to build:** Add a structured progress-percent field to the Rust BootStatus (updater
download callbacks populate it; no message-string parsing). Deepen the web desktop-updater into a
`desktop-bridge` module: reactive bootStatus (stage, message, progressPct, urls, pin, update
availability) from a one-shot status snapshot + subscription to the existing boot-status Tauri
event, plus check/install actions. Null adapter in plain browsers. This module is the single
update/boot state source for S07/S08.

**Acceptance criteria:**
- [ ] BootStatus carries progressPct through download (Rust compiles; event payload verified)
- [ ] desktop-bridge with fake invoke/event adapter: browser-null path, snapshot+stream merge,
      progress stream — unit-tested in jsdom
- [ ] No behavior change yet in UI (bridge consumed in S07/S08)

## S07 — Settings update progress + in-app badge `ui-light`

**Blocked by:** S06.

**What to build:** Settings dialog shows a real progress bar + percentage during update download
(from desktop-bridge), disables the trigger while downloading, and shows a restart notice.
Startup update availability surfaces as an in-app badge/toast ("Update available — install &
restart"); the native OS dialog is removed. Install only ever runs on user action; never
auto-restart.

**Acceptance criteria:**
- [ ] Progress bar reflects streamed percentages (fake-adapter test through the bridge)
- [ ] Native dialog gone; startup check yields badge/toast only
- [ ] Update flow reachable and identical from badge and settings

## S08 — Boot overlay + shell reduction + share gating `ui-significant`

**Blocked by:** S06.

**What to build:** The bundled shell page reduces to a dumb bootstrap (title + spinner + fatal
error only) with its colors injected from the web token file at bundle time — no URL/PIN/update
rendering. The main web app renders a token-styled boot overlay for starting/updating/error
stages (with the progress bar during updates). Share info (URL/PIN) renders only via the existing
ShareInfo popover, additionally gated on the running stage — never during starting/updating.

**Acceptance criteria:**
- [ ] Shell shows no share/update info; token values come from the web token source at build
- [ ] Overlay covers starting/updating/error; share popover hidden unless running (pure gating
      predicate unit-tested)
- [ ] Mid-update: overlay + settings both show progress; PIN nowhere visible
- [ ] Applies `/make-interfaces-feel-better`

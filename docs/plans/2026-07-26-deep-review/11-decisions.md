# 11 — Execution Mandate & Grill Decisions (Trent, 2026-07-29)

The grill session resolving every Trent-owned open question across the 12 synthesis
plans. This document is the execution authority: where it contradicts a plan's text,
**this wins**. Implementers read their plan (`09-synthesis/<init>.json`) plus this file.

## Row approvals

**All 12 initiatives approved, in ranked order** (`10-ranked.json`). INIT-11 remains
blocked behind INIT-04 (main.ts seam). Execution is handed to a fresh orchestrator via
twux handoff; nothing launches from the review session.

**dead-code-0001 (patch copy/paste, 383 lines) stays HELD** — Trent may resurrect the
feature. Do not delete `PatchClipboardToolbar.svelte` / `PatchDiffDialog.svelte`.

## Standing posture (applies to every initiative)

**Greenfield data posture.** Two users (Trent + Tim). No real show files exist yet;
project files are disposable. The repo is the universe — no out-of-repo clients exist.
Consequences: drop legacy fields/aliases outright rather than freeze or migrate;
non-strict-zod strip-on-parse is an acceptable "migration"; no old-version fixture
corpora as acceptance gates. (Memory: `greenfield-data-posture`.)

**Stale test-count gates.** Plans citing 2,981/2,968 are stale by construction — every
executing agent re-measures the collected test count at its own starting HEAD.

## The eight grilled decisions

1. **INIT-01 / legacy dependents: none.** Nothing depends on the legacy engine or its
   14 composition messages. S7 default-flip and S11–S13 fallback deletion all execute.
2. **INIT-01 / legacy Project slices: DROP, no migration machinery.** Remove
   `composition` + `setlist` from the project schema; relocate the one live bit
   (`composition.transport`) to its proper home; old files parse clean via zod strip.
   (Supersedes the plan's freeze-as-read-only assumption — explicit added step.)
3. **INIT-01 / offline preview: RETIRE.** The visualiser shows an honest
   "disconnected" state when the WS link is down; the sim directory dies entirely
   (~400 further lines) rather than surviving as a thin core delegate.
4. **INIT-07 / buildPatchTopology: DELETE** (was the one blocking question).
5. **INIT-07 / zone Inspector arm: RETIRE** — `PatchZoneInspector` + the `zone` arm go;
   zone editing lives in DrumZonesList; a per-zone node returns with its caller if ever.
6. **INIT-08 / acceptance: approved as-is** (moved-line diffs + typecheck + synthetic
   suite + real-kit parse/DMX byte parity; no fixture corpus). **Added scope: collapse
   the migration ladder to a v7 floor** — parse rejects pre-v7, matching zero real files.
7. **INIT-03 / sACN universes: FIX PROPERLY.** `buildDmxMap` becomes protocol-aware —
   sACN emits 1-based universes (0 is spec-invalid), Art-Net stays 0-based. Replaces
   the detect-only audit step; byte-golden tests regenerate; Trent re-checks the
   PixLite patch once on landing.
8. **INIT-04 / boot recovery: BLOCKING BANNER + DISCORD.** In-app acknowledgement
   banner ("recovered from backup — last edits may be missing") plus a telemetry
   report with key `boot-recovery/quarantine` through the existing Reporter → Worker →
   Discord webhook (no new plumbing).

## Approved defaults (veto round — all approved)

- **INIT-03:** faults sticky until re-arm; adapters observe-only (no auto-rebind
  mid-show); no BoundUdpSocket merge; liveness probe = follow-on ticket.
- **INIT-04:** render-loop faults survive the frame (rate-limited errors, never
  auto-blackout); stats broadcast 100Hz → 30Hz; client cap 32 + `LEDRUMS_MAX_CLIENTS`;
  `server-smoke.mjs` lands here, shared programme-wide.
- **INIT-05:** distinct close code **4429** for throttled PIN attempts with honest
  overlay copy (flips the plan's server-only 4401 reuse); PIN stays 6 digits +
  throttle; counters in-memory; global-tier trade accepted with known-good exemption.
- **INIT-02:** collaborators publish as `store.library` / `store.arrangement`; "Saved"
  = local write only; authoring-document store stays a tracked follow-on; Host
  interfaces stay exported.
- **INIT-06:** `'play'` NodeKind alias drops from the authoring union (normalizer keeps
  rewriting on load); no zod persistence-boundary validation yet; NodeView adoption
  gate as planned; projection-signature rebuild cost accepted.
- **INIT-09:** `Overlays.svelte` deletes (second shell died 2026-06-27); MIDI-learn
  pill stays distinct; `aria-label` region convention adopted styleguide-wide;
  human-eyeball before/after ui-shots are the acceptance bar; ControlProps documented
  as a styleguide note.
- **INIT-10:** `test-support/` is the repo-wide convention; lands BEFORE INIT-02; core
  test helpers stay vitest-free (pure `finite01Failures`).
- **INIT-11:** Monitor event only (no TopBar badge yet); client batch cap 900KB;
  dead-letters forensic; one 401 probe per boot accepted.
- **INIT-13:** throwing-form wrapper and `listCanvasScenes` both delete.
- **Programme:** knip is structurally blind to `packages/core`'s barrel-as-entry
  surface — standing caveat on all future automated dead-code sweeps.

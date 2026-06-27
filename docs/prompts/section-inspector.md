# Section settings in the Inspector (rename + read-only recall info)

PRD: `docs/plans/2026-06-27-recall-objects-persistence-prd.md`. Branch base
`feat/unified-shell` (worktree — read `docs/prompts/_worktree-note.md`). **Runs AFTER
`recall-transport` (recall-string helper) AND `graphs-generic` are merged** (it edits
`Inspector.svelte`/`SectionsView.svelte`, which graphs-generic also touches — go after to
keep the merge clean).

## What this delivers
Clicking a section (in the Sections view) drives the **Inspector** to show a **section
panel**: an inline **Rename**, plus the **read-only recall info** — the exact OSC message
(`/ledrums/song_<n>/section <m>`) and MIDI (CC 0 value `<m>`, and the song's Program Change
number) that recall it. Global, not editable — just shown so the operator knows what to send.

## Scope
- Selection: add a **section selection** kind to whatever drives the Inspector (today it's
  node-driven — grep the Inspector's selection/`sel` source and the shell selection state).
  Clicking a section in `SectionsView.svelte` sets that selection (in addition to making it
  the active section). Minimal — reuse the existing selection plumbing; add a `section` case.
- `apps/web/src/lib/app/docks/Inspector.svelte` — a `section` panel: `CommitInput` rename
  (→ `store.renameSection`) + a read-only "Recall via" block built from the
  **recall-string helper** exported by `recall-transport` (OSC + MIDI for this section;
  include the parent song's Program Change number).
- `apps/web/src/lib/app/views/SectionsView.svelte` — clicking a section selects it for the
  Inspector (keep existing activate/highlight behavior).
- Tests: the recall-string rendering for a section (reuse the helper's tests); a store/
  selection test that selecting a section exposes it to the Inspector.

## Gate discipline
Per-package typecheck/test; full sweep on the committed tree. **Svelte MCP** for `.svelte`.

## Acceptance
Click a section → Inspector shows Rename + the correct read-only OSC/MIDI recall strings;
rename persists; full sweep green. (Live `:5173` spot-check owed.)

## Report back
Parent with commit SHA(s), how section-selection drives the Inspector, gate totals,
deviations. Commit before reporting; ROUTER to orchestrator.

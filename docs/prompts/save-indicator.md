# Saving… / Saved indicator in the TopBar

PRD: `docs/plans/2026-06-27-recall-objects-persistence-prd.md`. Branch base
`feat/unified-shell` (worktree — read `docs/prompts/_worktree-note.md`). **Runs AFTER
`shows-server-persist` is merged** (so the indicator reflects the real save path —
localStorage cache + server write). Touches `store.svelte.ts` + `TopBar.svelte`.

## What this delivers
A small **`Saving…` → `Saved`** indicator beside the setlist/Shows button in the TopBar, for
user confidence their work is persisted. **It animates for ≥150ms even when saving is
instant** (the feedback must be perceptible). Apply `make-interfaces-feel-better`.

## Scope
- `apps/web/src/lib/trigger-lab/store.svelte.ts` — a `saveStatus` rune
  (`'idle' | 'saving' | 'saved'`). Flip to `'saving'` when an autosave is scheduled/in
  flight, `'saved'` when it flushes (both localStorage cache + server write, post
  `shows-server-persist`). Enforce a **minimum 'saving' visible duration (≥150ms)** so
  instant saves still show — and hold `'saved'` briefly before returning to `'idle'`.
  Keep the timing logic pure/testable (a small helper), not buried in the component.
- `apps/web/src/lib/app/chrome/TopBar.svelte` — the indicator beside the Shows button: a
  spinner/pulse on `'saving'`, a check on `'saved'`, nothing/subtle on `'idle'`. Use
  existing tokens + lucide icons; respect reduced-motion.
- Tests: the min-duration timer logic (pure) — instant save still yields ≥150ms 'saving';
  idle→saving→saved→idle transitions.

## Gate discipline
Per-package typecheck/test; full sweep on the committed tree. **Svelte MCP** for `.svelte`.

## Acceptance
Editing shows a brief `Saving…` then `Saved` by the setlist button (≥150ms even on instant
saves), reduced-motion respected; full sweep green. (Live `:5173` spot-check owed.)

## Report back
Parent with commit SHA(s), the `saveStatus` API + min-duration approach, gate totals,
deviations. Commit before reporting; ROUTER to orchestrator.

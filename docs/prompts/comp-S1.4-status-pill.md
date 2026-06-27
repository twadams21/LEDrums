# Component pass S1.4 — StatusPill / StatusDot primitive

PRD §S1.3 / §A2. Branch base `feat/unified-shell` (worktree — read `_worktree-note.md`). **PR mapping:**
PRD finding. **Foundation slice (additive — new file + later adoption).**

## What this delivers
A shared status-indicator family for the recurring "state → label + animated coloured dot" pattern. Today
`OutputPill.svelte` (LIVE/SYNC/LOCAL link state) and `SaveIndicator.svelte` (idle/saving/saved) hand-roll
the same idea with different markup. Extract the shared shell so future indicators are one-liners and the
look is editable in one place.

## Scope (new file; this slice does the extraction, adoption is folded into S2.1)
- `apps/web/src/lib/ui/StatusPill.svelte` (+ a small `StatusDot` if cleaner) — props: `tone` (maps to
  `--ok`/`--warn`/`--live`/`--accent`/`--text-muted`), `label`, `pulse?` (animated dot), optional leading
  snippet. Token-driven; reduced-motion safe (respect `--dur-*` collapsing to 0).
- Do NOT delete `OutputPill`/`SaveIndicator` here — S2.1 reworks them onto `StatusPill` (SaveIndicator's
  spinner→check cross-fade may stay bespoke if it doesn't fit the pill cleanly; flag that to S2.1).

## Tests
- Component test: renders each tone + label; `pulse` toggles the animation class; reduced-motion path.

## Gate discipline
Per-package typecheck/test; full sweep on commit. **Svelte MCP / svelte-file-editor mandatory.** Tokens only.

## Acceptance
A reusable `StatusPill` under `lib/ui` covering the OutputPill/connection-state pattern; tested; full sweep
green. (Adoption in S2.1.)

## Report back
Report to parent (orchestrator) with commit SHA, the API, gate totals, and a note on whether SaveIndicator's
cross-fade fits the pill or should stay bespoke. Leave ROUTER to the orchestrator.

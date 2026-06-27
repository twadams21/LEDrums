# Component pass S4.1 — Migrate token aliases + tokenise hardcodes

PRD §S4.1 + §S4.2. Overlay PR **#19** (counts verified). Branch base `feat/unified-shell` (worktree — read
`_worktree-note.md`). **RUN LAST** — after S0.1 (so no doomed file is migrated) and ideally after the
adoption/split slices (so rewritten files aren't migrated twice). Tree-wide style sweep.

## What this delivers
Drops the 8 backward-compat alias tokens and tokenises the remaining hardcoded style values, so the token
system is the single source of styling truth.

## Scope
- **Alias migration** (`git grep "var(--<alias>)"` then replace across all live `<style>` blocks), then
  delete the alias block (lines ~131–141) from `apps/web/src/styles/tokens.css`:
  `--text-dim`→`--text-muted` (**~22**) · `--panel-raised`→`--surface-2` (7) · `--panel-solid`→`--surface`
  (5) · `--border-bright`→`--border-strong` (4) · `--panel`→`--surface` (4) · `--shadow`→`--shadow-2` (3) ·
  `--mono`→`--font-mono` (3) · `--sans`→`--font-sans` (1).
- **Hardcode → token** sweep of remaining live files (skip deleted ones): `120ms`/raw easings → `--dur-*`/
  `--ease-*`; stray `gap`/`padding` px → `--space-*`; any inline z-index → `--z-*`; Dialog/Drawer scrim →
  `--overlay` and icon-button sizes → `--control-icon-size` (both added in S1.6, if not already adopted there).
- Do NOT change rendered values — each alias maps to its current resolved token; verify visually-equivalent.

## Tests
- No logic change; rely on typecheck + Svelte autofixer + a visual diff. Confirm `git grep "var(--panel"`
  etc. returns 0 after the sweep.

## Gate discipline
Per-package typecheck/test; full sweep on commit. **Svelte MCP / svelte-file-editor** for any `.svelte`
touched. After removal, `git grep` for each alias must be empty.

## Acceptance
All 8 aliases gone from `tokens.css` and from every consumer; remaining hardcoded color/space/duration/
z-index tokenised; full sweep green; no visual regression. Closes #19.

## Report back
Report to parent (orchestrator) with commit SHA, per-alias replacement counts, files touched, gate totals,
deviations + any owed visual spot-check. Leave ROUTER to the orchestrator.

# Component pass S1.6 — Token additions + Styleguide refresh

PRD §S1.6 / §A4. Branch base `feat/unified-shell` (worktree — read `_worktree-note.md`). **PR mapping:**
PRD finding (complements #19/S4.1). **Foundation slice.** Touches `tokens.css`, `lib/ui/*` (z-index only),
and `Styleguide.svelte` — coordinate ordering with S4.1 (token sweep) so they don't both edit the same
`<style>` lines.

## What this delivers
Adds the missing tokens the primitives need, adopts `--z-*` inside `lib/ui`, and makes the living styleguide
document the REAL `lib/ui` primitives (it currently shows raw HTML `<button>`/`<input>`/`<select>` and omits
ContextMenu/CommitInput/SaveIndicator/SegmentedControl/Tabs/Slider/Drawer/Tooltip/…).

## Scope
- `apps/web/src/styles/tokens.css` — add `--overlay` (the Dialog/Drawer scrim, currently hardcoded
  `oklch(0.1 0.01 256 / 0.5–0.6)`) and `--control-icon-size` (reconcile the 24/30/32px icon-button
  divergence — pick the canonical, default 30px). Do NOT remove the migration aliases here (that's S4.1).
- `apps/web/src/lib/ui/{Select,ContextMenu,Dialog,Drawer}.svelte` — replace inline `z-index: 75/76/90/95`
  with the `--z-*` semantic scale (`--z-dropdown`/`--z-overlay`/`--z-modal`/`--z-tooltip`); replace the
  hardcoded scrim colour with `var(--overlay)`.
- `apps/web/src/lib/styleguide/Styleguide.svelte` — rewrite the Controls section to import + demo the actual
  `lib/ui` primitives (Button-equivalents, TextField, SearchField, Select, Toggle, Switch, Slider, Tabs,
  SegmentedControl, IconButton, CommitInput, Field, ContextMenu, Dialog, Drawer, Tooltip, Separator,
  Eyebrow, StatusPill). Optionally extract its ~358 lines of inline CSS to `styleguide.css` and split the
  preview sections into sub-components (nice-to-have; keep the route at `/?style` working).

## Tests
- No new logic to unit-test; rely on typecheck + the Svelte autofixer. If you split the styleguide, keep
  `?style` mounting green.

## Gate discipline
Per-package typecheck/test; full sweep on commit. **Svelte MCP / svelte-file-editor mandatory.** Tokens only.

## Acceptance
`--overlay` + `--control-icon-size` exist and are used by Dialog/Drawer/icon-buttons; `lib/ui` has no inline
z-index/scrim hardcodes; `/?style` shows the real primitives; full sweep green.

## Report back
Report to parent (orchestrator) with commit SHA, tokens added, files changed, gate totals, deviations.
Leave ROUTER to the orchestrator.

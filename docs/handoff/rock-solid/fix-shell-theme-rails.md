# Implementer task — Item F: darker theme + flush chrome + adjustable hover-highlight rails

Standalone implementer task from the Rock Solid master orch (Trent direct request). This is **item F** of `docs/plans/2026-07-03-phase2-review/HANDOFF.md`, expanded with Trent's additions. Work on branch `feat/shell-theme-rails` off `rock-solid` in your assigned worktree. Report to your parent (master) via `twux send-message --session parent --status ready`.

## What to build (one cohesive shell/theme pass)

1. **Darker surfaces + background.** Reduce the lightness of the surface/background token scale in `apps/web/src/styles/tokens.css` (currently `--bg` 0.170, `--surface` 0.208, `--surface-2` 0.245, `--surface-3` 0.288, `--surface-inset` 0.155; also `--bg-perform` 0.135). Darken via the TOKENS (the whole scale, keep the relative steps), not per-component one-offs. **Preserve contrast/accessibility** (text + borders must stay legible; check `--text*`/`--border*` against the new surfaces).

2. **Flush high-level chrome modules — remove the gaps between them.** The main modules — **top bar, transport, visualiser, inspector, docks, left rail, right rail (song rail)** — should sit flush with **no gutter/gap** between them. This lives in the app shell layout: `apps/web/src/lib/app/AuthorShell.svelte` (the grid/flex gaps + any panel margins). Module separation should read from the darker surface steps + borders, not whitespace gutters.

3. **Adjustable rails on the module boundaries, including a NEW visualiser↔inspector rail.** Every major boundary the user would want to resize should have a drag rail — **specifically add one in the 3D visualiser / inspector gap** (that boundary is currently not adjustable). Use / extend the existing splitter primitive **`apps/web/src/lib/ui/Splitter.svelte`** (and the existing dock-resize logic in `AuthorShell.svelte`, e.g. `--dock-w`) — do NOT hand-roll a second resize mechanism. Persist sizes the same way the existing rails do.

4. **Rails highlight on hover (discoverability).** Because the modules are now flush (no visible gutter), the resize rails must **show a clear hover affordance** — highlight/thicken/tint on hover (and on active drag) so the user discovers they're adjustable. Keyboard-accessible + `cursor: col-resize`/`row-resize` as appropriate. This is the key interaction detail — get it feeling right (`/make-interfaces-feel-better`).

## Constraints (non-negotiable)

- **Design system:** darken via tokens; any new/changed rail styling that's reusable goes in the styleguide entry (`apps/web/src/lib/styleguide/`) and `docs/design-system.html` is regenerated **in the same change** (`pnpm design-system`) — AGENTS.md rule. The Splitter already has styleguide coverage (`SectionInteraction`/`SectionPrimitives`) — update it if you change the rail's look.
- **Apply `/make-interfaces-feel-better`** — the hover affordance, the transitions, optical alignment of the flush seams.
- **No self-referential `$effect`** (a P0 bug class this session: an `$effect` that reads AND writes the same `$state` → `effect_update_depth_exceeded` → app-wide click freeze). If you add any reactive colour/size resolution, don't read the state you write.
- `packages/core` untouched (this is web-shell only).

## Verify BEFORE reporting

- `pnpm typecheck` (0 errors) + `pnpm test` (no skips). Add/adjust tests where there's a pure seam (e.g. resize clamp/persist logic).
- **LIVE SMOKE-LOAD (mandatory):** `LEDRUMS_ENGINE=voice pnpm dev`, load the app. Confirm + REPORT: (a) no console errors (esp. `effect_update_depth_exceeded`); (b) modules are flush; (c) EVERY resize rail (incl. the new visualiser↔inspector one) highlights on hover and drags/persists; (d) the darker theme reads well with legible text/contrast in both the authoring canvas and panels.
- Regenerate `docs/design-system.html` if you touched the styleguide.

## Report (≤30 lines)

Commit a handoff at `docs/handoff/rock-solid/fix-shell-theme-rails-report.md` (final commit), then `twux send-message --session parent --status ready`. Include: what changed (demoable first), the token deltas, which rails now exist + persist, acceptance evidence incl. your live-smoke-load observations, gates, deviations.

## Branch / commits

Your cwd is your assigned worktree, on `feat/shell-theme-rails` off rock-solid. Commit incrementally (e.g. `shell: darken surface token scale`, `shell: flush chrome modules`, `shell: visualiser↔inspector rail + hover-highlight`). Push opportunistically.

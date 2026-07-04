# Item F report — darker theme + flush chrome + hover-highlight rails

**Branch:** `feat/shell-theme-rails` · **Status:** ready · gates green · live-smoke passed.

## What changed (demoable)
- **Chrome is flush.** Top bar · transport · left rail · center · right dock · Layers dock
  now sit with **no gutter**, separated by their borders + darker surface steps. (screenshot: `shell-full`)
- **Darker theme** across the whole surface/bg scale — reads as a deeper graphite instrument body,
  text/borders stay legible.
- **New visualiser↔inspector rail** — the 3D-preview / Inspector boundary in the right dock is now
  draggable + persists (it wasn't before).
- **Rails announce themselves on hover** — because modules are flush, every resize rail thickens
  (2px→~5px) and tints to accent on hover / focus / drag. (screenshots: `hover-rail-REAL`, `hover-viz-REAL`)

## Token deltas (`tokens.css`)
- New `--shell-gap` (default **0px**) — the single knob for every inter-module gutter (grid gap + nested
  center/dock gaps, previously hard-coded `--space-3`). *(This is Trent's mid-task request.)* Bump it to
  reintroduce a gutter globally.
- Surface scale darkened, relative steps preserved: `--bg` .170→.142 · `--surface` .208→.180 ·
  `--surface-2` .245→.216 · `--surface-3` .288→.258 · `--surface-inset` .155→.128 · `--bg-perform` .135→.112.
  Borders unchanged → now higher-contrast against the darker surfaces (better flush seams).

## Rails (all persist via `store.paneSizes`)
left rail (`authorRailW`) · right dock (`authorDockW`) · Layers dock (`authorBottomH`) · **NEW** visualiser
(`authorVizH`, def 300 / 180–620). Reused the existing `Splitter` primitive + `--dock-w` pattern — no second
resize mechanism.

## Acceptance evidence (live smoke — `LEDRUMS_ENGINE=voice pnpm dev`, headless CDP)
- (a) **No `effect_update_depth_exceeded`**, no exceptions. One benign client-side 404 (missing static asset,
  pre-existing, unrelated to this change).
- (b) Flush: computed grid `gap: 0px`, `--shell-gap: 0px`, center↔dock rects touch. (screenshot confirms all seams)
- (c) All 4 rails present incl. "Resize visualiser"; keyboard resize persisted (`--viz-h` 300→316); **real mouse
  hover** shows the accent-tinted thickened bar on both a vertical (rail) and the new horizontal (viz) rail.
- (d) Darker theme legible in canvas + panels (tokens resolved: `--bg` .142, `--surface` .180).

## Gates
`pnpm typecheck` 0 errors · `pnpm test` 1017 passed (added `Splitter.test.ts`, 6 cases: clamp/step/Home-End/
orientation-map/invert) · `pnpm design-system` regenerated (`docs/design-system.html`) — Splitter demo note +
interaction contract updated for flush/hover.

## Deviations
None. Note: `--shell-gap` defaults to 0 (flush) per the item spec; it's a live knob, so a gutter can be
restored in one place without touching components.

## Commits
`shell: roll inter-module gutter into a single --shell-gap token` · `shell: darker surface scale, flush chrome
(gap 0), viz↔inspector rail + hover-highlight rails` · `test(ui): Splitter clamp + keyboard-report seam` · (this report).

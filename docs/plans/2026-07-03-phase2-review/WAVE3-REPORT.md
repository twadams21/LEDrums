# Wave 3 report — cohesive design pass (remaining items)

Branch `wave-3/design`, continued from the approved-shell commits (bb75c63 / e3a8a90 / 0afac14).
Every UI change verified live via `ui-shot` against a clean local server (see the "gate" note on
the stale-server gotcha). Full gate green at the end: typecheck (all 5 packages, 0 errors),
`pnpm test` (core 548 · io 13 · protocol 1 · server 204 · web 1058, 0 skips), `ui-shot --all
--strict` clean console across all 18 shots.

Commits, in order:
- item D header unification · context menu · item E · item G · items I/D · item D logo · gate.

---

## Item 1 — Header/title unification + icon+tooltip (item D)  ✅
**What changed.** Adopted `ui/PanelHeader` as THE panel-title treatment everywhere a panel/rail/
dock has a title, retiring Eyebrow-as-panel-title (Eyebrow kept for small in-content labels):
- Visualizer "Kit preview" → PanelHeader (new `variant='panel'`; Perform keeps its overlay labels,
  which are legit in-content labels on side-by-side canvases).
- LeftRail "Views" + SongRail "Setlist" → flush PanelHeader-topped panels (de-padded the wrappers).
- ObjectsView master "Objects" + detail head → PanelHeader (new `MasterDetail` `railHeader` snippet
  for a flush rail header).
- SectionsView head: dropped the redundant "Setlist" eyebrow, kept the song-name H2 with an accent
  icon (didn't demote the content title to uppercase-tracked).
- PatchGraphView `phead` → PanelHeader; dropped the implementation-speak flow hint.

Icon+tooltip standardisation: the modulation "invert" control was a `Toggle`+text label while
"disconnect" beside it was an `IconButton` — invert is now an icon toggle button (solid when on),
matching disconnect. One interaction pattern per class.

**Evidence.** `left-rail`, `shell`, `objects`, `sections`, `patch-graph`, `visualizer` shots — all
six panel headers now read identically (accent icon + tracked uppercase + trailing controls).
**Files.** `ui/PanelHeader.svelte` (existing), `ui/MasterDetail.svelte`, `docks/Visualizer.svelte`,
`chrome/LeftRail.svelte`, `chrome/SongRail.svelte`, `views/ObjectsView.svelte`,
`views/SectionsView.svelte`, `views/PatchGraphView.svelte`, `docks/inspectors/ModulationParamsSection.svelte`.

## Item 2 — Play-node params INSIDE the card (item E)  ✅
**What changed.** Exposed modulation-param rows rendered as a bolted-on second card under the node
are now merged into it: `NodeCard` gained a `footer` snippet (one border, one surface, internal
divider, concentric radii) and the rows dropped their own border/surface/shadow/gap. The flow +
mod wire handles moved into a `leadHandles` snippet anchored to the card's HEAD row (head is now
`position:relative`), so a growing footer never drifts the handle %-offsets off the face — the
wave-2 derived-offset fix is preserved, not regressed.
**Evidence.** `trigger-graph` shot — normal nodes (trigger/modifier/play+thumb), handles, wires,
mod-count chip all render unchanged. (The footer only appears on nodes with exposed params, not in
the seed graph; structurally verified + typechecked.)
**Files.** `views/NodeCard.svelte`, `views/TriggerNode.svelte`.

## Item 3 — Node previews live-on-trigger (item G)  ✅ (play + envelope; rest proposed)
**What changed.** A trigger-driven node face is now STATIC until its graph fires, then plays live
from t=0 for one hit, then settles — TouchDesigner parity.
- **Seam (display-only; determinism untouched — a UI timestamp, not engine state):** `store.graphFireAt`
  (per-graph `performance.now()` epoch), set on `hit()` + `fireSectionGraph()`; `selectedGraphFireAt`
  exposes the open graph's epoch. `resolveHitGraphsLocal` now carries the graph key. Pure
  `triggerClock(fireAt, now, windowMs)` in `signal-preview.ts`.
- **Wired:** `EffectThumb` opt-in `triggered`/`triggerAt` (default = the continuous gallery loop, so
  the effect library/add palette are unchanged) with per-fire generator-state reset so confetti-style
  accumulators restart cleanly on each hit. `NodeSignalPreview` envelope is trigger-driven off
  `fireAt`; LFO/CC stay continuous by nature. `TriggerNode` threads `selectedGraphFireAt` into the
  play + envelope faces.
- **`$effect` safety:** the new per-fire reset reads `triggerAt` + generatorId and only WRITES
  `genState` (never reads it) — the app-fatal self-referential read+write loop (HANDOFF #1) stays
  impossible. Kept the shared ticker, viewport gating, reduced-motion static frame.

**Scope, honest.** Play (effect) + envelope land now. LFO/CC deliberately stay continuous (not
trigger-driven). Node kinds still WITHOUT any preview: modifier, switch, chance, toggle, delay,
sequence, "all", random. **Proposed follow-up:** give those a small static glyph/state preview and,
where they gate/route on a hit, a trigger-driven flash — same seam (`selectedGraphFireAt` +
`triggerClock`), so it's additive.
**Evidence.** `signal-preview.test.ts` +4 (triggerClock static/live/settle/skew). Live behaviour
can't be frozen in a single screenshot; verified no console error / no `$effect` halt via
`ui-shot --strict` on trigger-graph/node-editor/objects, and by the unit tests.
**Files.** `trigger-lab/store.svelte.ts`, `trigger-lab/signal-preview.ts`,
`trigger-lab/EffectThumb.svelte`, `views/NodeSignalPreview.svelte`, `views/TriggerNode.svelte`.

## Item 4 — Song Library entry point + microcopy + density (items I/D)  ✅
**Entry point.** Song Library was buried below the fold of Objects → Songs. It's now its own
top-level Objects rail row ("Song Library", LibraryBig icon, live count) — discoverable, Linear-
style. The Songs detail lists only the show songs (paste-song action moved into the panel-header
trail); the library pool has its own view. Evidence: `objects` shot.
**Microcopy.** Stripped build-speak from the modulation hints ("expose a numeric parameter … becomes
a handle you can wire a source into" → "Add a parameter to animate it, then wire an envelope, LFO,
or MIDI source into it"; "No wires yet — …handle" → "Not wired yet — drag a source into this row to
animate it") and the library empty state. Left legitimate node-editor vocabulary (wire/handle/node —
users literally wire nodes) and Monitor's diagnostic text untouched (that surface is FOR diagnostics).
**Density.** Added `--viewport WxH` to `ui-shot` (so the density review — and future agents — can
check 1280×800 vs 1920×1080 without editing the script). Reviewed the shell at both: the approved
Linear-breathing-room shell holds well at each; **no global rescale applied** — a rescale would fight
Trent's approved layout, and Linear deliberately favours breathing room over cramming.
**One candidate for Trent (not applied, judgment call):** the "no voices" Buses/Layers cards carry
noticeable vertical whitespace, but it's data-dependent (fills under voice load), so tightening it
would hurt the loaded state. Worth a look together rather than guessing.
**Files.** `views/objects-view.ts`, `views/ObjectsView.svelte`,
`docks/inspectors/ModulationParamsSection.svelte`, `scripts/ui-shot/ui-shot.mjs`, `objects-view.test.ts`.

## Item 5 — Logo + favicon (item D)  ✅
**What changed.** Replaced the CSS conic-gradient square + placeholder favicon with a geometric mark:
a hoop (ring) carrying three lit pixels at 120° — drum · hoop · pixel — in phosphor-lime on a dark
tile. Reads at 16px, fits the Linear/Resend-dark language. New `ui/Logo.svelte` (inline SVG; ring =
dimmed `--accent`, pixels = `--accent`, so it tracks the theme token) in the TopBar; `public/favicon.svg`
redrawn to mirror it with hardcoded colours. Self-contained, no external assets.
**Evidence.** `top-bar` shot. **Files.** `ui/Logo.svelte`, `chrome/TopBar.svelte`, `public/favicon.svg`.

## User request (mid-session) — trigger-graph context menu  ✅
Right-click any trigger-graph node for Copy · Paste · Duplicate · Delete (with a confirmation
dialog). Node-only clipboard (wires not captured); the fixed Trigger node offers only Paste. New
store surface `nodeClipboard` + `copyNode`/`pasteNode`/`duplicateNode` (cloning via `findFreePosition`
so pastes don't stack). New reusable `ui/ConfirmDialog` primitive (on `Dialog`).
**Tests.** `store.node-clipboard.test.ts` (5: deep-copy isolation, paste clone/no-op, duplicate,
trigger-node refusal). **Files.** `trigger-lab/store.svelte.ts`, `views/TriggerNode.svelte`,
`ui/ConfirmDialog.svelte`, `store.node-clipboard.test.ts`.

## Item 6 — Final gate  ✅
- `pnpm design-system` regenerated `docs/design-system.html`; added PanelHeader, Logo, ConfirmDialog
  demos to the styleguide (`SectionPrimitives`); AddPalette/NodeEditor already demoed in SectionGraph.
- `pnpm typecheck`: all 5 packages, 0 errors. `pnpm test`: core 548 · io 13 · protocol 1 · server 204 ·
  web 1058, all pass, 0 skips.
- `ui-shot --all --strict`: clean console across all 18 shots; each reviewed.

### Surprises / notes
- **ui-shot stale-server trap.** `ui-shot`'s default `UI_SHOT_BASE` is `localhost:5173`; a leftover
  PIN-gated server there was captured first (every shot dimmed behind an "Enter room PIN" modal, and
  the click-based shots timed out on the overlay). Fix: run your own `pnpm dev` on the assigned ports
  and point `UI_SHOT_BASE` at it (`http://localhost:5178`). Worth teaching ui-shot to warn when it
  reuses a server it didn't start.
- **GraphsDock styleguide demo** not added — it's a broad store-bound composite (sections/graphs/
  fireSectionGraph/lastSectionFire/graph-thumb); a faithful stub is a sizeable lift. Proposed as
  follow-up alongside the other composite stubs in `SectionComposites`.
- Lucide `@lucide/svelte/icons/*` imports throw phantom "cannot find module" diagnostics in the
  editor LSP but pass real `svelte-check` cleanly — ignore them; trust the typecheck.

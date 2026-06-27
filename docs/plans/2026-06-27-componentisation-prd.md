# Componentisation Pass — PRD

**Date:** 2026-06-27 · **Branch:** `feat/unified-shell` (HEAD `89bde90`, tree clean)
**Status:** Phase 1 (exploratory) COMPLETE — plan awaiting sign-off. **Do not build until approved.**
**Authoring:** `component-orch-c6dd57` (twux sub-orch) via a 13-explorer haiku fan-out over the whole repo.

---

## 1. Problem & context

The UI shipped four overnight initiatives in a week (unified shell, switch/value routing, trigger-source + sections, CRUD/context/perform, recall/objects/server-shows). That velocity left three kinds of debt:

1. **A whole dead legacy app still in the tree.** The original control app (`lib/shell/` + `lib/store/app-store` + `lib/panels/*` + old `lib/views/*` + `lib/routing/`) was superseded by the unified `lib/app/` shell on the `TriggerLab` store, but never deleted. A static reachability crawl from every real entry point confirms **none of it is reachable** — ~4.3k lines of confirmed-dead code.
2. **Hand-rolled UI that diverges instead of converging.** A real `lib/ui/` primitive library exists (21 components, 11 wrapping bits-ui) but adoption is partial: list rows, inline-rename, status pills, graph palettes, and master-detail layouts are re-implemented per-view, so look & feel can't be edited in one place. There is even a **duplicated `CommitInput`** (`lib/ui/` vs `lib/app/docks/`).
3. **God-files.** `store.svelte.ts` (1888), `sim.ts` (1169), and `Inspector.svelte` (1359) each carry many concerns in one file — hard to navigate, test, and edit safely.

This pass makes the UI **as componentised as possible** so the design language is consistent and editable in one place (bits-ui + `lib/ui/` on the oklch token system), while reaping the dead code and splitting the god-files.

## 2. Goals / Non-goals

**Goals**
- Delete all confirmed-dead code (legacy app + unused primitives).
- Extract the repeated UI patterns into shared `lib/ui/` components and **adopt** them across the live shell.
- Split the three god-files behind their existing public APIs (no behaviour change).
- Converge styling onto tokens (drop migration aliases; remove hardcoded color/spacing/z-index).
- Keep `packages/core` pure and the render loop deterministic (non-negotiables unchanged).

**Non-goals**
- No new product features. No model/behaviour changes. (Splits preserve public APIs and pass the existing suite.)
- No redesign — this is consolidation onto the *existing* tokens/primitives, not a new visual language.
- The `packages/core` Content-vs-Effect model refactor (tracked separately) is out of scope.

## 3. Method & coverage

- Built an authoritative **live/dead reachability graph** by crawling static + dynamic imports from the three real entries (`App.svelte`, `?style` → `Styleguide`, `?proto=trigger` → `TriggerLab`). Every source file is tagged `LIVE-APP` / `LIVE-STYLE` / `LAB-ONLY` / `DEAD?` / `TEST`.
- Partitioned the repo into **13 chunks** and ran **13 read-only explorers** (haiku-4-5-medium, 3 at -high for the deep-split chunks). Each returned a per-file report on four dimensions: **Componentise · Split · Dead code (grep-verified) · Consistency**.
- **Coverage: 262 files explored, each by exactly one explorer** — 260 source `.svelte`/`.ts` (web 144 · server 20 · core 88 · io 8) plus `app.css` + `tokens.css`. Full per-file proof in **Appendix B**. Dead-code claims were each confirmed with a reference grep (false positives are costly).

## 4. Headline findings

| Theme | Magnitude |
|---|---|
| **Confirmed dead code (safe delete)** | **28 files, ~4,365 lines** — legacy app (25 files, 4,110) + unused `lib/ui` Card/Rail/Sidebar (3, 255) |
| **Lab retirement (decision-gated)** | 2 files, **1,667 lines** — `TriggerLab.svelte` + `NodeCanvas.svelte` (only via `?proto=trigger`) |
| **Shared components to extract** | ~9 new `lib/ui` primitives + Inspector → ~11 per-kind editors + ~3 node/graph helpers |
| **Adoption sweeps** | chrome · object/section views · graph views (hand-rolled rows/rename/pills/palettes → primitives) |
| **God-file splits** | `store.svelte.ts` 1888 → ~10 slices · `sim.ts` 1169 → 4 · `Inspector.svelte` 1359 → ~12 |
| **Token migration debt** | drop 8 alias tokens; biggest is `--text-dim` (**22 uses**) |
| **Protocol drift** | web `protocol-types.ts` ⇄ server `ws-protocol.ts` (3 concrete divergences) |

**The single highest-impact, lowest-risk win is deleting the legacy app (P0).** The second is extracting the **row + inline-rename** pattern (duplicated across ≥5 files) into `lib/ui`.

---

## 5. The plan — slices (file-bounded, independently buildable)

Grouped into phases. Each slice names its **files**, **effort** (S/M/L), **deps**, and **acceptance**. Phase-2 will `/to-issues` these into worktree implementer briefs like the prior initiatives. **Gate after every slice: `pnpm typecheck` 0 + `pnpm test` green.**

### P0 — Reap (deletion; touches only dead files → parallel-safe, do first)

- **S0.1 — Delete the legacy app.** Remove the 25 confirmed-dead files (`lib/shell/*`, `lib/store/app-store.svelte.ts`, `lib/panels/*`, `lib/routing/build-routing-graph.ts`, old `lib/views/{ArrangeView,MapView,PerformView,RoutingView,arrange-helpers}`, + the 2 dead tests) **and** the 3 unused `lib/ui/{Card,Rail,Sidebar}.svelte`. ~28 files, ~4,365 lines. **Effort L (mechanical) · deps none · acceptance:** gates green, no dangling imports, `git grep` of each basename returns only self/removed. *Salvage note:* `lib/panels/params.ts` holds pure `throttle`/`tapTempo` — port to `lib/util/` only if a live caller appears; default delete.
- **S0.2 — Retire the trigger-lab probe (DECISION-GATED).** Remove `lib/trigger-lab/TriggerLab.svelte` + `NodeCanvas.svelte` + the `?proto=trigger` branch in `main.ts` (1,667 lines). **The live store/sim/effect-UI stay** (they're `LIVE-APP`). **Gated on Trent confirming the trigger-model branches are settled** — the lab is the model probe and ROUTER still lists that exploration as active. **Effort M · deps none · acceptance:** gates green; `?proto=trigger` route gone.
- **S0.3 — Micro dead-code.** Remove `store.makeBlock` (unused export), server `encodeClient` + `showLibraryExists` + `output-manager.blackout`'s unused `rgbOrder` param (all grep-confirmed test-only/unused), and verify-then-prune underused tokens (`--ink-on-accent`, `--ease-out-expo/quint`, `--leading-tight/normal`, `--tracking-tight`). **Effort S · deps none.**

### P1 — Foundation primitives (additive; mostly new `lib/ui` files)

- **S1.1 — Consolidate `CommitInput`.** Merge `lib/ui/CommitInput` (inline-rename) and `lib/app/docks/CommitInput` (numeric: clamp/suffix) into one `lib/ui/CommitInput` with a `type` prop (or split cleanly into `CommitInput` + `NumericField`); repoint importers; delete the dock copy. **Files:** `lib/ui/CommitInput.svelte`, `lib/app/docks/CommitInput.svelte`, importers (Inspector, chrome). **Effort M · deps none.**
- **S1.2 — `ListItem` + `EditableRow`.** New `lib/ui/ListItem.svelte` (icon + label/sub + actions slot + active/hover states) and `lib/ui/EditableRow.svelte` (ListItem + inline-rename + ContextMenu slot). The row pattern is duplicated in LeftRail/SongRail/ShowBrowser/SectionsView/ObjectsView. **New files only. Effort M · deps none.**
- **S1.3 — `StatusPill` / `StatusDot`.** New family unifying `OutputPill` + `SaveIndicator` (+ lab `StatusBar`): state enum → label + animated colored dot. **New files. Effort S · deps none.**
- **S1.4 — Graph primitives.** New `GraphPalette.svelte` (unify Patch/Trigger add-palettes) + `GraphFitView.svelte` (unify Patch/Trigger fit-on-mount, parameterized padding/watch/onfitted). **New files. Effort S–M · deps none.**
- **S1.5 — `MasterDetail`.** New `lib/ui/MasterDetail.svelte` (left nav rail + scrollable detail list + row slot) shared by SectionsView + ObjectsView. **New file. Effort M · deps none.**
- **S1.6 — Tokens + Styleguide refresh.** Add `--overlay` (Dialog/Drawer scrim) + `--control-icon-size`; adopt `--z-*` inside `lib/ui` (Select/ContextMenu/Dialog/Drawer hardcode z-index); rewrite `Styleguide.svelte` to demo the **real** `lib/ui` primitives (currently shows raw HTML controls; missing ContextMenu/CommitInput/SaveIndicator/SegmentedControl/Tabs/Slider/…) and extract its 358 lines of inline CSS. **Files:** `styles/tokens.css`, `lib/ui/*` (z-index only), `lib/styleguide/Styleguide.svelte`. **Effort M · deps none.**

### P2 — Adopt primitives (touch live UI; grouped by file-owner to avoid worktree conflicts)

- **S2.1 — Chrome adoption.** TopBar/SongRail/LeftRail/ShowBrowser/Transport adopt `EditableRow`/`ListItem`/`StatusPill`/`IconButton`/`Field`/`CommitInput`; remove the bespoke row/rename/pill markup. **Files:** `lib/app/chrome/*`. **Effort L · deps P1 (S1.1–S1.3).**
- **S2.2 — Object/Section views adoption + split.** SectionsView + ObjectsView adopt `MasterDetail` + `EditableRow`, extracting `GraphRow`/`ObjectRow`/detail panes (drops each from ~520 → ~150–300 lines); PerformView `.chip` → `SegmentedControl`/pill. **Files:** `lib/app/views/{SectionsView,ObjectsView,PerformView}.svelte` (+ new row sub-components). **Effort L · deps P1 (S1.5, S1.2).**
- **S2.3 — Graph views adoption + split.** PatchGraphView/TriggerGraphView adopt `GraphPalette`/`GraphFitView`; extract `GraphListRail` (trigger) and a `GraphCanvas` config wrapper; TriggerNode → extract `BandSwitchNode`; LayersDock → extract `BusCard`. **Files:** `lib/app/views/{PatchGraphView,TriggerGraphView,PatchPalette,TriggerPalette,PatchFitView,TriggerFitView,TriggerNode}.svelte`, `lib/app/docks/LayersDock.svelte`. **Effort L · deps P1 (S1.4).**

### P3 — God-file splits (each owns its target; preserve public API → own worktree)

- **S3.1 — Inspector split.** `Inspector.svelte` (1359) → a thin container (~200) + ~11 per-kind editors under `lib/app/docks/inspectors/` (TriggerSource, PlayNode, ContainerNode, Bus, PatchZone, PatchDrum, PatchHoop, PatchDataLine, PatchOutput, PatchController, Section). Adopt `Field`/`Toggle`/`IconButton`/`CommitInput` for the hand-rolled checkbox/field/buttons inside. **Files:** `lib/app/docks/Inspector.svelte` + new `inspectors/*` (+ reuse `patch-inspector.ts`). **Effort L · deps S1.1.** Nothing else touches Inspector → conflict-free.
- **S3.2 — Store split (API-preserving).** `store.svelte.ts` (1888) → ~10 pure reducer slices under `lib/trigger-lab/store/` (shows · songs · sections · graphs · objects · value-switch · trigger-routing · server-library · persistence · transport), each guarded by its existing `store.*.test.ts`; a thin `TriggerLab` rune wrapper delegates to them. **Public `TriggerLab` class API unchanged → no UI edits.** **Files:** `lib/trigger-lab/store.svelte.ts` + new `store/*.ts`. **Effort L · deps none → fully independent worktree.**
- **S3.3 — Sim split.** `sim.ts` (1169) → `sim.envelopes.ts` · `sim.trigger-source.ts` · `sim.graph-compilation.ts` + a slimmer `sim.ts` core, along the existing `sim.*.test.ts` seams. **Files:** `lib/trigger-lab/sim.ts` + new modules. **Effort M–L · deps none → independent.**
- **S3.4 — Server/core splits (non-web, lower priority).** Server `main.ts` (428) → `handlers/projects.ts` + `handlers/voice-input.ts` + `boot.ts`; core `voice/engine.ts` (760) → `eval-graph` + `voice-pool` + `envelope-tick`; `voice/compositor.ts` (388) → `pattern-renderer` + `generator-bridge`. **Files:** `apps/server/src/*`, `packages/core/src/voice/*`. **Effort M each · deps none → independent package boundary.** Keep `core` pure.

### P4 — Consistency sweep (cross-cutting; after P0 so no dead files are migrated)

- **S4.1 — Token-alias migration.** Replace the 8 alias tokens across all live `<style>` blocks, then delete the alias block from `tokens.css`: `--text-dim`→`--text-muted` (**22**), `--panel-raised`→`--surface-2` (7), `--panel-solid`→`--surface` (5), `--border-bright`→`--border-strong` (4), `--panel`→`--surface` (4), `--shadow`→`--shadow-2` (3), `--mono`→`--font-mono` (3), `--sans`→`--font-sans` (1). **Effort M · deps S0.1 (don't migrate doomed files).** *Prefer baking token-correctness into each P1–P3 slice and running this as the final mop-up.*
- **S4.2 — Hardcoded → tokens.** `120ms`/raw easings → `--dur-*`/`--ease-*`; raw gaps/paddings → `--space-*`; `lib/ui` inline z-index → `--z-*`; Dialog/Drawer scrim → `--overlay`; icon sizes (24/30/32px) → `--control-icon-size`. **Effort M · deps S1.6.** (Foldable into S4.1.)
- **S4.3 — Protocol single-source-of-truth.** Reconcile web `lib/ws/protocol-types.ts` with server `ws-protocol.ts`: align `EffectSpec.paramSpec` typing, make `OutputStatus.universeCount` consistent, stop re-defining `ShowLibraryBlob`. Prefer a shared types module both import. **Files:** `apps/web/src/lib/ws/protocol-types.ts`, `apps/server/src/ws-protocol.ts` (+ shared). **Effort M · deps none.**
- **S4.4 — Misc.** Extract a shared dark-pixel RGB constant for `Pixels.svelte`/`Pixels2D.svelte` (currently inconsistent units); investigate/document the `--radius-card` anomaly (24 uses but `0px` + "square" comment). **Effort S.**

## 6. Sequencing & parallelization

```
P0 (S0.1, S0.3 now; S0.2 on Trent's OK)  ──┐  all parallel, land first
P1 (S1.1‑S1.6)  additive, after P0         │
P2 (S2.1‑S2.3)  after P1                    ├─ P3 (S3.2 store, S3.3 sim, S3.4 server/core,
P4 (S4.1‑S4.4)  after P0; S4.1 last         │     S3.1 Inspector) run CONCURRENTLY in own
                                            ┘     worktrees — they preserve public APIs and
                                                  touch disjoint files from P1/P2.
```
- **Worktree-disjoint groups for one parallel wave:** {S0.1}, {S3.2 store}, {S3.3 sim}, {S3.4 server/core}, {S4.3 protocol} touch non-overlapping files and can run together immediately (the prior initiatives' pattern).
- **P2 slices conflict with each other only within their own directory** — chrome / object-views / graph-views own disjoint files, so the three P2 slices are mutually parallel after P1 lands.
- Run **S4.1 token migration last** (a tree-wide style sweep) to avoid re-migrating files P1–P3 already rewrote.

## 7. Risks & decisions required

- **DECISION — retire the lab? (S0.2).** 1,667 lines hinge on whether the trigger-model branches (voice model · block set · section blend) are settled. If still exploring, keep the lab; the rest of the plan is unaffected.
- **Store/sim/Inspector splits are behaviour-preserving refactors** — the risk is silent API drift. Mitigation: the existing `store.*`/`sim.*`/`patch-inspector` test suites are the contract; a split slice must keep them green untouched.
- **Adoption slices change rendered DOM/classes** — visual regressions are possible. These initiatives carry a standing **owed live `:5173` spot-check** (multiple prior ones still outstanding); this pass should add a spot-check pass after P2.
- **Token migration is wide but shallow** — mechanical find/replace guarded by typecheck + a visual diff.

## 8. Appendix A — full findings by dimension

**A1 · Confirmed dead (grep-verified):** legacy app 25 files / 4,110 lines (every basename grep returned only self + other dead files); `lib/ui/{Card,Rail,Sidebar}` (0 import hits); `store.makeBlock`, server `encodeClient`/`showLibraryExists`/`blackout(rgbOrder)`. Lab `TriggerLab`+`NodeCanvas` reachable only from `?proto=trigger`.

**A2 · Componentise (shared extractions):** ListItem/EditableRow (LeftRail·SongRail·ShowBrowser·SectionsView·ObjectsView); CommitInput dedupe (lib/ui ⇄ docks); StatusPill (OutputPill·SaveIndicator); GraphPalette (Patch·Trigger); GraphFitView (Patch·Trigger); MasterDetail (Sections·Objects); GraphListRail; BandSwitchNode (from TriggerNode); BusCard (from LayersDock); Inspector → 11 per-kind editors. Hand-rolled controls to adopt primitives: Inspector checkbox→Toggle, `.envbtn`→IconButton; Transport fields→Field, `.tap`/`.panic`→IconButton; ShowBrowser action buttons→Button/IconButton; PerformView `.chip`→SegmentedControl.

**A3 · Split (>~300 lines / multi-concern):** store.svelte.ts 1888→~10; sim.ts 1169→4; Inspector.svelte 1359→~12; SectionsView 535 / ObjectsView 508 / PatchGraphView 479 / TriggerGraphView 434 (extract rows/detail/rails); Styleguide 586 (CSS + sub-components); server main.ts 428 (handlers/boot); core voice/engine.ts 760 + voice/compositor.ts 388. (All other files ≤ ~330 and single-concern — no split.)

**A4 · Consistency:** token aliases (§S4.1, `--text-dim`×22 leads); hardcoded transitions `120ms` across views + effect-UI; `lib/ui` inline z-index + scrim colors; icon-size divergence 24/30/32px; protocol drift (§S4.3); `--radius-card` 0px/"square"/24-uses anomaly; Pixels vs Pixels2D dark-RGB unit mismatch; Styleguide documents raw HTML not real primitives. `packages/core`/`io` are clean (registry covers all 41 effects; no orphans).

---

## Appendix B — coverage proof (every file, exactly one explorer)

| # | File | Lines | Class | Chunk |
|---|------|------:|-------|-------|
| 1 | `apps/server/src/autosave.test.ts` | 115 | server | C11-server |
| 2 | `apps/server/src/autosave.ts` | 79 | server | C11-server |
| 3 | `apps/server/src/client-lock.test.ts` | 109 | server | C11-server |
| 4 | `apps/server/src/client-lock.ts` | 61 | server | C11-server |
| 5 | `apps/server/src/engine-host.test.ts` | 85 | server | C11-server |
| 6 | `apps/server/src/engine-host.ts` | 202 | server | C11-server |
| 7 | `apps/server/src/input-router.test.ts` | 148 | server | C11-server |
| 8 | `apps/server/src/input-router.ts` | 225 | server | C11-server |
| 9 | `apps/server/src/main.ts` | 428 | server | C11-server |
| 10 | `apps/server/src/output-manager.test.ts` | 135 | server | C11-server |
| 11 | `apps/server/src/output-manager.ts` | 161 | server | C11-server |
| 12 | `apps/server/src/projects.test.ts` | 95 | server | C11-server |
| 13 | `apps/server/src/projects.ts` | 93 | server | C11-server |
| 14 | `apps/server/src/show-library.test.ts` | 130 | server | C11-server |
| 15 | `apps/server/src/show-library.ts` | 96 | server | C11-server |
| 16 | `apps/server/src/static-host.ts` | 107 | server | C11-server |
| 17 | `apps/server/src/voice-engine-host.test.ts` | 321 | server | C11-server |
| 18 | `apps/server/src/voice-engine-host.ts` | 406 | server | C11-server |
| 19 | `apps/server/src/ws-protocol.test.ts` | 63 | server | C11-server |
| 20 | `apps/server/src/ws-protocol.ts` | 191 | server | C11-server |
| 21 | `apps/web/src/app.css` | 233 | LIVE-STYLE | C9-styleguide |
| 22 | `apps/web/src/App.svelte` | 49 | LIVE-APP | C5-app-shell-logic |
| 23 | `apps/web/src/lib/app/AuthorShell.svelte` | 229 | LIVE-APP | C5-app-shell-logic |
| 24 | `apps/web/src/lib/app/chrome/LeftRail.svelte` | 130 | LIVE-APP | C2-app-chrome |
| 25 | `apps/web/src/lib/app/chrome/OutputPill.svelte` | 77 | LIVE-APP | C2-app-chrome |
| 26 | `apps/web/src/lib/app/chrome/SaveIndicator.svelte` | 107 | LIVE-APP | C2-app-chrome |
| 27 | `apps/web/src/lib/app/chrome/ShowBrowser.svelte` | 229 | LIVE-APP | C2-app-chrome |
| 28 | `apps/web/src/lib/app/chrome/SongRail.svelte` | 181 | LIVE-APP | C2-app-chrome |
| 29 | `apps/web/src/lib/app/chrome/TopBar.svelte` | 164 | LIVE-APP | C2-app-chrome |
| 30 | `apps/web/src/lib/app/chrome/Transport.svelte` | 153 | LIVE-APP | C2-app-chrome |
| 31 | `apps/web/src/lib/app/docks/CommitInput.svelte` | 120 | LIVE-APP | C3-app-docks |
| 32 | `apps/web/src/lib/app/docks/Inspector.svelte` | 1359 | LIVE-APP | C3-app-docks |
| 33 | `apps/web/src/lib/app/docks/LayersDock.svelte` | 181 | LIVE-APP | C3-app-docks |
| 34 | `apps/web/src/lib/app/docks/Monitor.svelte` | 61 | LIVE-APP | C3-app-docks |
| 35 | `apps/web/src/lib/app/docks/patch-inspector.test.ts` | 182 | TEST | C3-app-docks |
| 36 | `apps/web/src/lib/app/docks/patch-inspector.ts` | 155 | LIVE-APP | C3-app-docks |
| 37 | `apps/web/src/lib/app/docks/Visualizer.svelte` | 71 | LIVE-APP | C3-app-docks |
| 38 | `apps/web/src/lib/app/Overlays.svelte` | 18 | LIVE-APP | C5-app-shell-logic |
| 39 | `apps/web/src/lib/app/patch-graph.test.ts` | 328 | TEST | C5-app-shell-logic |
| 40 | `apps/web/src/lib/app/patch-graph.ts` | 318 | LIVE-APP | C5-app-shell-logic |
| 41 | `apps/web/src/lib/app/patch-routing.test.ts` | 237 | TEST | C5-app-shell-logic |
| 42 | `apps/web/src/lib/app/patch-routing.ts` | 180 | LIVE-APP | C5-app-shell-logic |
| 43 | `apps/web/src/lib/app/patch-topology.test.ts` | 148 | TEST | C5-app-shell-logic |
| 44 | `apps/web/src/lib/app/patch-topology.ts` | 260 | LIVE-APP | C5-app-shell-logic |
| 45 | `apps/web/src/lib/app/recall.test.ts` | 63 | TEST | C5-app-shell-logic |
| 46 | `apps/web/src/lib/app/recall.ts` | 59 | LIVE-APP | C5-app-shell-logic |
| 47 | `apps/web/src/lib/app/setlist.test.ts` | 175 | TEST | C5-app-shell-logic |
| 48 | `apps/web/src/lib/app/setlist.ts` | 137 | LIVE-APP | C5-app-shell-logic |
| 49 | `apps/web/src/lib/app/shell-nav.test.ts` | 107 | TEST | C5-app-shell-logic |
| 50 | `apps/web/src/lib/app/shell-nav.ts` | 91 | LIVE-APP | C5-app-shell-logic |
| 51 | `apps/web/src/lib/app/shell-store.svelte.ts` | 63 | LIVE-APP | C5-app-shell-logic |
| 52 | `apps/web/src/lib/app/trigger-source-label.test.ts` | 65 | TEST | C5-app-shell-logic |
| 53 | `apps/web/src/lib/app/trigger-source-label.ts` | 54 | LIVE-APP | C5-app-shell-logic |
| 54 | `apps/web/src/lib/app/views/flow-dom.ts` | 14 | LIVE-APP | C4-app-views |
| 55 | `apps/web/src/lib/app/views/graph-hover.svelte.ts` | 40 | LIVE-APP | C4-app-views |
| 56 | `apps/web/src/lib/app/views/graph-to-flow.test.ts` | 92 | TEST | C4-app-views |
| 57 | `apps/web/src/lib/app/views/graph-to-flow.ts` | 65 | LIVE-APP | C4-app-views |
| 58 | `apps/web/src/lib/app/views/NodeCard.svelte` | 130 | LIVE-APP | C4-app-views |
| 59 | `apps/web/src/lib/app/views/objects-view.test.ts` | 99 | TEST | C4-app-views |
| 60 | `apps/web/src/lib/app/views/objects-view.ts` | 89 | LIVE-APP | C4-app-views |
| 61 | `apps/web/src/lib/app/views/ObjectsView.svelte` | 508 | LIVE-APP | C4-app-views |
| 62 | `apps/web/src/lib/app/views/patch-context.ts` | 11 | LIVE-APP | C4-app-views |
| 63 | `apps/web/src/lib/app/views/PatchFitView.svelte` | 23 | LIVE-APP | C4-app-views |
| 64 | `apps/web/src/lib/app/views/PatchGraphView.svelte` | 479 | LIVE-APP | C4-app-views |
| 65 | `apps/web/src/lib/app/views/PatchNode.svelte` | 52 | LIVE-APP | C4-app-views |
| 66 | `apps/web/src/lib/app/views/PatchPalette.svelte` | 98 | LIVE-APP | C4-app-views |
| 67 | `apps/web/src/lib/app/views/PerformView.svelte` | 169 | LIVE-APP | C4-app-views |
| 68 | `apps/web/src/lib/app/views/SectionsView.svelte` | 535 | LIVE-APP | C4-app-views |
| 69 | `apps/web/src/lib/app/views/trigger-context.ts` | 11 | LIVE-APP | C4-app-views |
| 70 | `apps/web/src/lib/app/views/trigger-node-meta.ts` | 82 | LIVE-APP | C4-app-views |
| 71 | `apps/web/src/lib/app/views/TriggerFitView.svelte` | 31 | LIVE-APP | C4-app-views |
| 72 | `apps/web/src/lib/app/views/TriggerGraphView.svelte` | 434 | LIVE-APP | C4-app-views |
| 73 | `apps/web/src/lib/app/views/TriggerNode.svelte` | 152 | LIVE-APP | C4-app-views |
| 74 | `apps/web/src/lib/app/views/TriggerPalette.svelte` | 90 | LIVE-APP | C4-app-views |
| 75 | `apps/web/src/lib/app/views/WireEdge.svelte` | 30 | LIVE-APP | C4-app-views |
| 76 | `apps/web/src/lib/midi/webmidi.test.ts` | 95 | TEST | C8-visualizer-io |
| 77 | `apps/web/src/lib/midi/webmidi.ts` | 147 | LIVE-APP | C8-visualizer-io |
| 78 | `apps/web/src/lib/panels/ClipGrid.svelte` | 153 | DEAD? | C10-dead-legacy |
| 79 | `apps/web/src/lib/panels/EffectParams.svelte` | 154 | DEAD? | C10-dead-legacy |
| 80 | `apps/web/src/lib/panels/InputMonitor.svelte` | 152 | DEAD? | C10-dead-legacy |
| 81 | `apps/web/src/lib/panels/KitEditor.svelte` | 199 | DEAD? | C10-dead-legacy |
| 82 | `apps/web/src/lib/panels/LayerStack.svelte` | 211 | DEAD? | C10-dead-legacy |
| 83 | `apps/web/src/lib/panels/ModulationMatrix.svelte` | 182 | DEAD? | C10-dead-legacy |
| 84 | `apps/web/src/lib/panels/OutputConfig.svelte` | 237 | DEAD? | C10-dead-legacy |
| 85 | `apps/web/src/lib/panels/params.test.ts` | 81 | TEST | C10-dead-legacy |
| 86 | `apps/web/src/lib/panels/params.ts` | 135 | DEAD? | C10-dead-legacy |
| 87 | `apps/web/src/lib/panels/ProjectBar.svelte` | 129 | DEAD? | C10-dead-legacy |
| 88 | `apps/web/src/lib/panels/StatusBar.svelte` | 140 | DEAD? | C10-dead-legacy |
| 89 | `apps/web/src/lib/panels/Transport.svelte` | 152 | DEAD? | C10-dead-legacy |
| 90 | `apps/web/src/lib/routing/build-routing-graph.ts` | 93 | DEAD? | C10-dead-legacy |
| 91 | `apps/web/src/lib/shell/AuthorShell.svelte` | 374 | DEAD? | C10-dead-legacy |
| 92 | `apps/web/src/lib/shell/Icon.svelte` | 56 | DEAD? | C10-dead-legacy |
| 93 | `apps/web/src/lib/shell/LivePill.svelte` | 97 | DEAD? | C10-dead-legacy |
| 94 | `apps/web/src/lib/shell/SettingsView.svelte` | 110 | DEAD? | C10-dead-legacy |
| 95 | `apps/web/src/lib/shell/StatusCluster.svelte` | 102 | DEAD? | C10-dead-legacy |
| 96 | `apps/web/src/lib/store/app-store.svelte.ts` | 362 | DEAD? | C10-dead-legacy |
| 97 | `apps/web/src/lib/styleguide/Styleguide.svelte` | 586 | LIVE-STYLE | C9-styleguide |
| 98 | `apps/web/src/lib/trigger-lab/ClipSettings.svelte` | 238 | LIVE-APP | C7-lab-ui |
| 99 | `apps/web/src/lib/trigger-lab/EffectCreator.svelte` | 386 | LIVE-APP | C7-lab-ui |
| 100 | `apps/web/src/lib/trigger-lab/EffectGallery.svelte` | 188 | LIVE-APP | C7-lab-ui |
| 101 | `apps/web/src/lib/trigger-lab/EffectThumb.svelte` | 95 | LIVE-APP | C7-lab-ui |
| 102 | `apps/web/src/lib/trigger-lab/EnvelopeEditor.svelte` | 443 | LIVE-APP | C7-lab-ui |
| 103 | `apps/web/src/lib/trigger-lab/fixtures.ts` | 261 | LIVE-APP | C6-lab-store-logic |
| 104 | `apps/web/src/lib/trigger-lab/generator-bridge.test.ts` | 105 | TEST | C6-lab-store-logic |
| 105 | `apps/web/src/lib/trigger-lab/kit.ts` | 112 | LIVE-APP | C6-lab-store-logic |
| 106 | `apps/web/src/lib/trigger-lab/NodeCanvas.svelte` | 954 | LAB-ONLY | C7-lab-ui |
| 107 | `apps/web/src/lib/trigger-lab/persistence.test.ts` | 329 | TEST | C6-lab-store-logic |
| 108 | `apps/web/src/lib/trigger-lab/persistence.ts` | 293 | LIVE-APP | C6-lab-store-logic |
| 109 | `apps/web/src/lib/trigger-lab/render.ts` | 228 | LIVE-APP | C6-lab-store-logic |
| 110 | `apps/web/src/lib/trigger-lab/save-status.test.ts` | 190 | TEST | C6-lab-store-logic |
| 111 | `apps/web/src/lib/trigger-lab/save-status.ts` | 129 | LIVE-APP | C6-lab-store-logic |
| 112 | `apps/web/src/lib/trigger-lab/show-builder.test.ts` | 145 | TEST | C6-lab-store-logic |
| 113 | `apps/web/src/lib/trigger-lab/show-builder.ts` | 90 | LIVE-APP | C6-lab-store-logic |
| 114 | `apps/web/src/lib/trigger-lab/sim.trigger-routing.test.ts` | 114 | TEST | C6-lab-store-logic |
| 115 | `apps/web/src/lib/trigger-lab/sim.trigger-source.test.ts` | 59 | TEST | C6-lab-store-logic |
| 116 | `apps/web/src/lib/trigger-lab/sim.ts` | 1169 | LIVE-APP | C6-lab-store-logic |
| 117 | `apps/web/src/lib/trigger-lab/sim.value-switch.test.ts` | 172 | TEST | C6-lab-store-logic |
| 118 | `apps/web/src/lib/trigger-lab/sim.velocity-fold.test.ts` | 149 | TEST | C6-lab-store-logic |
| 119 | `apps/web/src/lib/trigger-lab/StatusBar.svelte` | 124 | LIVE-APP | C7-lab-ui |
| 120 | `apps/web/src/lib/trigger-lab/store.graphs.test.ts` | 266 | TEST | C6-lab-store-logic |
| 121 | `apps/web/src/lib/trigger-lab/store.objects.test.ts` | 245 | TEST | C6-lab-store-logic |
| 122 | `apps/web/src/lib/trigger-lab/store.persistence.test.ts` | 170 | TEST | C6-lab-store-logic |
| 123 | `apps/web/src/lib/trigger-lab/store.routing.test.ts` | 126 | TEST | C6-lab-store-logic |
| 124 | `apps/web/src/lib/trigger-lab/store.sections.test.ts` | 268 | TEST | C6-lab-store-logic |
| 125 | `apps/web/src/lib/trigger-lab/store.server-library.test.ts` | 216 | TEST | C6-lab-store-logic |
| 126 | `apps/web/src/lib/trigger-lab/store.shows.test.ts` | 250 | TEST | C6-lab-store-logic |
| 127 | `apps/web/src/lib/trigger-lab/store.songs.test.ts` | 185 | TEST | C6-lab-store-logic |
| 128 | `apps/web/src/lib/trigger-lab/store.svelte.ts` | 1888 | LIVE-APP | C6-lab-store-logic |
| 129 | `apps/web/src/lib/trigger-lab/store.trigger-source.test.ts` | 104 | TEST | C6-lab-store-logic |
| 130 | `apps/web/src/lib/trigger-lab/store.value-switch.test.ts` | 211 | TEST | C6-lab-store-logic |
| 131 | `apps/web/src/lib/trigger-lab/TriggerLab.svelte` | 713 | LAB-ONLY | C7-lab-ui |
| 132 | `apps/web/src/lib/ui/Card.svelte` | 75 | DEAD? | C1-ui-primitives |
| 133 | `apps/web/src/lib/ui/CommitInput.svelte` | 89 | LIVE-APP | C1-ui-primitives |
| 134 | `apps/web/src/lib/ui/ContextMenu.svelte` | 136 | LIVE-APP | C1-ui-primitives |
| 135 | `apps/web/src/lib/ui/Dialog.svelte` | 102 | LIVE-APP | C1-ui-primitives |
| 136 | `apps/web/src/lib/ui/Drawer.svelte` | 170 | LIVE-APP | C1-ui-primitives |
| 137 | `apps/web/src/lib/ui/Eyebrow.svelte` | 30 | LIVE-APP | C1-ui-primitives |
| 138 | `apps/web/src/lib/ui/Field.svelte` | 41 | LIVE-APP | C1-ui-primitives |
| 139 | `apps/web/src/lib/ui/IconButton.svelte` | 94 | LIVE-APP | C1-ui-primitives |
| 140 | `apps/web/src/lib/ui/Rail.svelte` | 72 | DEAD? | C1-ui-primitives |
| 141 | `apps/web/src/lib/ui/SearchField.svelte` | 97 | LIVE-APP | C1-ui-primitives |
| 142 | `apps/web/src/lib/ui/SegmentedControl.svelte` | 113 | LIVE-APP | C1-ui-primitives |
| 143 | `apps/web/src/lib/ui/Select.svelte` | 173 | LIVE-APP | C1-ui-primitives |
| 144 | `apps/web/src/lib/ui/Separator.svelte` | 28 | LIVE-APP | C1-ui-primitives |
| 145 | `apps/web/src/lib/ui/Sidebar.svelte` | 108 | DEAD? | C1-ui-primitives |
| 146 | `apps/web/src/lib/ui/Slider.svelte` | 134 | LIVE-APP | C1-ui-primitives |
| 147 | `apps/web/src/lib/ui/Splitter.svelte` | 162 | LIVE-APP | C1-ui-primitives |
| 148 | `apps/web/src/lib/ui/Switch.svelte` | 66 | LIVE-APP | C1-ui-primitives |
| 149 | `apps/web/src/lib/ui/Tabs.svelte` | 67 | LIVE-APP | C1-ui-primitives |
| 150 | `apps/web/src/lib/ui/TextField.svelte` | 64 | LIVE-APP | C1-ui-primitives |
| 151 | `apps/web/src/lib/ui/Toggle.svelte` | 70 | LIVE-APP | C1-ui-primitives |
| 152 | `apps/web/src/lib/ui/Tooltip.svelte` | 65 | LIVE-APP | C1-ui-primitives |
| 153 | `apps/web/src/lib/views/arrange-helpers.test.ts` | 44 | TEST | C10-dead-legacy |
| 154 | `apps/web/src/lib/views/arrange-helpers.ts` | 24 | DEAD? | C10-dead-legacy |
| 155 | `apps/web/src/lib/views/ArrangeView.svelte` | 338 | DEAD? | C10-dead-legacy |
| 156 | `apps/web/src/lib/views/MapView.svelte` | 217 | DEAD? | C10-dead-legacy |
| 157 | `apps/web/src/lib/views/PerformView.svelte` | 91 | DEAD? | C10-dead-legacy |
| 158 | `apps/web/src/lib/views/RoutingView.svelte` | 277 | DEAD? | C10-dead-legacy |
| 159 | `apps/web/src/lib/visualizer/Pixels.svelte` | 307 | LIVE-APP | C8-visualizer-io |
| 160 | `apps/web/src/lib/visualizer/Pixels2D.svelte` | 129 | LIVE-APP | C8-visualizer-io |
| 161 | `apps/web/src/lib/visualizer/Scene.svelte` | 127 | LIVE-APP | C8-visualizer-io |
| 162 | `apps/web/src/lib/ws/client.test.ts` | 164 | TEST | C8-visualizer-io |
| 163 | `apps/web/src/lib/ws/client.ts` | 206 | LIVE-APP | C8-visualizer-io |
| 164 | `apps/web/src/lib/ws/protocol-types.ts` | 194 | LIVE-APP | C8-visualizer-io |
| 165 | `apps/web/src/main.ts` | 23 | DEAD? | C5-app-shell-logic |
| 166 | `apps/web/src/styles/tokens.css` | 180 | LIVE-STYLE | C9-styleguide |
| 167 | `packages/core/src/color/blend.test.ts` | 53 | core | C12-core |
| 168 | `packages/core/src/color/blend.ts` | 49 | core | C12-core |
| 169 | `packages/core/src/color/color.test.ts` | 32 | core | C12-core |
| 170 | `packages/core/src/color/color.ts` | 68 | core | C12-core |
| 171 | `packages/core/src/effects/batch-a.test.ts` | 126 | core | C13-core-effects |
| 172 | `packages/core/src/effects/batch-b.test.ts` | 106 | core | C13-core-effects |
| 173 | `packages/core/src/effects/batch-c.test.ts` | 217 | core | C13-core-effects |
| 174 | `packages/core/src/effects/batch-d.test.ts` | 179 | core | C13-core-effects |
| 175 | `packages/core/src/effects/effects.test.ts` | 326 | core | C13-core-effects |
| 176 | `packages/core/src/effects/field.ts` | 49 | core | C13-core-effects |
| 177 | `packages/core/src/effects/impl/breathing-kit.ts` | 40 | core | C13-core-effects |
| 178 | `packages/core/src/effects/impl/burst.ts` | 42 | core | C13-core-effects |
| 179 | `packages/core/src/effects/impl/caustics.ts` | 38 | core | C13-core-effects |
| 180 | `packages/core/src/effects/impl/chase.ts` | 31 | core | C13-core-effects |
| 181 | `packages/core/src/effects/impl/checker-pulse.ts` | 40 | core | C13-core-effects |
| 182 | `packages/core/src/effects/impl/collisions.ts` | 143 | core | C13-core-effects |
| 183 | `packages/core/src/effects/impl/colour-melody.ts` | 43 | core | C13-core-effects |
| 184 | `packages/core/src/effects/impl/comet-trails.ts` | 123 | core | C13-core-effects |
| 185 | `packages/core/src/effects/impl/confetti-burst.ts` | 117 | core | C13-core-effects |
| 186 | `packages/core/src/effects/impl/fire.ts` | 80 | core | C13-core-effects |
| 187 | `packages/core/src/effects/impl/follow-hoop.ts` | 39 | core | C13-core-effects |
| 188 | `packages/core/src/effects/impl/gravity-wells.ts` | 104 | core | C13-core-effects |
| 189 | `packages/core/src/effects/impl/grid-glow.ts` | 48 | core | C13-core-effects |
| 190 | `packages/core/src/effects/impl/helix.ts` | 48 | core | C13-core-effects |
| 191 | `packages/core/src/effects/impl/hue-rotate-kit.ts` | 35 | core | C13-core-effects |
| 192 | `packages/core/src/effects/impl/interference.ts` | 37 | core | C13-core-effects |
| 193 | `packages/core/src/effects/impl/lava-lamp.ts` | 44 | core | C13-core-effects |
| 194 | `packages/core/src/effects/impl/lightning.ts` | 118 | core | C13-core-effects |
| 195 | `packages/core/src/effects/impl/meter-eq.ts` | 31 | core | C13-core-effects |
| 196 | `packages/core/src/effects/impl/orbit-rings.ts` | 45 | core | C13-core-effects |
| 197 | `packages/core/src/effects/impl/perlin-clouds.ts` | 75 | core | C13-core-effects |
| 198 | `packages/core/src/effects/impl/pixel-accum.ts` | 60 | core | C13-core-effects |
| 199 | `packages/core/src/effects/impl/plasma.ts` | 40 | core | C13-core-effects |
| 200 | `packages/core/src/effects/impl/radial-wash.ts` | 69 | core | C13-core-effects |
| 201 | `packages/core/src/effects/impl/rainbow-flow.ts` | 32 | core | C13-core-effects |
| 202 | `packages/core/src/effects/impl/ripple-pond.ts` | 40 | core | C13-core-effects |
| 203 | `packages/core/src/effects/impl/sacred-hogs.ts` | 91 | core | C13-core-effects |
| 204 | `packages/core/src/effects/impl/sidechain.ts` | 58 | core | C13-core-effects |
| 205 | `packages/core/src/effects/impl/solid-base.ts` | 39 | core | C13-core-effects |
| 206 | `packages/core/src/effects/impl/spiral.ts` | 40 | core | C13-core-effects |
| 207 | `packages/core/src/effects/impl/starfield.ts` | 82 | core | C13-core-effects |
| 208 | `packages/core/src/effects/impl/strobe.ts` | 30 | core | C13-core-effects |
| 209 | `packages/core/src/effects/impl/swing.ts` | 62 | core | C13-core-effects |
| 210 | `packages/core/src/effects/impl/synced-hoops.ts` | 37 | core | C13-core-effects |
| 211 | `packages/core/src/effects/impl/temp-sweep.ts` | 36 | core | C13-core-effects |
| 212 | `packages/core/src/effects/impl/tunnel.ts` | 42 | core | C13-core-effects |
| 213 | `packages/core/src/effects/impl/velocity-flames.ts` | 57 | core | C13-core-effects |
| 214 | `packages/core/src/effects/impl/wave-collapse.ts` | 62 | core | C13-core-effects |
| 215 | `packages/core/src/effects/impl/whole-drum.ts` | 33 | core | C13-core-effects |
| 216 | `packages/core/src/effects/impl/whole-kit.ts` | 30 | core | C13-core-effects |
| 217 | `packages/core/src/effects/impl/wipe-3d.ts` | 51 | core | C13-core-effects |
| 218 | `packages/core/src/effects/registry.test.ts` | 44 | core | C13-core-effects |
| 219 | `packages/core/src/effects/registry.ts` | 113 | core | C13-core-effects |
| 220 | `packages/core/src/effects/types.ts` | 64 | core | C13-core-effects |
| 221 | `packages/core/src/engine/compositor.ts` | 27 | core | C12-core |
| 222 | `packages/core/src/engine/control-state.ts` | 50 | core | C12-core |
| 223 | `packages/core/src/engine/engine.test.ts` | 125 | core | C12-core |
| 224 | `packages/core/src/engine/engine.ts` | 393 | core | C12-core |
| 225 | `packages/core/src/engine/framebuffer.ts` | 46 | core | C12-core |
| 226 | `packages/core/src/engine/modulation.test.ts` | 52 | core | C12-core |
| 227 | `packages/core/src/engine/modulation.ts` | 75 | core | C12-core |
| 228 | `packages/core/src/engine/render-context.ts` | 41 | core | C12-core |
| 229 | `packages/core/src/engine/transport.ts` | 26 | core | C12-core |
| 230 | `packages/core/src/geometry/dmx-map.test.ts` | 131 | core | C12-core |
| 231 | `packages/core/src/geometry/dmx-map.ts` | 147 | core | C12-core |
| 232 | `packages/core/src/geometry/euler.test.ts` | 47 | core | C12-core |
| 233 | `packages/core/src/geometry/euler.ts` | 49 | core | C12-core |
| 234 | `packages/core/src/geometry/kit-schema.ts` | 119 | core | C12-core |
| 235 | `packages/core/src/geometry/pixel-model.test.ts` | 80 | core | C12-core |
| 236 | `packages/core/src/geometry/pixel-model.ts` | 179 | core | C12-core |
| 237 | `packages/core/src/geometry/zones.ts` | 15 | core | C12-core |
| 238 | `packages/core/src/index.ts` | 39 | core | C12-core |
| 239 | `packages/core/src/math.ts` | 78 | core | C12-core |
| 240 | `packages/core/src/model/defaults.ts` | 180 | core | C12-core |
| 241 | `packages/core/src/model/integrity.test.ts` | 127 | core | C12-core |
| 242 | `packages/core/src/model/integrity.ts` | 111 | core | C12-core |
| 243 | `packages/core/src/model/project-schema.test.ts` | 42 | core | C12-core |
| 244 | `packages/core/src/model/project-schema.ts` | 184 | core | C12-core |
| 245 | `packages/core/src/voice/compositor.test.ts` | 238 | core | C12-core |
| 246 | `packages/core/src/voice/compositor.ts` | 388 | core | C12-core |
| 247 | `packages/core/src/voice/engine.test.ts` | 999 | core | C12-core |
| 248 | `packages/core/src/voice/engine.ts` | 760 | core | C12-core |
| 249 | `packages/core/src/voice/envelope.ts` | 107 | core | C12-core |
| 250 | `packages/core/src/voice/index.ts` | 30 | core | C12-core |
| 251 | `packages/core/src/voice/prng.test.ts` | 44 | core | C12-core |
| 252 | `packages/core/src/voice/prng.ts` | 49 | core | C12-core |
| 253 | `packages/core/src/voice/types.test.ts` | 98 | core | C12-core |
| 254 | `packages/core/src/voice/types.ts` | 364 | core | C12-core |
| 255 | `packages/io/src/artnet.test.ts` | 30 | io | C13-core-effects |
| 256 | `packages/io/src/artnet.ts` | 84 | io | C13-core-effects |
| 257 | `packages/io/src/index.ts` | 4 | io | C13-core-effects |
| 258 | `packages/io/src/interfaces.ts` | 22 | io | C13-core-effects |
| 259 | `packages/io/src/osc.test.ts` | 36 | io | C13-core-effects |
| 260 | `packages/io/src/osc.ts` | 138 | io | C13-core-effects |
| 261 | `packages/io/src/sacn.test.ts` | 37 | io | C13-core-effects |
| 262 | `packages/io/src/sacn.ts` | 125 | io | C13-core-effects |

**262 files covered — 13 chunks, each file by exactly one explorer.**

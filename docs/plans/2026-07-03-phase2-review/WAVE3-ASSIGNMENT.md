# Wave 3 assignment — cohesive design pass, remaining items

**Agent:** one fable session (own window, low effort — compensated by this concrete spec; escalate questions to parent, don't guess on product decisions). **Worktree:** `../ledrums-wt/wt-3` (already prepared). **Branch:** `wave-3/design` (already exists, 3 commits in — CONTINUE it, do not rebranch). **Parent:** `twux send-message --session parent` (≤30 lines per message).

**Read first (repo root = wt-3):**
- `docs/plans/2026-07-03-phase2-review/HANDOFF.md` — items D/E/G/I + cross-cutting warnings (esp. the self-referential `$effect` bug class, #1).
- `docs/plans/2026-07-03-phase2-review/PHASE0-RECONCILIATION.md` §4 (Song Library), §5 (previews), §6 (logo/favicon), §7 "Title styles".
- `docs/plans/2026-07-03-phase2-review/TRENT-DICTATION-2.md` — design north star (Linear-inspired, Resend-dark), icons+tooltips ALWAYS, the approved shell, REJECTED patterns.
- `AGENTS.md` — non-negotiables; **every UI change applies `/make-interfaces-feel-better`** and uses/extends the design system.
- `~/TWA/ledrums-prototypes/relayout-shell.html` — the approved shell (already implemented; your reference for visual language).

## Already done on this branch (do not redo)

1. `bb75c63` — item F: darker neutral ramp (tokens.css), AA re-verified (`node apps/web/scripts/contrast-check.mjs`). `--shell-gap` is already 0 (flush modules).
2. `e3a8a90` — approved shell 1/2: **Node Editor drawer** (Add/Inspector tabs, `views/NodeEditor.svelte` + `views/AddPalette.svelte`) in Trigger + Patch views; full-height right column (Visualizer + vertical `LayersDock`, bus settings inline); section settings inline in SectionsView; `shell-nav` lost the dock-tab concept; **new `ui/PanelHeader.svelte` primitive** (THE panel-title treatment); GraphPalette/GraphAddMenu/BusInspector/GraphListRail retired.
3. `0afac14` — approved shell 2/2: **GraphsDock** (bottom bar: section tabs, hotkey cards 1–9/0, real graph mini-maps via `views/graph-thumb.ts`, fire flash off `store.lastSectionFire`); ←/→ section switching (App.svelte); `scripts/ui-shot/shots.json` retargeted to the new shell.

## Your items (work in this order, one commit per item, verify each live)

### 1. Header/title unification + icon+tooltip standardisation (item D)
- Adopt `ui/PanelHeader.svelte` as the panel-title treatment EVERYWHERE a panel/rail/dock has a title; retire `Eyebrow`-as-panel-title (Eyebrow stays for small in-content labels only). Known offenders: Visualizer "Kit preview" overlay label, LeftRail "Views", SongRail "Setlist" header, SectionsView "Setlist" head, PatchGraphView `phead`, ObjectsView master/detail headers, GraphPickerDrawer. Audit `rtk proxy grep -rln "Eyebrow" apps/web/src/lib/app` and judge each.
- **Icons + tooltips, never text labels** for same-class controls. Specifically: in a play node's parameter list the "disconnect wire" and "invert" controls are two different component kinds (`ModulationParamsSection.svelte`, param rows) — standardise to one pattern (IconButton + Tooltip). Sweep for other text-labelled controls of a class that is iconed elsewhere.
- One interaction pattern per component class; instant hover on graph chrome (locked).

### 2. Play-node params INSIDE the card (item E)
- `TriggerNode.svelte` renders play-node params/mod rows as a visually separate card bolted under the NodeCard — merge them INTO the node card (one border, one surface, concentric radii). Files: `views/NodeCard.svelte`, `views/TriggerNode.svelte`, `ParamRowTick`, mod-row rendering. Wires/handles must keep working (handle positions derive from card layout — wave-2 fixed hardcoded offsets, don't regress).

### 3. Node previews live-on-trigger (item G) — the big one
- Today ALL previews loop a synthetic 1600 ms clock (`effect-thumb-ticker.ts`, THUMB_LOOP_MS) — nothing reacts to real triggers. Target (TouchDesigner): **every node kind gets a preview; trigger-driven previews are STATIC until the node actually fires, then play live.**
- Seam: pipe the live trigger/voice event stream into preview context — the S17 VoiceStat pattern (server stats → store) is the precedent; offline, the sim's fires drive it. Per-voice state reset on retrigger. `store.lastSectionFire` (new) is a display-only precedent for "something fired" signals.
- ⚠️ This is EXACTLY where the app-fatal self-referential `$effect` bug class bit twice (HANDOFF #1). Read `ui/theme-tokens.ts` + `NodeSignalPreview.svelte` first; never read+write the same $state in one effect; null-guard everything a rAF ticker samples (nodes can be deleted a frame before the tick).
- Keep: one shared ticker, viewport gating, reduced-motion = static frame. Scope honestly: if full per-kind coverage balloons, land trigger-live previews for play/effect nodes first, commit, report, propose the rest.

### 4. Song Library entry point + microcopy + density (items I/D)
- Song Library works but is buried below the fold of Objects → Songs. Give it a discoverable entry point (e.g. its own master row in ObjectsView, or a Library section header pinned visible — your judgment, Linear-style).
- **Microcopy audit:** strip implementation/design-rationale language from ALL user-facing copy (e.g. hints that explain how it's built rather than what the user does). Plain, action-first, no jargon. Do not touch Monitor's technical event text (that surface is FOR diagnostics).
- **Density/scale review, both directions:** the app is too small to view on a small screen yet shows too little information without scrolling (TRENT-DICTATION-2 "Wave-3 reframe"). Review type scale / control heights / paddings across the shell; propose+apply consistent density. Check 1280×800 and 1920×1080 via ui-shot.

### 5. Logo + favicon (item D)
- The TopBar mark is a CSS conic-gradient square; the favicon is a placeholder (45f3f1c). Design a real mark: simple, geometric, works at 16px, fits Linear/Resend dark + phosphor-lime accent (a drum/hoop/pixel motif is welcome but not required). Inline SVG component for the TopBar + `favicon.svg`. Keep it self-contained (no external assets).

### 6. Final gate (after all items)
- `pnpm design-system` regen (ONE coherent regen at the end; add any new/changed primitives to `apps/web/src/lib/styleguide/` per its README — PanelHeader/AddPalette/NodeEditor/GraphsDock demos included).
- Full sweep from repo root: `pnpm typecheck` + `pnpm test` (ALL packages) green, 0 skips.
- `LEDRUMS_WEB_PORT=5178 LEDRUMS_WS_PORT=4326 pnpm ui-shot --all --strict` — clean console, then LOOK at the shots (Read the PNGs) and fix what looks wrong. Screenshot-verify EVERY item as you land it, not just at the end.
- Commit `docs/plans/2026-07-03-phase2-review/WAVE3-REPORT.md`: per-item what changed / evidence / test names / surprises. Slim final message to parent.

## Rules
- Apply `/make-interfaces-feel-better` on every UI change (concentric radii, optical alignment, tabular-nums, instant-vs-transition judgment, ≥40px hit areas via pseudo-elements, no `transition: all`).
- Locked graph prefs: NO node lift/click animations; INSTANT hover highlight; drop-a-wire-anywhere-on-a-node → its input.
- REJECTED (do not ship): numbered modifier-order chips; drag-to-reorder modifier list. (Optionally: a read-only computed chain-order display in the drawer inspector is allowed.)
- Core purity + determinism are non-negotiable (AGENTS.md); previews must not touch engine state.
- Budget: check `twux usage`; above ~85% of the 5h window → finish the current item, commit, report partial.

# U4 — Sections as flat graph lists + Play-Surface replacement

Slices B/C/D of the trigger-source+sections rework. **Runs AFTER U3 (trigger-source routing) is merged into `feat/unified-shell`** — it reconciles the hit-resolution with U3's source-based resolution. Branch base `feat/unified-shell` (you may run in a worktree — read `docs/prompts/_worktree-note.md` if so). **Trent locked the two model decisions** (below).

## Locked model decisions (from Trent)
1. **A section is a FLAT ordered list of graphs** — drop the per-pad 3-layer `SectionSlots` (`Record<padKey, Slot[]>`) entirely. A `SetlistSection` becomes `{ id, name, graphs: string[] }` (ordered graph keys).
2. **Merge `activeSectionId` + `arrangeSectionId` into ONE `activeSectionId`** — the section you're playing *is* the one you're editing. Selecting a graph in a section makes that section active.

## What this delivers
- **Sections view** (`SectionsView.svelte`): drop the drum × zone × slot grid. Each section shows its **flat ordered graph list** (add a graph, remove, reorder is nice-to-have). No more padKey keying.
- **Replace the "Play Surface"** — the drum-grouped sidebar inside `TriggerGraphView.svelte` (lines ~58–202) — with the **active section's flat graph list**. Selecting a graph there: (a) makes its section active, (b) opens that graph in the canvas, (c) **highlights** it in the list. Click to swap between the section's graphs. (This list and the SectionsView list are the same data — a section's `graphs`.)
- **Resolution**: a hit fires the **active section's graphs whose trigger `source` matches the input** — integrate with U3's resolution (read its committed `resolveHitGraphsLocal`/sim resolution; do NOT duplicate it — extend it so "candidate graphs" = the active section's `graphs` instead of the old `section.slots[padKey]`, then U3's source-matching filters them). Falls back to today's behaviour when no active section.

## Scope (cohesive — the model change ripples, so one agent owns these)
- `apps/web/src/lib/app/setlist.ts` — `SetlistSection.graphs: string[]` (was `slots`); update helpers (`setSlot`/`assignSlot` → `addGraph`/`removeGraph`/`setGraphs`; keep `referencedGraphs`). 
- `apps/web/src/lib/trigger-lab/store.svelte.ts` — merge `activeSectionId`/`arrangeSectionId` → `activeSectionId`; `recall`/`setArrangeSection` collapse into one `setActiveSection`; `resolveHitGraphsLocal` reads the active section's `graphs` (then U3's source filter); a `selectGraphInSection(sectionId, graphKey)` that sets active section + `selectedPadKey` (opens the graph). Section graph-list mutators (`addGraphToSection`/`removeGraphFromSection`).
- `apps/web/src/lib/trigger-lab/persistence.ts` — **back-compat hydrate migration**: a persisted `SetlistSection` with `slots` → flatten into a deduped, order-preserving `graphs` list (slot order across pads). Idempotent (a section already on `graphs` is untouched). Same defensive spirit as `unionTriggerSources`.
- `apps/web/src/lib/app/views/SectionsView.svelte` — flat-graph-list UI per section (graph-picker drawer reused for "add graph"; remove; highlight the active section's selected graph).
- `apps/web/src/lib/app/views/TriggerGraphView.svelte` — REMOVE the Play-Surface sidebar; render the active section's flat graph list (rows = graphs, highlight current, click → `selectGraphInSection`). Keep the canvas.
- `apps/web/src/lib/app/shell-nav.ts` / `shell-store.svelte.ts` — only if a nav action is needed for select→activate (prefer doing it in the store).
- Use the **Svelte MCP** for `.svelte`; autofixer clean. Reuse `lib/ui/` primitives + tokens.

## Tests
- setlist flat-list helpers (add/remove/reorder, referencedGraphs); the hydrate migration (slots→graphs flatten, idempotent, dedup, order); store `selectGraphInSection` sets active section + opens graph; `resolveHitGraphsLocal` fires the active section's graphs (with U3's source filter) + back-compat fallback. Update existing setlist/section tests to the new model.

## Gate discipline
- Per-package typecheck during work; full `pnpm typecheck && pnpm test` on your committed clean tree. The model change touches many web files — keep web green as you go.

## Acceptance
- Sections are flat graph lists; the Play-Surface is replaced by the active section's graph list; selecting a graph activates its section + opens + highlights it; existing persisted songs migrate cleanly; a hit fires the active section's source-matched graphs; full sweep green. (Live `:5173` spot-check owed — flag it.)

## Report back
Report to parent with commit SHA(s), files, the new `SetlistSection`/store API, the migration approach, gate totals, deviations. Commit before reporting; leave `.mex/ROUTER.md` to the orchestrator.

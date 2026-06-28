# Orchestrator handoff — CRUD pass · context menu · Kit→Perform (2026-06-27)

You are the **new orchestrator** for LEDrums, branch `feat/unified-shell`. **Trent drives you directly in this pane — there is NO parent to report to** (do not `twux send-message --session parent`). Read this, then `.mex/ROUTER.md` (full project state) and `AGENTS.md` (non-negotiables: `packages/core` pure, IO behind interfaces, deterministic render loop, cross-platform).

## Status at handoff
- Branch `feat/unified-shell`, HEAD `6135b96`, **tree clean**, **NOT merged to main** (Trent's call when).
- Full sweep green: `pnpm typecheck` 0 errors (all 4 pkgs; web svelte-check 2075 files), `pnpm test` **555** (core 201 / io 13 / server 63 / web 278).
- Dev stack was running: web **:5173**, voice server **:4321** (`LEDRUMS_ENGINE=voice`). Confirm it's still up (`twux`/ports) before any live work.
- **Big owed item:** a live `:5173` spot-check of the whole session's work (none of it was browser-driven). See the ROUTER "INITIATIVE COMPLETE" entry for the checklist.

## YOUR MISSION (3 task groups Trent just gave)

### 1. CRUD completeness pass across the UI
Many UI elements only implement some of Create/Read/Update/Delete. Audit **every element/thing** and fill the gaps. Named asks:
- **Delete a section** (store likely has `removeSection`; the Sections UI exposes add/copy/paste/duplicate but probably not delete — wire it).
- **Rename a graph** (U2 added authored-graph rename via `store.graphNames` in the trigger Inspector; make rename a first-class, discoverable action across the UI — pad graphs label from the kit, authored graphs are renamable).
- **Rename a song** + **add new songs** (songs exist in `store.songs` / `setlist.ts`; check what's exposed — `addSong`/`renameSong`/select).
- **Name a show** (a "show" = the setlist/document level; today there is no show-naming or open/save/new/close — this is the long-deferred *setlist persistence* seam, see ROUTER "Unified application shell" → Remaining).
- Then sweep the rest: **buses, effects, presets, sections, graphs, drums** — each should support the full CRUD it sensibly can. Bring Trent the audit + a sliced plan before building.

### 2. Custom context-menu handler
Add a reusable **right-click context menu** so controls (especially the CRUD actions above) can be surfaced contextually. `bits-ui` (already the headless foundation, see ROUTER "Component foundation") has a **ContextMenu** primitive — wrap it in `apps/web/src/lib/ui/` on the oklch/green tokens (mirror the existing `Select`/`Dialog`/`Tooltip` wrappers). This is somewhat foundational — consider it early so CRUD actions can hang off it.

### 3. Remove the Kit view → replace with a Perform VIEW (collapse the mode toggle)
- **Remove the `kit` view; add a `perform` view.** `shell-nav.ts` today: `Mode = 'perform' | 'author'` and `View = 'trigger' | 'patch' | 'sections' | 'kit'`.
- **Perform stays inside the unified shell** — it's just a view that **hides the drawer (Layers/Buses dock) + the right dock (Visualizer/Inspector)** for a focused performance layout. (The 3D/2D visualizer + pads should still be reachable — reconcile with the OLD `apps/web/src/lib/app/PerformShell.svelte` content, which had visualizers + pads + recall strip; that mode-split shell + `App.svelte`'s Perform/Author crossfade get retired.)
- **This removes the Perform/Author toggle entirely.** "Author" is no longer a mode — it's simply whichever of Trigger / Patch / **Sections** / Perform is selected. So: collapse `Mode` out of `shell-nav`, make `App.svelte` a single shell, and the view rail becomes `Trigger · Patch · Sections · Perform`; the Perform view conditionally hides chrome.
- Touch points: `shell-nav.ts` (drop `Mode`, `View` kit→perform), `App.svelte` (de-mode), `chrome/LeftRail.svelte` (rail items), `views/KitView.svelte` (remove/repurpose), `PerformShell.svelte` (mine its content into the Perform view), the dock components (conditional render in Perform).

These three interact (context menu surfaces CRUD; the shell change touches the same chrome) — **scope with Trent first, then slice.**

## How to run this (what worked beautifully this session)
- **Parallel git-worktree agents, orchestrator-merged.** For independent slices, give each its own worktree + branch and merge yourself:
  ```bash
  git worktree add ../ledrums-wt-X -b wt/X feat/unified-shell
  ( cd ../ledrums-wt-X && pnpm install --prefer-offline )   # ~5s, warm pnpm store hardlinks
  twux launch --name X --split right --model opus --effort xhigh \
    --cwd ../ledrums-wt-X --role impl --doc docs/prompts/X.md --read docs/prompts/_worktree-note.md
  ```
  On report: `git merge --no-ff wt/X` (NOT `--ff-only | tail` — `tail` masks git's exit code, bit me once), check `git status` for conflicts, **full sweep**, `twux park`, `git worktree remove ../ledrums-wt-X && git branch -d wt/X`. Worktrees isolate same-file edits; you resolve the merges. Clean merges all session because briefs kept overlaps localized.
- **Sequence (don't worktree) work that shares the *same logic*** — e.g. U3→U4→U5 all rewrote the hit-resolution; splitting that = reconciling two rewrites by hand (slower). Worktree only genuinely-independent slices.
- **One task = one agent, disjoint files** (the worktree note `docs/prompts/_worktree-note.md` tells agents: commit in place, don't switch branches). Briefs live in `docs/prompts/*.md`.
- **Gate discipline:** agents use `pnpm --filter @ledrums/<pkg> typecheck/test` during work; YOU run the full `pnpm typecheck && pnpm test` on the merged clean tree after every merge. **Svelte MCP / `svelte:svelte-file-editor` is mandatory for `.svelte`.**
- **Verify from git, not pane scrapes.** Agents may report "done" green but the truth is in `git log/show/status`. Commit on their behalf only if needed (they've self-committed all session).
- **GROW after each milestone:** update `.mex/ROUTER.md` + `mex log --type decision`. NB: ROUTER gets edited by Trent/a linter occasionally — re-read before editing. Commit messages end with the Co-Authored-By + Claude-Session trailers (see existing commits).
- `twux usage` before launching; fine all session. Reports auto-surface as `[twux:msg]` 📬; a `twux wake --in Nm "…"` background task is a useful fallback (do NOT chain a foreground `twux wake` into a bash — it sleeps and times the bash out).

## What's already DONE this session (do NOT re-plan — see ROUTER for detail)
- **Patch Graph authoritative (S1–S8 + fixes):** data lines first-class + **dense/straddle** DMX packing + kit pixel defaults (Kick 196 / snare 108 / tom1 108 / tom2 136, see `docs/kit-hoop-pixel-counts.md` + memory `kit-hoop-pixel-counts`); per-node Inspector editors (drum geometry incl. **hoop-spacing + diameter**, zone MIDI/OSC, output universes, controller Art-Net/sACN + sACN priority/port/iface); **live server project autosave + single-client lock**; rail Views-above-Songs; patch **cold-load** routing-adopt fix. Rewiring the patch reroutes real Art-Net (voice mode). Memory `patch-graph-authoritative-intent`.
- **Triggers-as-nodes + sections (U1–U5 + V + fix):** trigger node has a **Drum/MIDI/OSC source** (`sim.ts` + `core/voice/types.ts`, `normalizeTriggerValue`); switch **`velocity` folded into `value`**; **input routing** (zone-map precedence → pad path; miss → core `resolveDirectGraphs` for authored graphs; no double-fire); **sections are flat graph lists** + `activeSectionId` merged (was active+arrange); **Play-Surface sidebar in `TriggerGraphView` replaced** by the active section's flat graph list (select → activate + open + highlight); **copy/paste/duplicate sections**; `assertShowIntegrity` accepts authored keys so a connected `setShow` with MIDI/OSC-bound graphs doesn't throw.

## Key architecture facts the new work needs
- **Store of truth:** `apps/web/src/lib/trigger-lab/store.svelte.ts` (the `TriggerLab` rune store) — owns `graphs`, `graphNames`, `songs` (each a `Song { id, name, sections: SetlistSection[] }`), `buses`, `presets`, `effects`, `activeSongId`, `activeSectionId`, `project` (adopted from the server `state` message). Authored state autosaves to localStorage (`persistence.ts`); routing/geometry/output live in the **server `Project`** (autosaved to `apps/server/projects/default.local.json`).
- **Sections (post-U4):** `SetlistSection = { id, name, graphs: string[] }` (flat ordered graph-key list — `setlist.ts`). Store API: `setActiveSection`, `selectGraphInSection`, `addGraphToSection`/`removeGraphFromSection`/`setSectionGraphs`, `copySection`/`pasteSection`/`duplicateSection`, `cloneSection`/`renameSection`/`addSection`/`removeSection` (check exact names in `setlist.ts`/store).
- **Shell:** `apps/web/src/lib/app/` — `App.svelte` (mode crossfade, to be de-moded), `shell-nav.ts` (pure reducer, unit-tested — `Mode`/`View` live here), `shell-store.svelte.ts`, `chrome/` (TopBar/ModeSwitch/LeftRail/SongRail/Transport), `views/` (TriggerGraphView/PatchGraphView/SectionsView/KitView), `docks/` (Visualizer/Inspector/Monitor/LayersDock).
- **UI primitives:** `apps/web/src/lib/ui/` (bits-ui wrappers on tokens — Select/Dialog/Tooltip/SegmentedControl/Field/IconButton/CommitInput…). Add the ContextMenu wrapper here. Icons: `@lucide/svelte` per-icon imports.
- Memories worth reading: `graph-interaction-prefs`, `subagent-dispatch-preference`, `parallel-agent-orchestration`, `patch-graph-authoritative-intent`, `kit-hoop-pixel-counts`.

## Parked agents (alive for audit — never close panes; this handoff re-parents them to you)
`trigger-authoritative-10d7f1` (the retiring orch) · S6 `s6-dense-routing-8969b9` · S7 `s7-live-persist-f06201` · U1 `u1-trigger-source-6786ea` · V `v-velocity-fold-f0e2da` · cold-load `fix-patch-coldload-f8b1e4` · U2 `u2-trigger-inspector-aad12b` · U3 `u3-routing-0dccdd` · hoop `hoop-spacing-a1335c` · diameter `drum-diameter-4e71f1` · U4 `u4-sections-330e85` · U5 `u5-copypaste-69b7a3` · integrity `fix-integrity-c58bf2` · (also `switch-value-4f4a8f`, `value-core-eval-7956fa` from a sibling orch's value/eval work). All done + parked.

## First move
Read ROUTER + skim the section/shell files above, then bring Trent a **scoped plan**: the CRUD audit (per element, gaps + slices), the ContextMenu primitive, and the Kit→Perform/de-mode shell change — and **get his sign-off before launching implementers** (the same discipline that ran this session). Then worktree-parallelize the independent slices.

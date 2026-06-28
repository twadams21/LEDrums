# Orchestration status — Recall · Generic graphs · Server shows · Objects (2026-06-27, initiative 2)

**Orchestrator command center** for the second overnight initiative. PRD:
`docs/plans/2026-06-27-recall-objects-persistence-prd.md`. Branch `feat/unified-shell`
(initiative 1 complete at `1deb187`; live `:5173` spot-check for it still owed —
`docs/handoff/2026-06-27-spot-check.md`).

## Sign-off (locked)
- **Show persistence:** SERVER-authoritative (reuse S7 project autosave + single-client lock); localStorage = cache.
- **Objects CRUD:** effects NOT deletable (rename/duplicate only); presets rename/duplicate + **delete only if unused** (`presetUsageCount===0`); songs/graphs full.
- **Pad-graph delete:** real + silent (no respawn).
- **Recall:** Program Change→song(+first section); CC#0 value→section in active song; OSC `/ledrums/song_<n>/section <v>`; CC#0 reserved.
- **Views:** Perform · Objects · Sections · Trigger · Patch.
- **Out:** componentisation pass (separate later plan); rename "Graphs" (vault doc only — done: `~/TWA/Personal/Projects/LEDrums/Naming - rethinking 'Graphs'.md`).

## Dependency graph
```
graphs-generic ──┐
objects-crud ────┼─► objects-view (rail reorder + new view)
recall-transport ┴─► section-inspector
(graphs-generic + objects-crud merged) ─► shows-server-persist ─► save-indicator
```

## Wave plan
- **Wave 1 (parallel):** `graphs-generic` · `objects-crud` · `recall-transport`.
  - graphs-generic + objects-crud both touch `store.svelte.ts` (graphs vs effects/presets regions — disjoint methods, localized). recall-transport is server/midi/ws + a trigger-source-editor touch (mostly disjoint).
- **Wave 2 (after Wave 1 merged):** `section-inspector` (needs recall-transport helper + graphs-generic base) · `shows-server-persist` (settled store; highest risk — keep relatively isolated) · `objects-view` (needs graphs-generic + objects-crud).
- **Wave 3:** `save-indicator` (after shows-server-persist — real save path).

## Status table
| Slice | Brief | Wave | Depends on | Agent | wt branch | Status | Commit | Merged |
|---|---|---|---|---|---|---|---|---|
| graphs-generic | `docs/prompts/graphs-generic.md` | 1 | — | graphs-generic-0c3b5e (parked) | wt/graphs-generic | ✅ MERGED | 4278fe2 | 6b7e9eb |
| objects-crud | `docs/prompts/objects-crud.md` | 1 | — | objects-crud-7f411e (parked) | wt/objects-crud | ✅ MERGED | 0cb5b50 | ad9c093 |
| recall-transport | `docs/prompts/recall-transport.md` | 1 | — | recall-transport-fc09c8 (parked) | wt/recall-transport | ✅ MERGED | af7576a | 6c9ba2e |
| section-inspector | `docs/prompts/section-inspector.md` | 2 | recall-transport ✅, graphs-generic ✅ | section-inspector-0b5869 (parked) | wt/section-inspector | ✅ MERGED | 76e8d8f | 880e195 |
| shows-server-persist | `docs/prompts/shows-server-persist.md` | 2 | graphs-generic ✅, objects-crud ✅ | shows-server-persist-eceb98 (parked) | wt/shows-server-persist | ✅ MERGED | 594baae | 0c06266 |
| objects-view | `docs/prompts/objects-view.md` | 2 | graphs-generic ✅, objects-crud ✅ | objects-view-feb9cf (parked) | wt/objects-view | ✅ MERGED | a1bb6d3 | d176eca |
| save-indicator | `docs/prompts/save-indicator.md` | 3 | shows-server-persist ✅ | save-indicator-272a56 (parked) | wt/save-indicator | ✅ MERGED | 913675c | 8227e6d |

## ✅ ALL 7 SLICES MERGED — initiative 2 COMPLETE (HEAD `8227e6d`, pushed)
Final sweep green: typecheck 0 (2097 web files); **699 tests** (core 201 / io 13 / server 80 / web 405).
GROW done: ROUTER + `mex log`. **OWED: live `:5173` spot-check** → `docs/handoff/2026-06-27-spot-check-2.md` (recall path end-to-end + server-persisted-show cold-load especially). **Next: componentisation pass** (its own explore→scope→plan→build).

## Recipes (same as initiative 1)
- Launch: `git worktree add ../ledrums-wt-<slug> -b wt/<slug> feat/unified-shell` → `(cd … && pnpm install --prefer-offline)` → `twux launch --name <slug> --split right --model opus --effort xhigh --cwd ../ledrums-wt-<slug> --role impl --doc docs/prompts/<brief>.md --read docs/prompts/_worktree-note.md`.
- On report: `twux inbox --read` → verify from git → `git merge --no-ff wt/<slug>` → full `pnpm typecheck && pnpm test` → `twux park` + `git worktree remove …` + `git branch -d …` → push → update this table.
- **Usage:** `twux usage` before each wave; if 5h > ~90%, hold + `twux wake --at <reset>`. 5h reset cycle ~04:40/09:40.
- **Wake-ups:** always keep one armed (`twux wake --in Nm "…"` background). Reports nudge via 📬.
- **GROW at end:** ROUTER + `mex log`; push; write owed live `:5173` spot-check (recall path end-to-end + server-persisted-show cold-load especially).

## Definition of done
All 7 slices merged + pushed, full sweep green, ROUTER + tracker updated, parked agents cleaned, spot-check checklist written.

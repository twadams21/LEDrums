# Orchestration status — CRUD · Context Menu · Kit→Perform (2026-06-27, overnight)

**Orchestrator command center.** Live state of the autonomous overnight build. Trent is
asleep and wants to wake to everything done. PRD: `docs/plans/2026-06-27-crud-context-perform-prd.md`.
Branch `feat/unified-shell`. Update this doc as waves progress (it survives context
summarization + any orch handoff).

## Sign-off (locked before sleep)
- **Show scope:** FULL document model (new/open/save/close/rename/delete + switching).
- **CRUD breadth:** named asks + clearly-expected (sections, songs, graphs, show name).
  Effects/presets/buses left as-is.
- **Tracker:** `docs/*` — PRD in `docs/plans/`, issue briefs in `docs/prompts/`. No GitHub
  Issues.
- **Mode:** orchestrator kicks off + manages ALL impl agents to completion; watch usage;
  always keep a wake-up armed (twux wake bg task / ScheduleWakeup).

## Save state
- `19a2d2a` pushed to `origin/feat/unified-shell` (56 commits) — clean restore point.
- Planning docs commit: PRD + 7 briefs + this doc (see git log).

## Slices & dependency graph
```
ctx-menu-primitive ──┬─► crud-section ─► crud-graph
                     ├─► crud-song
                     └─► show-browser-ui ◄── show-document-model ◄── (CRUD batch merged)
shell-demode-perform (independent, parallel from start) ─► (TopBar settled for show-browser-ui)
```

## Wave plan
- **Wave 1 (parallel, file-disjoint):** `ctx-menu-primitive` + `shell-demode-perform`.
- **Wave 2 (parallel, after ctx-menu merged):** `crud-section` + `crud-song` + `crud-graph`.
  - Merge order for the SectionsView overlap: **crud-section before crud-graph**.
  - crud-song (SongRail) is fully disjoint — merge anytime.
  - shell-demode-perform merges whenever it reports (disjoint from CRUD).
- **Wave 3 (after CRUD batch merged):** `show-document-model` → then `show-browser-ui`
  (also needs shell merged for TopBar).

## Status table
| Slice | Brief | Wave | Depends on | Agent id | wt branch | Status | Commit | Merged |
|---|---|---|---|---|---|---|---|---|
| ctx-menu-primitive | `docs/prompts/ctx-menu-primitive.md` | 1 | — | ctx-menu-60e42a (parked) | wt/ctx-menu | ✅ MERGED | f346569 | 47f2b9c |
| shell-demode-perform | `docs/prompts/shell-demode-perform.md` | 1 | — | shell-f0a260 (parked) | wt/shell | ✅ MERGED | 1347968 | f088e67 |
| crud-section | `docs/prompts/crud-section.md` | 2 | ctx-menu ✅ | crud-section-314c5b (parked) | wt/crud-section | ✅ MERGED | f9cef20 | 8897aec |
| crud-song | `docs/prompts/crud-song.md` | 2 | ctx-menu ✅ | crud-song-e0d2cc (parked) | wt/crud-song | ✅ MERGED | 116c31d | 5b9dcd7 |
| crud-graph | `docs/prompts/crud-graph.md` | 2 | ctx-menu ✅, crud-section ✅ | crud-graph-a26adf (parked) | wt/crud-graph | ✅ MERGED | 44dd6fb | aff97c8 |
| show-document-model | `docs/prompts/show-document-model.md` | 3 | CRUD batch ✅ | show-model-fb2df0 (parked) | wt/show-model | ✅ MERGED | f61e876 | 2e2793e |
| show-browser-ui | `docs/prompts/show-browser-ui.md` | 3 | show-model ✅, ctx-menu ✅, shell ✅ | — | wt/show-ui (pre-staged @2e2793e, deps in) | ⏸ HELD for 04:40 5h reset (5h hit 96%) | — | — |

## Per-agent worktree launch recipe
```bash
SL=<slice>; WT=../ledrums-wt-$SL; BR=wt/$SL
git worktree add "$WT" -b "$BR" feat/unified-shell
( cd "$WT" && pnpm install --prefer-offline )         # ~5s, warm pnpm store
twux launch --name "$SL" --split right --model opus --effort xhigh \
  --cwd "$WT" --role impl --doc "docs/prompts/$SL.md" --read docs/prompts/_worktree-note.md
```

## On report (merge/verify/park loop)
1. `twux inbox --read` (drain), then VERIFY from git — `git -C <wt> log/show/status`, not pane scrapes.
2. `git merge --no-ff <BR>` (NOT `--ff-only | tail` — tail masks exit code). Resolve any overlap.
3. Full sweep on the merged tree: `pnpm typecheck && pnpm test`. Record totals.
4. `twux park --session <id>`; `git worktree remove <WT> && git branch -d <BR>`.
5. Update this table; unblock the next wave; `mex log` if rationale matters.

## Operational discipline
- **Usage:** `twux usage` before each wave. If 5h > ~90%, don't launch — arm
  `twux wake --at <reset_iso> "usage reset — resume"` (bg) and pause. 5h reset was
  ~04:40+10:00; 7d at ~53%.
- **Wake-ups:** always keep one armed — `twux wake --in <N>m "<what>"` as a **background**
  Bash task (never foreground — it sleeps + times out the shell), or `ScheduleWakeup`.
  Agent reports also nudge via 📬. Re-arm after every check-in.
- **Gates:** agents use `pnpm --filter @ledrums/<pkg> …` during work; orchestrator runs the
  FULL sweep after each merge on the clean merged tree.
- **Svelte:** MCP / svelte-file-editor mandatory for `.svelte`.
- **Ports (dev stack):** web :5173, voice server :4321 (`LEDRUMS_ENGINE=voice`).
- **GROW at the end:** update `.mex/ROUTER.md` (re-read first — Trent/linter may edit it) +
  `mex log --type decision`; final push; leave the owed live `:5173` spot-check flagged.

## Definition of done (wake-up state)
All 7 slices merged to `feat/unified-shell`, full sweep green (typecheck 0; test totals
recorded), pushed to origin, ROUTER updated, this table all MERGED, a crisp summary in the
inbox/here for Trent, and the owed live spot-check checklist written down.

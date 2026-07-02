# Rock Solid — orchestration workflow (twux)

The operating manual for executing issues #46–#57 (49 slices, `slices/INDEX.md`). Locked with
Trent 2026-07-02 (rev 2 — lane restructure + escalation/autonomy policy after /loop-me grilling).
Every agent in the hierarchy reads this file; role-specific sections below.

## Hierarchy & models

| Role | Model/effort | Does | Deliberately does NOT |
|---|---|---|---|
| **Master orch** (1, long-lived — THE main orchestrator; Trent's planning chat is retired) | `--model opus --effort high` | 30-min wake cadence; verifies the active lane orch is alive/progressing; merges each completed+reviewed **group branch** → `rock-solid` (+ full sweep); fires the next lane orch when a lane completes; owns the tracker; escalates to Trent | Implementation, review, slice-level anything |
| **Lane orch** (1 at a time, long-lived across its lane's feature groups) | `--model fable --effort high` | Runs its lane's feature groups in order; launches impls per dependency order; merges slice branches → group branch + resolves conflicts; full sweep AFTER each merge; **runs the FULL review of each group's diff** (vs its context doc(s) + slice file) before handing the group branch to the master; kills impl panes when confident; cleans up merged branches; writes group + lane reports | Writing feature code (beyond trivial merge fallout); re-running tests impls already ran |
| **Implementer** (≤2–3 parallel) | `--model opus --effort xhigh` | One slice end-to-end in an assigned worktree; incremental commits; full sweep; committed report | Scope creep; touching files outside the slice's touch list without noting it |

**UI slices are Opus.** The design system (`docs/design-system.html`, `pnpm design-system`,
AGENTS.md rule) replaces Fable-tier UI judgment: compose from the system, copy its source
pointers, extend the styleguide entry + regenerate in the same change. `ui-significant` means
"must engage the design system deeply," not "needs Fable."

## Lanes (serial — a lane completes before the next starts)

A **lane** = one lane-orch lifetime spanning related feature groups. A **feature group** keeps
its own branch, GitHub issue, and review. Dependency chains are internal to lanes by design.

| Lane | Feature groups, in order | Slices | Why grouped |
|---|---|---|---|
| **1 — Core reliability** | A → B → E | S01–S05, S12–S17 (11) | Hardening first (everything graph-touching builds on it); confidence surfaces; the authority principle |
| **2 — Effects & graph** | F → G → H → I | S18–S38 (21) | The whole creative arc; F→H→I dependency chain internal; orch context compounds across it |
| **3 — Data & portability** | J → K | S39–S45 (7) | Library closure feeds clipboard |
| **4 — Shell & hardware** | C → D → L | S06–S11, S46–S49 (10) | Desktop, layout/geometry, PixLite (L.S48 needs B.S03 — satisfied by lane 1) |

## Branch & worktree topology

- Integration branch: **`rock-solid`** (master creates off `main` at start; merges to `main`
  only at the final gate, with Trent).
- Group branch: **`group/<letter>`** off `rock-solid` at group start (lane orch creates).
- Slice branch: **`slice/S##`** off the group branch (impl creates in its worktree).
- **Long-lived worktree pool**: three worktrees `../ledrums-wt/wt-1|2|3`, created once by the
  master (`git worktree add ../ledrums-wt/wt-N rock-solid` + `pnpm install` in each). Rationale:
  installs and build caches amortize; one shared local repo means branches are visible across
  worktrees without pushing.
  - Assignment discipline: lane orch assigns a free worktree per slice. Before assigning:
    `git -C <wt> status --porcelain` must be EMPTY (dirty → investigate, then hard-clean).
    Impl starts: `git -C <wt> fetch --all && git -C <wt> switch -c slice/S## group/<letter>`.
  - Cleanup: delete **merged slice/group branches** as you go; worktrees persist (destroy +
    recreate only on corruption). Master removes the pool at initiative end.

## Commits — the heartbeat and the history

- Impls commit **incrementally**: one intent per commit, subject `S##: <intent>`. Commits are
  the liveness signal: lane orch checks `git -C <wt> log --oneline -5 slice/S##` (cheap, no
  pane capture). No commits ~20 min AND pane idle → check in via `twux send-message`.
- Push branches to origin opportunistically (backup); local refs are what merges use.

## Handoff — reports travel through git

The impl report IS the context pack, **committed on the slice branch** at
`docs/handoff/rock-solid/S##.md` as the final commit — it flows through merges and is readable
from any worktree after a fetch. Template:

```markdown
# S## — <title> (<group>, issue #NN)
## Summary            <what now works, 3-6 lines, demoable-thing first>
## Commits            <from git log --oneline, one line each — the intent trail>
## Files touched      <git diff --stat vs group branch base>
## Context pack       <ONLY substantive when a dependent slice follows (slices/INDEX.md):
                       seams touched + their new invariants, gotchas, decisions + why, exact
                       pointers (file:symbol) the next agent needs, what NOT to redo>
## Acceptance         <the slice file's checkboxes, each with one line of evidence>
## Gates              <typecheck 0; test counts per pkg; any skips = explain>
## Deviations         <anything outside the touch list / brief, and why>
```

- **Closely-coupled successor** (direct dependency in the INDEX table): lane orch passes the
  predecessor's report as an extra `--read` on the next impl's launch. Minimal file overlap →
  don't.
- Group report (lane orch, `docs/handoff/rock-solid/group-<letter>.md`): per-slice one-liners,
  merge/conflict notes, **review findings + resolutions**, and a group-level context pack for
  dependent groups/lanes.

## Testing & review policy

- Impl: full sweep (`pnpm typecheck && pnpm test`) green before the report commit; slice
  acceptance criteria all evidenced.
- Lane orch: does NOT re-run impl suites. Runs the full sweep **after every merge into the group
  branch**; fixes trivial merge fallout itself; non-trivial → back to the responsible impl.
- **Group review (the deep pass)**: when a group's slices are all merged, the lane orch reviews
  the full group diff against the group's context doc(s) + slice file + AGENTS.md
  non-negotiables. Findings: fix directly if trivial, else fix-slices via impls. Only then does
  it hand the group branch to the master.
- Master: full sweep after merging a group branch → `rock-solid`.
- Pre-final-gate (recommended, master runs it): one cross-lane seam review (single Fable
  reviewer) over the seams between lanes — routing↔looks↔modulation authority, modifier↔
  modulation wiring infra, library↔clipboard closure — before the final gate.

## Escalation & Trent's checkpoints (LOCKED)

- **Escalations + final gate ONLY.** No per-track/lane briefs to Trent; the tracker is the
  observable state (he reads it and GitHub when he wants).
- **Blocking escalation** (product decision — e.g. doc 11's two open UX items — non-negotiable
  violation, unresolvable merge, budget override): the **master asks Trent via the
  AskUserQuestion tool** (he gets a phone notification). Decision-ready: context, options,
  recommended answer first. Before asking, ensure everything unblocked is in flight — the
  question must never idle the crew. Lane orchs escalate to the master; only the master asks
  Trent.
- Non-blocking notes → `ESCALATIONS`/notes section at the top of the tracker.
- **Final gate (blocking)**: `rock-solid` → `main` merge + the consolidated live spot-check
  (browser + hardware) — asked via AskUserQuestion, never autonomous.

## Usage budget (LOCKED)

The crew's budget is **~70% of the 5h window** — stop NEW launches when `twux usage` 5h ≥ 70%
(leave Trent ~30% headroom for interactive work); let in-flight impls finish; `twux wake --at
<reset>` and resume automatically, 24/7. twux's own 85/90/95 gates remain the hard backstop.
Trent can override the 70% budget by telling the master.

## Master context discipline (LOCKED)

The master must not become a god thread. At the START of every wake: write current state to the
tracker (in-flight lane/group/slices, last verified evidence, next actions) BEFORE doing
anything — assume the context window can vanish (compaction) at any moment; the tracker +
this file must always be enough for a successor. At low context, `twux handoff` with the
tracker as the doc (children re-parent automatically).

## Launch mechanics

- Lane orch per slice: write `docs/handoff/rock-solid/S##-assignment.md` (slice ID, worktree
  path, base branch, branch name, report path, extra reads), then:
  `twux launch --name S##-<slug> --role impl --doc docs/handoff/rock-solid/S##-assignment.md
  --read docs/plans/2026-07-02-rock-solid/slices/<group>.md --read <context doc(s)>
  [--read docs/handoff/rock-solid/S<dep>.md] --model opus --effort xhigh --cwd <worktree> --split right`
- Master per lane: `twux launch --name lane-<n> --role orch
  --doc docs/plans/2026-07-02-rock-solid/ORCHESTRATION.md
  --read docs/plans/2026-07-02-rock-solid/slices/INDEX.md --model fable --effort high`
  then send-message the lane assignment (lane number + group order). A lane orch reading this
  file: you are the Lane-orch row; your lane is in your assignment message.
- **Parallelism cap: 2–3 impls max**, within the slice dependency table.

## Pane lifecycle (kill, don't park)

Slice merged + sweep green + acceptance checked → `twux kill --session <impl>` (resumable from
the registry; git + reports are the audit trail). Master kills the lane orch after its last
group merges. Memory is the constraint; tidy panes are not the goal.

## Master tracker

`docs/handoff/2026-07-02-rock-solid-tracker.md` — ESCALATIONS/notes on top; one row per feature
group (lane, status, branch, merged-at, report link); state snapshot per wake. Master commits it
on `rock-solid`.

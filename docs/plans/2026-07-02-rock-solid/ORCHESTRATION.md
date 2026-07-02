# Rock Solid — orchestration workflow (twux)

The operating manual for executing issues #46–#57 (49 slices, `slices/INDEX.md`). Locked with
Trent 2026-07-02. Every agent in the hierarchy reads this file; role-specific sections below.

## Hierarchy & models

| Role | Model/effort | Does | Deliberately does NOT |
|---|---|---|---|
| **Supervisor** (Trent's main session) | — | Watches the master on a loop; intervenes only when stuck | Anything else |
| **Master orch** (1, long-lived) | `--model opus --effort high` | 30-min wake cadence; verifies the track orch is alive/progressing; merges a completed track branch → `rock-solid` (+ full sweep); fires the next track orch; updates the tracker | Implementation, review, slice-level anything |
| **Track orch** (1 at a time) | `--model fable --effort high` | Launches impls per dependency order; merges slice branches → track branch + resolves conflicts; full sweep AFTER each merge; acceptance-check vs the slice file; kills impl panes when confident; cleans up branches; writes track report | Writing feature code; re-running tests impls already ran; deep review absent signals |
| **Implementer** (≤2–3 parallel) | `--model opus --effort xhigh` | One slice end-to-end in an assigned worktree; incremental commits; full sweep; committed report | Scope creep; touching files outside the slice's touch list without noting it |

**UI slices are Opus now.** The design system (`docs/design-system.html`, `pnpm design-system`,
AGENTS.md rule) replaces Fable-tier UI judgment: compose from the system, copy the source
pointers, extend the styleguide entry + regenerate in the same change. The `ui-significant` tag
now means "must engage the design system deeply," not "needs Fable."

## Branch & worktree topology

- Integration branch: **`rock-solid`** (master creates off `main` at start; merges back to main
  only at initiative end, with Trent).
- Track branch: **`track/<letter>`** off `rock-solid` at track start (track orch creates).
- Slice branch: **`slice/S##`** off the track branch (impl creates in its worktree).
- **Long-lived worktree pool** (DECIDED — not temp worktrees): three worktrees
  `../ledrums-wt/wt-1|2|3`, created once by the master (`git worktree add ../ledrums-wt/wt-N
  rock-solid` + `pnpm install` in each). Rationale: worktree creation is cheap but installs and
  vite/ts caches are not; a pool matching the 2–3 parallel cap amortizes both, and all agents
  share one local repo so **branches are visible across worktrees without pushing**.
  - Assignment discipline: track orch assigns a free worktree per slice. Before assigning:
    `git -C <wt> status --porcelain` must be EMPTY (if dirty: investigate, then hard-clean).
    Impl starts with `git -C <wt> fetch --all && git -C <wt> switch -c slice/S## track/<letter>`.
  - Cleanup: delete **merged slice branches** as you go; worktrees persist. Destroy + recreate a
    worktree only on corruption. Master removes the pool at initiative end.

## Commits — the heartbeat and the history

- Impls commit **incrementally**: one intent per commit, subject `S##: <intent>`, body optional
  but encouraged for why. Commits are the liveness signal: the track orch checks progress with
  `git -C <wt> log --oneline -5 slice/S##` (cheap; no pane capture needed) — no commits in ~20
  min AND pane idle → check in via `twux send-message`.
- Push slice branches to origin opportunistically (backup); local refs are what merges use.

## Handoff — reports travel through git (DECIDED)

The impl report IS the context pack, and it's **committed on the slice branch** at
`docs/handoff/rock-solid/S##.md` as the final commit — so it flows through merges and is
readable from any worktree after a fetch. Template:

```markdown
# S## — <title> (<track>, issue #NN)
## Summary            <what now works, 3-6 lines, demoable-thing first>
## Commits            <generated from git log --oneline, one line each — the intent trail>
## Files touched      <git diff --stat vs track branch base>
## Context pack       <ONLY substantive when a dependent slice follows (see slices/INDEX.md):
                       seams touched + their new invariants, gotchas hit, decisions made and
                       why, exact pointers (file:symbol) the next agent needs, what NOT to redo>
## Acceptance         <the slice file's checkboxes, each with one line of evidence>
## Gates              <typecheck 0; test counts per pkg; any skips = explain>
## Deviations         <anything outside the touch list / brief, and why>
```

- **Closely-coupled successor** (direct dependency in the INDEX table): track orch passes the
  predecessor's report as an extra `--read` on the next impl's launch. **Minimal file overlap**:
  don't — the slice file + context doc suffice.
- The track report (by the track orch, `docs/handoff/rock-solid/track-<letter>.md`) is the same
  shape one level up: per-slice one-liners + merge/conflict notes + track-level context pack for
  any dependent TRACK (H needs A+F, I needs H+F, K needs J, L.S48 needs B.S03).

## Testing policy (DECIDED)

- Impl: full sweep (`pnpm typecheck && pnpm test`) green before the report commit. Slice-file
  acceptance criteria all evidenced.
- Track orch: does NOT re-run the impl's suite. Runs the full sweep **after every merge into the
  track branch** (that's what catches cross-slice interaction), and fixes trivial merge fallout
  itself; non-trivial fallout → relaunch/message the responsible impl.
- Master: full sweep after merging a track branch → `rock-solid`.

## Launch mechanics

- Track orch per slice: write a 5-line assignment file `docs/handoff/rock-solid/S##-assignment.md`
  (slice ID, worktree path, base branch, branch name, report path, extra reads), then:
  `twux launch --name S##-<slug> --role impl --doc docs/handoff/rock-solid/S##-assignment.md
  --read docs/plans/2026-07-02-rock-solid/slices/<group>.md --read <context doc(s)>
  [--read docs/handoff/rock-solid/S<dep>.md] --model opus --effort xhigh --cwd <worktree> --split right`
- Master per track: `twux launch --name track-<letter> --role orch
  --doc docs/plans/2026-07-02-rock-solid/ORCHESTRATION.md
  --read docs/plans/2026-07-02-rock-solid/slices/<group-file>.md --model fable --effort high`
  (a track orch reading this file: your track = the group file in your `--read`; follow the
  Track-orch row above.)
- **Parallelism cap: 2–3 impls max**, only within what the slice dependency table allows.
- **Usage**: twux gates launches automatically; additionally check `twux usage` before each wave —
  above ~85% 5h, don't start a new wave; `twux wake --at <reset>` and resume then.

## Pane lifecycle (DECIDED — kill, don't park)

When the track orch has merged a slice, sweep green, acceptance checked: `twux kill --session
<impl>` (resumable from the registry if ever needed; git + reports are the audit trail, not
panes). Master kills the track orch after the track merge. Memory is the constraint; tidy panes
are not the goal.

## Track order (serial — one track completes before the next starts)

`A` (pilot: 1 slice, proves the whole pipeline) → `B` (4 independent slices: proves the
parallel+merge machinery) → `F` → `E` → `G` → `H` → `J` → `C` → `D` → `K` → `L` → `I`.
Constraints honored: H after A+F(S18); I after H(S29)+F(S23); K after J(S40); L.S48 after B(S03).
Master may reorder within constraints if a track blocks.

## Master tracker

`docs/handoff/2026-07-02-rock-solid-tracker.md` — one row per track (status, branch, merged-at,
report link). Master updates it at each wake / track completion; commits on `rock-solid`. On
low context, master hands off via `twux handoff` with this file + the tracker as the doc.

## Escalation

Anything requiring a product decision (two open items live in doc 11), a non-negotiable
violation, or a stuck merge the track orch can't resolve in one attempt → report up (track →
master → supervisor inbox). Don't guess on locked decisions — they're in the context docs.

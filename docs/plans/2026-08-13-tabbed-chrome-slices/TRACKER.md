# Tabbed-chrome initiative — fleet tracker

Orchestrator session doc. Updated by the orchestrator only. Task ledger of record: the
session task list (TaskList); this file carries what that can't — ops state + dispatch notes.

## State (2026-08-13 ~02:30 +10:00)

- PR #174 merged → `main` @ `10b1b46` (DM Sans + dev --share). All slices branch off this or later.
- Decisions locked (Trent, in-session, recorded in the parent plan): permanent right column ·
  presence/takeover top bar, bottom = read-only stats · unassigned-hoops pool.
- 5h usage was 90%+ at session start → **no launches until reset** (~03:20 +10:00).
  `twux wake --at reset` armed (background task). Usage monitor armed: alerts at 90/93/95/97,
  self-tears-down at 97. At 97: SendMessage every running agent to pause + commit WIP;
  wake resumes the fleet after reset.
- Trent asleep. Morning queue: S4a pane-spec review (tracked ask), S6 go/no-go (hardware
  drive through Settings — never dispatch S6 without his explicit go).

## Wave plan (seam-gated, ≤3 wide)

| Wave | Slices | Preconditions |
| --- | --- | --- |
| 1 | S2 (tabbed shell, fable/high) ∥ S4a (pane spec doc, fable/high) | usage reset |
| 2 | S3 (trigger rail) ∥ S4b (Drums&Hoops) ∥ S4c (Outputs&Chains) — all fable/medium | S2 merged, S4a spec pushed |
| 3 | S4d (Controller) ∥ S4e (Input+System) ∥ S5 (right column) — fable/medium | wave 2 merged |
| gate | adversarial review per wave + track-level (high effort) | each wave merged |
| hold | S6 (patch removal) → S7 (proto teardown) | S4b–e merged + **Trent's explicit go** |

Seams: S2 owns shell files (AuthorShell, shell-nav, chrome/*, settings modal shell). S4 panes
are file-disjoint per S4a's fencing section (one import line each into the modal registry —
orchestrator resolves trivial registry conflicts at merge). S3 owns TriggerGraphView +
GraphsDock. S5 owns the right-column mount (AuthorShell seam with S2 → S5 runs after S2).

## Dispatch mechanics

- Launch: `twux launch --role <slice> --doc <ABSOLUTE brief path> --model fable` (+ effort per
  brief). Briefs live in this directory; pass absolute paths — the parent plan is NOT on main
  yet, so worktree-relative reads fail. Pass the parent plan as additional reading.
- Workers use the standing worktree pool (`twux worktree`); every brief opens with
  checkout + history-check boilerplate (expected ancestor `10b1b46`).
- Merges: serial, orchestrator-only, full sweep (`pnpm test` + `pnpm typecheck`) per merge.
  Lockfile-touching merge → `pnpm install` before blaming the sweep.
- Reports arrive via SendMessage. Verify from git, never from the message alone
  (`/done-gate` orchestrator branch). Arm `twux wake --in 25m --supersede-on <session>`
  after each launch as the stall net.

## Ledger (fill at dispatch)

| Slice | Session | Branch | Launched | Verdict |
| --- | --- | --- | --- | --- |
| S1-residual | orchestrator (no agent) | chore/dm-sans-design-system | pre-reset | — |

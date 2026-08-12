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

## TRANSPORT FLIP (Trent, 2026-08-13 ~02:50): dynamic Workflow, NOT twux

Fable implementer agents via the Workflow tool (worktree isolation), launch at 03:20 reset.
Agents run NO gates (no install/test/typecheck/ui-shot) — orchestrator runs ONE full sweep per
wave after serial merges, then dispatches a fix wave for what it finds. Simplicity is an
explicit requirement in every prompt. Integration branch `feat/tabbed-chrome` (off main after
PR #175 lands); one PR into main at the end so the parity conditional never breaks on main.
Scripts: scratchpad/wave1.workflow.js (S2∥S4a∥S3), wave2.workflow.js (S4b∥S4c∥S4d∥S4e∥S5).
Orchestrator owes per-wave: merges → pnpm install → full sweep → design-system regen →
ui-shot pass → fix wave if red → adversarial review after wave 2.

## Wave plan (superseded by the transport flip above — width now 3 then 5)

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

## Ledger

| Slice | Transport | Branch | Verdict |
| --- | --- | --- | --- |
| S1-residual | orchestrator | chore/dm-sans-design-system | ✅ PR #175 merged (main `0f82013`) |
| S2 shell | wave1 wf_a93420a7 | feat/s2-tabbed-shell `83edcbe` | ✅ merged `5966d0f`; sweep green after stub-prop fixup |
| S3 rail | wave1 wf_a93420a7 | feat/s3-trigger-rail `8c9a4b2` | ✅ merged `dcf5748`; sweep green after SongsBar test-scoping fixup (orchestrator) |
| S4a spec | wave1 wf_a93420a7 | docs/s4a-pane-spec `c6fefb7` | ✅ merged `117e1aa`; spec at S4a-pane-spec-OUTPUT.md; 4 sign-off items queued for Trent (spec §5) |
| wave-1 gate | orchestrator | feat/tabbed-chrome `264eb8e` | ✅ typecheck 0; tests green (core 1001/server 445/web 1704/io 76/proto 10/worker 31); design-system regen |
| S4b drums&hoops | wave2 wf_a7b9464b | feat/s4b-drums-hoops `0f77560` | ✅ merged `513fef9` |
| S4c outputs&chains | wave2 wf_a7b9464b | feat/s4c-outputs-chains `74b336b` | ✅ merged `2717a9e`; chain-editor pure seam + 15 tests; styleguide entry |
| S4d controller | wave2 wf_a7b9464b | feat/s4d-controller `fea853d` | ✅ merged `622cef0`; watch lifecycle verified correct |
| S4e input+system | wave2 wf_a7b9464b | feat/s4e-input-system `007934c` | ✅ merged `8d456ce`; flagged GeneralPane duplication |
| S5 right column | wave2 wf_a7b9464b | (no commits) | ✅ verification-only: S2 already correct; Perform keeps full-width hide (today's behaviour) |
| wave-2 gate | orchestrator | feat/tabbed-chrome `5240868` (pushed) | ✅ typecheck 0 (2721 files); tests green (core 1001/server 445/web 1733/io 76/proto 10/worker 31); fixups: GeneralPane trimmed to GlobalControls, backups-button aria-label, design-system regen |

## Remaining (at 08:20 reset — 5h window hit 92% post-wave-2)

1. Adversarial review workflow (high effort, ~3 reviewers) over the full feat/tabbed-chrome diff vs main; one fix loop.
2. ui-shot captures of: tabbed shell (each view), Settings modal (all 6 panes), trigger rail.
3. PR feat/tabbed-chrome → main (single PR; parity contract satisfied by construction).
4. ROUTER/GROW update + morning report to Trent.

## Morning queue for Trent

1. S4a spec sign-off (defaults accepted overnight, S4b–e built against them): geometry globals
   → Drums & Hoops; holder-node labels die; mirror revived in Controller pane; patch
   copy/paste orphans die in S6. Spec §5 has the arguments.
2. S2 deviations to eyeball: AppSettingsDialog folded into Settings→General; SongRail deleted
   (unreferenced after LeftRail); mockController retargeted to Settings→Controller.
3. ui-shot visual pass + your hardware drive through Settings → then S6 go/no-go.

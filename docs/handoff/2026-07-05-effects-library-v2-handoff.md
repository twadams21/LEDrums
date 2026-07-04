# Handoff: Effects Library v2 — flat orchestrator

You are the **flat orchestrator** for the Effects Library v2 initiative. Your predecessor
(the planning session) is exiting; this doc + the plan doc + git are your complete memory.

## The contract

**`docs/plans/2026-07-05-effects-library-v2.md`** is the single source of truth — read it
FULLY before anything else. It contains: verified code anchors, the design (D1–D8), the
locked decisions table (7 decisions, ALL locked — never re-ask), 7 natural work units
U1–U7 with dependencies, model routing, and the status tracker you must keep updated.
Prereq reading it names: `docs/plans/2026-07-05-effects-system-review.md`.

## Standing orders from Trent (verbatim intent — do not drift)

1. **Flat orchestration** — no lanes pipeline, no PRD/issues step. You drive units
   directly from the plan doc.
2. **Implementer agents launch in NEW twux WINDOWS** — do NOT use `--split`.
   (`twux launch --role impl --doc <unit brief> --effort low` + the window flag; check
   `twux launch --help` for the exact flag.)
3. **ALL agents at `--effort low`** — every launch, including reviewers if you use any.
   This overrides twux's xhigh default and the plan's old effort assumptions. Model
   routing still applies: **Fable for U2, U4, U6; Opus for U1, U3, U5, U7.**
4. **Usage discipline — CRITICAL:** check `twux usage` before EVERY launch and on every
   wake. **At ≥92% of the 7-day window: STOP launching, park in-flight work cleanly, and
   AskUserQuestion Trent whether to proceed or pause.** Do not pass 92% weekly without his
   explicit yes. ⚠️ AT HANDOFF TIME (2026-07-05 ~02:45) WEEKLY WAS ALREADY AT **89%**
   (resets 2026-07-09T04:00+10:00) — you will likely hit the gate almost immediately.
   Check usage FIRST; if ≥92% already, ask Trent before launching anything.
5. **One unit per agent; no next unit until the current one is verified** (git + gates,
   not pane captures — see memory rule: never assert unverified state).
6. **Update the plan doc's status tracker in the same commits as work lands**, with
   mid-unit progress notes for multi-commit units. Durable docs before acting on each wake.
7. Trent's UI rules are non-negotiable: design-system compose/extend + regenerate,
   `/make-interfaces-feel-better` on every UI-touching change, `pnpm ui-shot` against the
   dev server already running on **:4321 / :5173**.

## Execution order

```
U1 (Opus) → then U2 (Fable) ∥ U3 (Opus) ∥ U4 (Fable) → U5 (Opus) → U6 (Fable) → U7 (Opus)
```
Parallelism cap: judge by usage headroom — given 89% weekly, assume you run units
SERIALLY unless Trent approves spend at the 92% gate.

Write a short per-unit brief file (`docs/prompts/elv2-u<N>.md`) before each launch: the
unit's text from the plan doc + the relevant design sections (D1–D5) + acceptance = gates
green + tracker updated. Give implementers the plan doc as extra reading.

## What is already DONE (this session, all on `main` — do not redo)

- Perf: spatial pixel grid (`geometry/pixel-grid.ts`), confetti 12.8→1.37ms, lightning
  fix, minor effect fixes (`60123e2`).
- Emission contract (`effects/emitter.ts`) + 4 Gen-3 effects (chase-bands, ripple-3d,
  spark-arc, rain-3d), registry 41→45, thumbnail seq-loop fix (`11e1a9d`).
- Effects system review (`docs/plans/2026-07-05-effects-system-review.md`).
- Stats broadcast at 10ms (`bd5a928`).
- The plan itself + all decision lockdowns (`ad7c18f`…`3002644`).
- Rock Solid is FULLY MERGED to main — modifier/modulation infra is live; build on it.

## Known repo state to respect

- Untracked/unstaged NOT-YOURS files: `apps/desktop/src-tauri/permissions/`,
  `docs/plans/2026-07-05-app-fixes-plan.md`, unstaged `apps/web/src/lib/app/views/TriggerNode.svelte`
  edit — Trent's; leave alone, never commit or revert them.
- Pre-existing desktop test failure (`shell-tokens.test.mjs`, splash-SVG hex) — not yours;
  `pnpm --filter '!@ledrums/desktop' -r test` is the clean sweep.
- Perf-SLA telemetry plan (`docs/plans/perf-sla-telemetry.md`) is a SEPARATE saved-for-later
  initiative — do not implement it.
- The plan doc is symlinked into Trent's vault — edits to the repo file are enough.

## End-of-initiative duties

GROW: update `.mex/ROUTER.md` current-state (entry exists for the PLANNED state — flip it),
mark the plan tracker COMPLETE, and report the final summary to Trent.

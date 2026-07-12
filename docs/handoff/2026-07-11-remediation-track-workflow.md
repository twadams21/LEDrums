# Track W — dynamic Workflow (remediation experiment, half B)

You are the **orchestrator** of Track W. You implement 5 of the 11 slices from the spec
"Spec: Patch-Graph Integrity & Review Remediation (Waves 1–2)"
(<https://app.notion.com/p/39ab3e4fbab1819f8042d94608326ff7>) using **dynamic Workflow
runs** (the Workflow tool: phased scripts fanning out subagents — context gathering,
worktree-isolated implementation, merge, adversarial review). A sibling track runs the
other 6 slices as a twux fleet — this is a deliberate A/B test of the two orchestration
approaches. Do not coordinate with the other track; just never touch its files (fence
below).

Notion CLI access: `ntn` works from agent shells (`NOTION_KEYRING=0` is already in
`~/.zshenv`). Each slice brief is a Notion page and is the implementer's contract —
anchors to verify, scope fence, evidence, report format, escalation triggers.

## Slices (dispatch in this order)

| Wave | Slice | Effort | Brief |
|---|---|---|---|
| 1 | S03 — Patch edits join the undo stack | medium | <https://app.notion.com/p/39ab3e4fbab181558b5ff5cc351adbc7> |
| 1 | S04 — Core voice cleanup: parseHoopTarget + frameCtx | medium | <https://app.notion.com/p/39ab3e4fbab1810ab92ee3cda601a2a3> |
| 1 | S06 — ControllerStatusPanel split + styleguide | medium | <https://app.notion.com/p/39ab3e4fbab18143bca6c54bd5b91f1c> |
| 2 | S09 — Modulation mutators → pure store slices | medium | <https://app.notion.com/p/39ab3e4fbab181e2978cc5827fe6a25a> |
| 2 | S10 — Protocol zod schemas (wire contract) | **high** | <https://app.notion.com/p/39ab3e4fbab18105b739f0995f3a892c> |

Dependencies: S09 needs S03 merged (shared store.svelte.ts). S10's brief says "depends
S07" — **overridden for this experiment**: S07 belongs to the other track. S10 is
independent here; it must reuse the EXISTING core schemas (`project-schema.ts`,
`kit-schema.ts`) where messages carry those shapes, and must not create or wait on the
new S07 validation module. Its note that "the handler gate stays" refers to the other
track's work — nothing for you to do or remove there.

## Suggested workflow shapes (you own the final scripts)

- **Phase: Context.** One workflow, N parallel readers — one per slice — each verifies
  its brief's anchors/premises against real code and returns a structured
  verified/drifted/escalate report (schema output). S03's persistence-coupling premise
  is the critical one: if `toAuthored()` feeds persistence, resolve the approach
  (separate undo-only snapshot) BEFORE dispatching implementation.
- **Phase: Implement.** One workflow per wave: one agent per slice with
  `isolation: 'worktree'`, each committing to its slice branch
  (`slice/sNN-...`) per its brief. Wave 1 = S03 ∥ S04 ∥ S06; wave 2 = S09 ∥ S10.
- **Phase: Merge.** You merge serially in the main session between workflows: slice
  branch → `track/workflow`, full sweep (`pnpm typecheck` + `pnpm test`) green on the
  merged result before the next merge. Verify fences by diffing file lists.
- **Phase: Review.** Per merged slice, adversarial verify agents review the diff
  against the brief (acceptance, fence, spec intent); confirmed findings loop back as a
  fix agent run (resume/re-dispatch). After wave 2, one track-level review of
  `git diff main...track/workflow`.

Effort tiers: agents at medium; S10's implementer and the review verifiers for it at
high. Never xhigh. Respect a working cap of ~3 concurrent implementation agents.

## Rules

- **Integration branch:** create `track/workflow` off `main` at start; record the SHA.
  NEVER touch `main`.
- **Verify from git**, not agent claims: commit exists, fence respected, sweep green
  after merge.
- **Escalations:** briefs mark stop-and-ask triggers (S03 persistence coupling, S10
  opaque-blob + dependency-direction questions). Resolve from the spec if you can;
  otherwise surface to Trent and pause only that slice.
- **Line-number drift:** anchors pinned 2026-07-11; re-locate by symbol.
- **S06 is UI-touching:** ui-shot captures + design-system regeneration are part of its
  acceptance — don't waive them.

## Cross-track fence — files you must NOT touch

`apps/server/src/handlers/**` · `apps/server/src/main.ts` · new `apps/server/src/http/**` ·
`apps/server/src/projects.ts` · `apps/server/src/voice-engine-host.ts` ·
`apps/web/src/lib/app/views/PatchGraphView.svelte` · `views/flow-guard.ts` ·
`apps/web/src/lib/app/patch-graph.ts` · `patch-routing.ts` ·
`packages/core/src/model/integrity.ts` · any new core validation module ·
`trigger-lab/sim.ts` · `trigger-lab/fixtures.ts` · `store/canvas-scenes.ts` ·
`store/system-toasts.ts` · `chrome/Transport.svelte` · `EffectGallery.svelte` ·
the four inspector files named in S08.

Known one-line conflict candidate at final integration: the `packages/core` root barrel
(both tracks may add an export line). S04 should export ONLY via
`packages/core/src/voice/index.ts`; accept a trivial root-barrel conflict at the end —
Trent merges the two track branches.

## Scorecard (the point of the experiment)

Track per slice: wall-clock (dispatch → accepted merge), tokens (Workflow results
report `subagent_tokens`), escalations (count + what), review findings (count/severity,
rework loops), gate failures, fence violations. Track overall: total wall-clock, number
of workflow runs, your orchestration overhead, human interventions.

When the track is done: write the scorecard as a Notion child page of the spec titled
**"Scorecard — workflow track"**, and a short completion report in
`docs/handoff/2026-07-11-track-workflow-report.md`. Leave `track/workflow` unmerged —
Trent integrates both tracks.

# Effect chains — slice plan and dispatch rules

- **Spec:** `docs/plans/2026-09-30-effect-chains/spec.md` (GH #237). Every slice implements part of
  it. Read the spec's relevant sections before building.
- **How this plan was produced:** by the orchestrator via `/slicing-work`. `/to-tickets` could not
  be auto-invoked; Trent can run it later.

## Expand → contract

Every PR in the stack must be green at its own HEAD (typecheck, full tests, dead-code gate). So the
new model is **added alongside** the graph model first (S01–S07). The graph model, the graph editor
and their tests are **deleted last** (S08). Until S08, existing graph code keeps compiling and its
tests keep passing. Do not delete graph code early, and do not "fix" graph tests to accommodate
new behaviour.

## Waves and seam gate

| Wave | Slice | Mutates (summary) | Runs with |
|---|---|---|---|
| 1 | S01 core model + resolver + engine (pioneer) | core `effect-chain/**`, voice `engine.ts`, `types.ts`, `voice-pool.ts`, `modulation.ts`, `compositor.ts` (target ranges only) | alone |
| 2 | S02 compositor: blend / opacity / master / modifier mix + envelope / strobe | voice `compositor.ts`, `engine.ts` (master hook), `modifiers/chain.ts`, `modifiers/types.ts`, `modifiers/impl/strobe.ts` | S03, S04 |
| 2 | S03 generators (9 + Splice / Slice facades) | core `effect-chain/generators/**`, `effect-chain/resolve-splice.ts`, `effects/impl/radial-wash.ts`, `whole-drum.ts`, effect metadata | S02, S04 |
| 2 | S04 library v3 + protocol + server show build | core `effect-chain/library.ts`, `model/library-versions.ts`, protocol `schemas.ts`, server `project-show.ts`, `project-storage.ts`, handlers (fireEffect) | S02, S03 |
| 3 | S05 web store + persistence + sim + import | web `trigger-lab/**` (not components) | alone |
| 4 | S06a grid + view integration | new `app/views/effects/grid/**`, `EffectsView.svelte`, `lazy-views.ts`, keyboard audition | S06b, S06c |
| 4 | S06b device strip + cards | new `app/views/effects/strip/**` | S06a, S06c |
| 4 | S06c sections / objects views + import UI | `app/views/Sections*`, `SectionColumn`, `SectionGraphRow`, `ObjectsView` + rows, setlist / import prompt | S06a, S06b |
| 5 | S07a mappings core + server | core `effect-chain/mappings.ts`, engine input path, binding-claims, server host, web `sim.ts` mapping step | alone |
| 5 | S07b MIDI-map mode UI | web shell mode, registry, overlay, learn, TopBar toggle, token | after S07a |
| 6 | S08 contract: delete graph model + editor | all graph code / tests / xyflow / shots / styleguide graph section, glossary, docs | alone |

## Shared files owned by the orchestrator

In parallel waves these are never edited by an implementer:

- `apps/web/src/lib/styleguide/Styleguide.svelte`, the section registry. Add your demo as a NEW
  section file; the orchestrator registers it.
- `docs/design-system.html`. The orchestrator regenerates it after merging a wave.
- `scripts/ui-shot/shots.json`. Put new presets in your report; the orchestrator merges them.
- `packages/core/src/index.ts` / barrel files, **in wave 2 only**. Put new exports in your report.
- `.mex/**`, `CONTEXT.md`. The orchestrator runs GROW.

## Rules for every implementer (the dispatch contract)

- **Worktree.** Work ONLY in the worktree and branch you are given. Commit there. Never push. Never
  touch other worktrees or the main checkout.
- **Anchors.** The anchors in your slice are premises. Verify each against real code before
  building. If a premise is false and changes the design, STOP and report the escalation (below)
  rather than improvising.
- **Scope fence.** Mutate only the files in your slice's fence. Crossing it requires pasting the
  out-of-fence diff in your report with the reason.
- **Gates** (`/done-gate`, implementer branch):
  - `pnpm typecheck` passes.
  - Targeted `vitest` runs for the areas you touched pass.
  - `pnpm dead-code:verify` passes.
  - **NEVER run the full `pnpm test`** (it can wedge the machine). The orchestrator runs it
    serially.
- **Tests.** Follow `/honest-tests`: assert external behaviour at the highest seam named in your
  slice; no weakened assertions; names match behaviour. Identity goldens where the slice says
  "must be identical to today".
- **UI slices** additionally:
  - `/make-interfaces-feel-better` pass;
  - use or extend the design system (new reusable components get a styleguide section file);
  - verify with `pnpm ui-shot` against YOUR dev port (`UI_SHOT_BASE`, and `UI_SHOT_OFFLINE=1` where
    no server is needed);
  - Read the PNGs and fix console errors.
- **Commits.** Conventional commits. The final commit body (under 30 lines) is the report: what
  shipped, deviations, how to verify. End every commit message with:

  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_011h8i6WYLM875tueJTopCu8
  ```
- **Report** (your final output, structured): commit shas, files touched, test-count delta, gates
  run with results, deviations, escalations, new exports / shot presets for the orchestrator.
- **Effort.** Opus, medium.
- **Escalate (stop and report, do not guess)** when:
  - a spec decision conflicts with an AGENTS.md non-negotiable (for example core purity, a
    deterministic render loop, or no native addons);
  - an identity guarantee cannot hold;
  - an anchor premise is false in a design-changing way;
  - the fence is too small for the slice to work.

  An escalation is success, not failure.

# Spec — LEDrums Deep Code-Quality Review

**Status:** draft, pending adversarial review
**Date:** 2026-07-26
**Owner:** Trent
**Output root:** `docs/plans/2026-07-26-deep-review/`

---

## Problem Statement

LEDrums has grown to ~70,000 lines of hand-written source across 467 files in six units,
plus 42,430 lines of tests. It works, and it ships. But nobody has a current, evidence-backed
picture of its quality, and the suspicion is that a meaningful fraction of it is not earning
its keep: dead code left behind by superseded features, logic duplicated across the web app
and core, abstractions introduced for a second caller that never arrived, and hot paths in
the render loop that were never measured.

The cost of not knowing compounds. Every new feature is authored against a codebase whose
true shape is unclear, which makes each change slower to reason about and easier to get
wrong. Agent implementers suffer this worse than humans do — they navigate by reading, and
dead or duplicated code is indistinguishable from live code at read time.

Trent's stated intuition is that a smaller codebase with identical behaviour is a better
codebase. That is mostly right, and the qualification matters: some code is **load-bearing
slack** — guards, error branches, retry paths, edge-case handling. Deleting it produces a
diff that looks like a simplification and a system that is measurably worse. A review that
scores itself on lines removed will find exactly that failure mode and call it success.

So the problem is two-sided: find everything that isn't earning its keep, **and** do it under
an objective function that cannot be gamed by deleting the safety net.

## Solution

A ten-phase, mixed-model pipeline that audits the codebase, fixes what is trivially fixable,
and produces ranked, adversarially-reviewed plans for what is not — stopping at a human
approval gate before any structural work begins.

Four decisions define it.

**The objective function is depth, not line count** — *less interface per unit of behaviour*,
from `/codebase-design`. But an objective function needs an operational definition, and "the
deletion test" alone is not one: *"imagine the module gone"* yields no verdict for "these two
functions are duplicated" or "this parameter list is a data clump", which is what most Phase 2
lenses actually produce.

So **each lens declares its own acceptance criterion**, recorded in the finding schema:

**"Mechanical" means decidable without model judgement.** A criterion whose verdict depends on
a model reading code is *not* mechanical, however crisp its wording — including the deletion
test, which is a thought experiment a model performs. Only mechanical criteria can be proven
in Phase 3b, and **only 3b-verified findings may be auto-fixed.** Non-mechanical findings can
still be excellent; they route to the structural-plan track for human review.

Every threshold below is bound to a value. An unbound `N` would leave 45 refuters improvising
the criterion behind a variable name, which is the failure this table exists to prevent.

| Lens | Acceptance criterion | Mechanical? | Auto-fix eligible |
|---|---|---|---|
| Dead code | Unreachable from any entry point **and** no dynamic-access pattern (string-keyed registry, dynamic import, reflection, template literal) resolves to it | ✅ | ✅ |
| Duplicated Code | **≥2 sites, ≥12 lines each, ≥90% token-similarity** per `jscpd`, semantically equivalent; consolidation reduces total interface rather than relocating it | ✅ (via `jscpd`) | ✅ |
| Data Clumps | **≥3** co-travelling params across **≥3** call sites | ✅ | ✅ |
| Repeated Switches | Same discriminant switched in **≥3** places | ✅ | ✅ |
| Divergent Change / Shotgun Surgery | One logical change requires edits in **≥4** files, evidenced from **≥3** commits in `git log` | ✅ | ✅ |
| Boundary violation | Import graph shows `packages/core` reaching Node/DOM/`@ledrums/io` | ✅ (via `madge`) | ✅ |
| Speculative Generality | **Deletion test** — model judgement | ❌ | structural track |
| Middle Man | **Deletion test** — model judgement | ❌ | structural track |
| Primitive Obsession | Primitive stands for a domain concept with ≥2 invariants enforced at call sites | ❌ | structural track |
| Resilience hole | Unhandled failure path with a plausible trigger — **inverse polarity: proposes adding code** | ❌ | structural track |

Thresholds are recorded in `00-baseline.md` at Phase 0 and may be retuned **once**, before
Phase 2 launches, based on the tooling's actual output on this codebase. They are frozen
thereafter so that findings remain comparable across lanes.

**And the protection against deleting load-bearing slack is a rule, not a hope:** a finding
whose fix changes **no exported interface** while removing a guard, error branch, or failure
path is **ineligible for Phase 5 auto-fix regardless of model confidence.** It may only enter
the structural-plan track for human review.

**Machine evidence precedes agent opinion.** Phase 0 runs `knip`, `ts-prune`, `depcheck`,
`madge` and `jscpd` before any agent reads a file. Agents interpret that inventory rather
than sweeping 70k lines hunting for what a tool finds deterministically. None of those tools is
currently installed or declared in this workspace, so Phase 0 acquires them at pinned versions
first — the leverage is real but it is not free, and v1 asserted otherwise.

**Every finding must survive an attempt to refute it, and then be proven independently.** LLM
claims of the form "this is dead" or "this is duplicated" carry a high false-positive rate.
Phase 3a attacks each finding with a different model, prompted to kill it, defaulting to
refuted under uncertainty. Phase 3b then requires **non-model evidence** before anything is
deleted automatically — surviving an argument is not the same as being true.

Findings that fail either gate are **retained in full** (`03-refuted.json`,
`03-unadmitted.json`) — never discarded and never reduced to a count. They are the only
measure of the gate's false-negative rate, and a count cannot be re-examined.

**Nothing structural executes without human approval.** Phases 0–10 end in a ranked table.
Execution is out of scope for this spec.

The pipeline runs on a mixed fleet: GPT-5.6 (Sol) for the high-volume mapping, identifying,
fixing and planning work, and Claude (Opus 5, Fable) for the judgment-dense verification and
synthesis. This is possible because a native Opus 5 session can spawn proxied codex agents
inside a dynamic Workflow — proven, not assumed (see Implementation Decisions).

## User Stories

1. As Trent, I want an evidence-backed inventory of what in LEDrums is not earning its keep, so that I can stop guessing which parts of the codebase are dead weight.
2. As Trent, I want dead code identified by tooling before any agent opines, so that I am not paying model tokens to rediscover what `knip` reports deterministically.
3. As Trent, I want every finding to have survived an explicit attempt to refute it, so that the ledger I act on contains conclusions rather than suspicions.
4. As Trent, I want findings that fail refutation kept out of the actionable ledger but retained in full in a separate artifact, so that the ledger stays clean while the gate's false-negative rate remains measurable.
5. As Trent, I want the review to measure interface reduction rather than lines deleted, so that no agent is rewarded for removing a guard.
6. As Trent, I want a dedicated lens looking for places that need *more* code, so that the review can make the system more resilient rather than only smaller.
7. As Trent, I want the trivial fixes applied automatically, so that I do not spend my own attention on mechanical deletions.
8. As Trent, I want every automated fix reviewed by a different model than the one that wrote it, so that a fixer cannot mark its own homework.
9. As Trent, I want the structural work planned but not executed, so that I decide what gets rebuilt and in what order.
10. As Trent, I want each structural plan designed three independent ways before one is chosen, so that the pipeline does not converge on the first plausible approach.
11. As Trent, I want the three variants designed by three different models, so that variant diversity is real rather than three samples from one prior.
12. As Trent, I want every plan attacked before it is synthesised, so that the plan I approve has already survived its strongest available objection.
13. As Trent, I want the final plans ranked by dependency, risk and payoff, so that I can approve a sequence rather than a pile.
14. As Trent, I want the pipeline to stop and wait for me before any structural change, so that architecture decisions stay mine.
15. As Trent, I want all artifacts written to `docs/` in this repo, so that the review survives the sessions that produced it.
16. As Trent, I want each phase to emit a machine-readable artifact against a documented schema, so that a later phase can consume it without re-deriving it from prose.
17. As Trent, I want the bulk work run on Sol, so that the volume does not consume my Anthropic usage window.
18. As Trent, I want to know precisely which parts of the pipeline *do* consume the Anthropic window, so that I am not surprised by a refusal at 70%.
19. As Trent, I want the verification phase run on Opus 5 at high effort, so that the one gate that decides what is real gets the best available judgment.
20. As an orchestrator session, I want to spawn proxied codex agents from inside a dynamic Workflow, so that I get Workflow's schema-forced returns and 14-wide concurrency instead of twux's 3-wide cap.
21. As an orchestrator session, I want a single reusable launcher primitive for codex agents, so that proxy credentials are handled in exactly one audited place.
22. As an orchestrator session, I want the proxy token never echoed into a transcript, so that reading a session log does not leak it.
23. As an orchestrator session, I want codex lanes batched behind shared wrappers, so that per-subagent boot overhead does not dominate the token cost of cheap work.
24. As an orchestrator session, I want file-mutating lanes isolated in worktrees, so that parallel fixers cannot corrupt each other.
25. As an orchestrator session, I want completion verified against the remote rather than an agent's report, so that a known `twux push` worktree bug cannot produce a false green.
26. As a mapping agent, I want a scoped unit and a fixed output schema, so that my report composes with eight siblings without an editing pass.
27. As an identifying agent, I want one named lens rather than a general brief, so that I am not duplicating what the other ten lenses cover.
28. As an identifying agent, I want the tooling inventory handed to me, so that I spend my budget on judgment rather than rediscovery.
29. As a verifying agent, I want a single finding and an instruction to refute it, so that my incentive is to kill it rather than to agree.
30. As a verifying agent, I want the deletion test stated explicitly, so that I have an objective criterion rather than an aesthetic one.
31. As a fixing agent, I want a scope fence naming the exact files I may touch, so that I cannot creep into adjacent code.
32. As a reviewing agent, I want the pre-fix diff point, so that I review what actually changed rather than the whole file.
33. As a planning agent, I want the deep-module vocabulary, so that three variants can be compared on the same axes.
34. As a plan reviewer, I want a scored rubric with explicit anchors, so that my verdict is comparable to the other reviewer's.
35. As a plan reviewer, I want to be required to produce findings or justify their absence, so that agreeing is not the cheapest path.
36. As a synthesising agent, I want the variants *and* the refutations against them, so that I build from what survived rather than from what was proposed.
37. As a future session, I want the ledger, schemas and rubric on disk, so that I can resume the initiative without the originating conversation.
38. As a future session, I want every phase's model and effort recorded, so that a re-run is reproducible.
39. As Trent, I want the total agent count and token cost estimated before launch, so that I can decide whether to run it at this scale.
40. As Trent, I want to be told what the pipeline deliberately does not cover, so that I do not read a clean report as complete coverage.

## Implementation Decisions

### Scope

Everything tracked by git that is hand-written. Measured, not assumed:

| Unit | Source LOC | Files |
|---|---:|---:|
| `apps/web` | 43,302 | 265 |
| `packages/core` | 14,466 | 132 |
| `apps/server` | 6,511 | 36 |
| `apps/desktop` (incl. ~1,727 Rust) | 2,894 | 14 |
| `packages/io` | 1,402 | 14 |
| `packages/protocol` | 777 | 2 |
| `scripts` | 643 | 4 |
| **Source total** | **~70,000** | **467** |
| Tests | 42,430 | — |

⚠️ **This table is stale and is superseded by Phase 0 step 1.** It was measured before commit
`ed07b29`, which added `apps/desktop/scripts/ota-announce.mjs` and `ota-announce.test.mjs`;
tracked test LOC is now 42,524. Reproducing it also requires the exact filter command, since
Rust test files (`*_tests.rs`) do not match a `.test.` pattern and shift the desktop figure by
several hundred lines depending on the filter. Treat these numbers as indicative of *shape*
— web dominates, core is second, io/protocol are small — and never as the pinned baseline.

`apps/desktop` initially measured 123,238 LOC; that was `web-dist/` and `src-tauri/target/`
build output, both gitignored. Excluded. Rust in `src-tauri/src/` is in scope and needs a
lens that reads Rust.

Tests are 38% of the codebase and are in scope — test duplication and test theatre are real
LOC under the same objective function.

### Transport: Opus 5 drives, codex agents run inside the Workflow

Three shapes were considered.

**Rejected — Sol drives, shelling out for Anthropic models.** Workflow `agent()` calls run
in-process and inherit the session's env. Inside a codex-proxied session, `model: 'opus'`
resolves through `ANTHROPIC_DEFAULT_OPUS_MODEL`, which twux maps to `gpt-5.6-sol`. A Sol
session asking for an Opus verifier gets Sol, silently. Pinning a full id
(`model: 'claude-opus-5'`) instead returns a non-transient 502. Neither route yields a real
Opus verifier, and the first fails *open* on the single phase whose job is catching false
positives. Documented in twux's own `lib/models.sh` tier map.

**Rejected — Workflow for Anthropic, twux panes for Sol.** Correct but slow: `TWUX_MAX_WIDE`
caps twux at 3 concurrent children, while Workflow's cap is `min(16, cores-2)` = 14 on this
machine. Phases 1, 2 and 3 are wide read-only fan-outs of 9, 11 and up to 45 lanes; on twux
those become 3, 4 and 15 serial waves.

**Chosen — Opus 5 native session drives a dynamic Workflow containing both native and proxied
agents.** Env plumbing *adds* proxy variables to a child rather than stripping them from one,
so a plumbing failure downgrades a Sol finder to Opus (lose diversity, keep the gate) rather
than downgrading an Opus verifier to Sol (lose the gate, undetectably).

This was proven, not assumed. A three-lane probe ran one native and two proxied
`gpt-5.6-luna(low)` agents concurrently, all schema-forced: 3/3 returned, 0 errors, 35s,
63,500 subagent tokens. Both codex lanes were checked against independently computed ground
truth — one reported all seven exports of `packages/io/src/osc.ts` by name in source order,
the other the correct file count and purpose of `packages/protocol`.

### The wrapper primitive

Workflow scripts are plain JavaScript with no filesystem and no shell; they can only call
`agent()`. Only a subagent has Bash. So a codex agent is reached by spawning a cheap native
subagent whose entire job is to shell out and relay:

```
Opus 5 session (native)
 └─ Workflow script (JS: no fs, no bash — only agent())
     └─ agent(model:'opus', effort:'low')   ← wrapper. Native. Has Bash. Does no thinking.
         └─ bash codex-agent.sh             ← sets ANTHROPIC_BASE_URL + AUTH_TOKEN
             └─ claude -p --model 'gpt-5.6-sol(low)'   ← the real worker
                 └─ Read / Grep / Glob
```

`codex-agent.sh` is the single audited place credentials are handled. It reads
`~/.twux/proxy.json`, mirrors twux's `codex_env_prefix()` including the four
`ANTHROPIC_DEFAULT_*_MODEL` tier variables, and never echoes the token. Effort folds into the
model spec codex-style as `model(effort)` and must be quoted — bare parens are a zsh parse
error. `claude -p` needs `< /dev/null` or it stalls three seconds waiting on stdin.

Two properties of the wrapper are load-bearing:

- **It must be told it is not the solver.** Its prompt opens *"You are a LAUNCHER, not a
  solver. Do NOT answer the task yourself."* Without this a capable model answers the
  question directly and never runs the subprocess, producing a confident answer from the
  wrong model with no error surfaced.

  **A prompt line is not a mitigation for a silent failure.** `codex-agent.sh` therefore
  generates a **random nonce at runtime** and requires the child to echo it in a provenance
  header alongside the model id it actually booted. The wrapper must return that nonce; the
  workflow validates it and **fails the lane on mismatch**. A wrapper that self-answers cannot
  produce the nonce, because it did not exist until the script ran. This converts the
  transport's worst failure mode from prompt-dependent to fail-closed.

  **The nonce alone is insufficient** — a wrapper that never ran the script could invent 32 hex
  characters. So `codex-agent.sh` also appends each nonce out-of-band to a receipts ledger
  (`~/.twux/codex-agent-receipts.tsv`) that only it writes, and `artifacts/verify-nonce.sh`
  checks a returned nonce against that ledger by exact field match. A fabricated nonce matches
  no receipt. **That pairing is what makes the guard fail-closed rather than decorative.**

  Both halves are implemented and tested at `artifacts/codex-agent.sh` and
  `artifacts/verify-nonce.sh`, with the demonstration recorded in `artifacts/NONCE-TEST.md`:
  a real nonce validates (exit 0), a fabricated nonce is rejected (exit 1), and a real nonce
  against the wrong model spec is caught as a mismatch (exit 2).

  The three-lane probe did **not** test any of this — its oracle was "did the answer happen to
  be correct", which a self-answering wrapper would also pass. Proxy *routing* was proven
  separately by three bare `claude -p` invocations with no wrapper in the path. Wrapper
  *fidelity* is what the nonce adds.

  *(v2 of this spec claimed these artifacts were "committed to the output root". They were not
  — the entire output root was untracked and the only copy of the launcher sat in a session
  scratchpad with no nonce logic. Both reviewers caught it independently. The claim is now
  true; `git ls-files docs/plans/2026-07-26-deep-review/` is the check.)*
- **It costs ~20k tokens to boot** regardless of what it relays. So codex lanes batch: one
  wrapper fans out N subprocesses with `&` … `wait`. This also lifts Sol concurrency out from
  under Workflow's 14-cap, since the fan-out is bash-level.

Wrappers run **Opus low** — reliability at the relay is worth more than the token saving,
because the failure mode is silent. Wrappers are native Anthropic, so they consume the usage
window even though Sol's inference does not: ~23 wrappers × ~20k ≈ **460k Opus-low tokens**.
Sol phases are cheap, not free.

### The phases

| # | Phase | Agents | Model · effort | Wrapper | Consumes usage window |
|---|---|---:|---|---|---|
| 0 | Baseline & instrument | 0 | main thread | — | — |
| 1 | Map | 3 (9 lanes) | Sol · low | ✅ batched | wrapper only |
| 2 | Identify | 3 (11 lanes) | Sol · medium | ✅ batched | wrapper only |
| 3 | Verify | 25–45 | Opus 5 · high | — | **yes** |
| 4 | Triage & split | 0 | plain JS | — | — |
| 5 | Fix trivial | ~10 | Sol · low | ✅ 1/worktree | wrapper only |
| 6 | Review fixes | ~10 | Opus 5 · low | — | yes |
| 7 | Plan ×3 variants | 14 | Sol high · Opus high · Fable med | Sol only | yes |
| 8 | Adversarial plan review | 8 | Fable low + Sol low | Sol only | partly |
| 9 | Synthesise best plan | 6 | Opus 5 · high | — | **yes** |
| 10 | Rank & phase | 0–1 | main thread | — | — |
| | **Total** | **~79–100** | | | |

⚠️ **The counts above are not decision-grade and must be replaced by formulas at Phase 0
step 3.** Two defects, both found in review: the v1 total read "79–110" when the rows sum to
79–100, and the per-initiative phases (7, 8, 9) are stated as fixed counts while all three
scale on the same variable — the number of structural initiatives `I`, which is unknown until
Phase 4 completes. Correct form: Phase 7 = `3I` lanes, Phase 8 = `2I` lanes, Phase 9 = `I`
agents, wrappers = `ceil(sol_lanes / batch_size)`. Phase 3 additionally scales on the deduped
finding count, which is why it carries an admission cap. Present low/base/high scenarios
against `I` and the finding count rather than single numbers.

**Phase 0 — Baseline & instrument.** "Same behaviour" is unprovable without a baseline; this is
it. Four steps, in order:

1. **Pin a green HEAD sha** and regenerate the scope table from it, recording the exact
   `git ls-files` filter command beside the numbers. The v1 table went stale *during the
   conversation that produced it* — commit `ed07b29` added `apps/desktop/scripts/ota-announce.mjs`
   and its test — so the table is only meaningful with its command and commit attached.
2. **Acquire the tooling.** None of `knip`, `ts-prune`, `depcheck`, `madge`, `jscpd` is
   installed, on PATH, or declared in any workspace manifest. Each runs via a
   **version-pinned** `pnpm dlx <tool>@<version>`, and the resolved version is recorded in
   `00-baseline.md`. Floating versions would make the "reproducible" baseline depend on
   whatever npm served that afternoon.
3. **Calibrate.** Run one real lane end to end and measure actual wrapper boot cost and Sol
   throughput. Every token and agent-count figure in this spec is extrapolated from a
   three-lane probe of trivial tasks; that sample cannot support the projections and this step
   replaces them with measurements.
4. **Coverage snapshot** — no coverage script or config currently exists in the repo, so this
   step includes standing one up or explicitly recording that behaviour parity will be
   measured by test-count and pass/fail alone.

**Phase 1 — Map.** Nine read-only lanes: `packages/core` ×2, `apps/web` ×3, `apps/server`,
`packages/io`+`protocol`, `apps/desktop`+Rust+`scripts`, tests ×1. Each returns module
responsibilities, exports, dependencies, seams, LOC and suspicion flags. Agents cannot audit
70k LOC by reading; this builds the territory first.

**Phase 2 — Identify.** Eleven lanes: the eight highest-yield Fowler smells from
`/code-review`'s baseline (Duplicated Code, Speculative Generality, Middle Man, Divergent
Change, Shotgun Surgery, Primitive Obsession, Repeated Switches, Data Clumps), plus a
tooling-interpreter lane reading Phase 0's output, a **resilience counter-lens** looking for
places needing more code, and a Rust lane. Fanning out by lens rather than by file keeps each
agent blind to the others' territory. Upgraded from low to medium effort: this phase's
precision directly sets Opus spend in Phase 3.

**Phase 3 — Verify.** Split into two gates, because surviving refutation is not verification.

*3a — Adversarial refutation.* Each finding is attacked by Opus 5 at high effort, prompted to
refute, defaulting to refuted under uncertainty, applying **the acceptance criterion its lens
declares** (see Objective). Findings above a size or blast-radius threshold get three
independent refuters; the rest get one. Refuted findings are **retained** in
`03-refuted.json` rather than discarded — they are the only measure of the gate's
false-negative rate.

*3b — Positive mechanical verification.* Non-model evidence for the lens's criterion, and only
for criteria the table marks mechanical. For dead code: grep for dynamic-access patterns
(string-keyed registries, dynamic import, reflection, template literals), confirm the bundler
tree-shakes it, and confirm the suite stays green with the symbol removed.

**3b experiments are mutations, and mutations must be isolated.** Removing a symbol and running
the suite is an experiment that edits the tree. Run two such experiments concurrently in one
checkout and each lane attributes a green suite to its own deletion when it actually tested the
combined patch; restoration races on top. That manufactures exactly the confident-wrong
evidence this gate exists to prevent. So:

- **Every `requires_mutation` experiment runs in its own git worktree**, created from the
  pinned Phase 0 baseline sha — never from another experiment's tree. The worktree path and
  baseline sha are recorded in the verdict (`mechanical_verification.isolation`), and a verdict
  with `required: true` and a null `worktree_path` is invalid against the schema.
- **Suite runs serialise** via `pnpm gates`, which takes the machine-wide
  `~/.ledrums/locks/gates.lock`. Concurrent worktrees may *prepare* in parallel; they queue to
  verify. Non-mutating checks (grep, `madge`, `jscpd`) need no lock and stay parallel.
- Worktrees come from the standing `twux worktree` pool, capped at 3 concurrent, and are
  removed after the experiment regardless of outcome.

This is the same isolation discipline Phase 5 already had; v2 introduced mutation into Phase 3
without carrying the discipline across, which was caught in adversarial review.

**Only findings passing 3a *and* 3b reach Phase 5 auto-fix.** A finding that survives 3a but
cannot be mechanically verified stays a **hypothesis** and routes to the structural-plan
track, where a human sees it before anything is deleted. This exists because v1 established
that correctness must be checked against independently computed ground truth, then had Phase 3
establish it by asking another model — an internal contradiction found in adversarial review.

**Admission cap — bounded on refuter calls, not on findings.** Capping *findings* does not bound
this phase's cost, because cost is 1–3 refuters per finding: 45 admitted findings can still be
135 Opus-high calls. The cap is therefore expressed in the unit that actually costs money.

- **`REFUTER_BUDGET = 90`** Opus-5-high calls for Phase 3a.
- Refuters per finding: **3** if `fix_size_loc > 50` **or** `blast_radius.touches_core`, else
  **1**.
- Findings are admitted in descending `severity × blast_radius.files_touched` order, each
  consuming its refuter count, until the budget is exhausted. Worst case 90 calls; typical mix
  admits ~50–70 findings.
- **`WRAPPER_BATCH_SIZE = 4`** proxied subprocesses per Opus-low wrapper, for every Sol phase.

**Anything unadmitted is retained in full**, as complete finding objects in
`03-unadmitted.json` — never as a count. A count cannot be re-examined, cannot be re-admitted
in a later run, and turns a bounded intake into something that reads as full coverage. This is
the same retention rule as refuted findings, for the same reason.

The budget is a **Phase 0 output**, recalculated from the calibration lane's measured
Opus-high cost against the remaining 5h window, and recorded in `00-baseline.md`. The value
above is the default when calibration is skipped.

**Phase 4 — Triage & split.** Deterministic JavaScript in the workflow script, no agent.
Sizes each survivor into *trivial* (mechanical, file-local) or *structural* (needs a plan).

**Phase 5 — Fix trivial.** Roughly ten file-disjoint lanes, each in its own git worktree,
each fenced to a named file set. Sol low: executing a written spec needs no more.

**Phase 6 — Review fixes.** Opus 5 low reviews each fix batch's diff against its pre-fix
point, applying `/code-review`'s two-axis shape. A different model than the fixer, so no
agent marks its own homework.

**Phase 7 — Plan ×3 variants.** Per structural initiative, three independent designs from
three different models: **Sol high**, **Opus 5 high**, **Fable medium**. Follows
`/codebase-design`'s DESIGN-IT-TWICE, and the cross-vendor split makes variant diversity real
rather than three samples from one prior. Two of three are native, so only the Sol variant
needs a wrapper.

**Phase 8 — Adversarial plan review.** Fable low and Sol low attack all three variants per
initiative. Their job is to break plans, not rank them. Scored against an explicit rubric with
anchored levels and a forced structured return.

**Phase 9 — Synthesise best plan.** Opus 5 high consumes the three variants *and* the
refutations against each, and builds one plan per initiative from what survived.

**Phase 10 — Rank & phase.** Dependency order × risk × payoff into an approval table.

### Seams (phase artifact contracts)

Each phase boundary is a seam, and the artifact is its interface. All under
`docs/plans/2026-07-26-deep-review/`:

**JSON is canonical; Markdown is a rendered view.** Any artifact a later phase consumes
programmatically exists as JSON. Where a human also needs to read it, a `.md` is generated
*from* the JSON and is never the source of truth — a downstream phase parsing prose is the
same class of defect as an undefined schema.

| Artifact | Schema | Producer | Consumers |
|---|---|---|---|
| `00-baseline.md` + `00-baseline.json` | — | Phase 0 | every phase (pinned sha, thresholds, `REFUTER_BUDGET`, tool versions) |
| `01-map/<unit>.json` | `schemas/map.schema.json` | Phase 1 | Phase 2 lenses |
| `02-findings/<lens>.json` | **`schemas/finding.schema.json`** | Phase 2 | 3a, 3b, 4, 10 |
| `03-verdicts.json` | **`schemas/verdict.schema.json`** | Phase 3 | Phase 4 |
| `03-refuted.json` | `verdict.schema.json` | Phase 3a | false-negative audit only |
| `03-unadmitted.json` | `finding.schema.json` | Phase 3 admission | future runs, audit |
| `04-ledger.json` (+ `.md` view) | `verdict.schema.json` | Phase 4 | Phase 5, Phase 7 |
| `05-fixes/<batch>.json` | `schemas/fix.schema.json` | Phase 5 | Phase 6 |
| `06-fix-reviews/<batch>.json` | `schemas/fix.schema.json` | Phase 6 | Phase 10 |
| `07-plans/<initiative>/{sol,opus,fable}.json` | `schemas/plan.schema.json` | Phase 7 | Phase 8, Phase 9 |
| `08-refutations/<initiative>.json` | `schemas/plan-review.schema.json` | Phase 8 | Phase 9 |
| `09-synthesis/<initiative>.json` (+ `.md` view) | `schemas/plan.schema.json` | Phase 9 | Phase 10 |
| `10-ranked.json` (+ `.md` view) | `schemas/ranked.schema.json` | Phase 10 | **Trent** |
| `schemas/*.json` | — | authored before Run A | every phase, as validator input |
| `artifacts/codex-agent.sh` | — | authored before Run A | every wrapper in every Sol phase |
| `artifacts/verify-nonce.sh` | — | authored before Run A | the workflow, on every proxied lane |
| `artifacts/codex-mix-probe.js` + transcripts | — | transport probe | re-run before each of Runs A/B/C |

`finding.schema.json` is the load-bearing one — four phases read it — and it is **blocking:
Run A does not start until it and `verdict.schema.json` validate.** Both now exist. The
remaining schemas (`map`, `fix`, `plan`, `plan-review`, `ranked`) are authored during Phase 0
and are blocking for the runs that consume them, not for Run A.

**Every phase validates its inputs against the declared schema and rejects on failure** rather
than interpreting or repairing a malformed artifact. A phase that repairs its input hides the
producer's defect and makes the contract advisory.

### Run chunking

| Run | Phases | Ends at |
|---|---|---|
| A — Audit | 0 → 4 | Verified, triaged findings ledger |
| B — Fix | 5 → 6 | Small fixes merged and reviewed |
| C — Plan | 7 → 10 | Ranked initiatives awaiting approval |

Three runs, not one: context does not survive that span, and the approval gate is real.

## Testing Decisions

**What makes a good test here.** The pipeline's output is a ledger and a set of plans, so
"testing" means checking claims against ground truth that was computed independently — not
asking another model whether the first model was right. Every automated check must be
falsifiable by something outside the model that produced the claim.

- **The transport is already tested.** The three-lane probe is the regression test for the
  mixed-model mechanism. Both codex lanes' factual claims were verified against `grep` and
  `ls` output computed separately. Re-run it before each of runs A/B/C; if a lane reports the
  wrong export count, the proxy or tier map has drifted.
- **Phase 5 fixes are tested by the existing suite**, run on committed HEAD, not on a dirty
  tree. **Fix lanes must verify with `pnpm gates`, never `pnpm test`.** `pnpm gates` takes a
  machine-wide `mkdir`-atomic mutex at `~/.ledrums/locks/gates.lock` via
  `scripts/with-gate-lock.mjs`. Plain `pnpm test` is `pnpm -r run test` and takes **no lock**;
  concurrent sweeps have previously wedged this machine. Worker caps are set by
  `VITEST_MIN/MAX_THREADS` and `MIN/MAX_FORKS` in `~/.zshenv` (2), with
  `with-gate-lock.mjs` supplying `??= 4` as an in-lock floor only when those are unset —
  effective cap is 2 in an interactive shell. There is no `vitest.config.*` in the repo, so a
  repo-only search for the cap finds nothing and wrongly concludes none exists.
  *(Corrected from v1, which named a `scripts/test-lock.sh` that was added by commit `4d43777`
  on a branch since rewritten and is unreachable from any ref.)*
- **Phase 5 completion is verified against the remote** with `git ls-remote`, never from an
  agent's report. `twux push` has previously gated the session's cwd rather than `--cwd` and
  reported `pushed=true` for a branch that was never pushed. Whether that bug is still live
  is unconfirmed; the verification stands either way.
- **Behaviour parity is checked against Phase 0's baseline**, not against intuition. A fix
  batch that changes coverage or test count without a stated reason fails Phase 6.
- **The deletion test is the acceptance criterion for every deletion**, applied by a model
  that did not propose the deletion.
- **Prior art**: `packages/core` is unit-tested through its public interface and stays free of
  Node and DOM imports; that purity constraint is itself a Phase 2 lens (boundary violations),
  mechanically checkable rather than a judgment call.

**Not a test.** An agent reporting that it completed its task is a claim. Green on committed
HEAD and present on the remote is evidence. Where the two disagree, the git state wins.

## Out of Scope

- **Execution of structural plans.** Phases 0–10 end at a ranked table. Building anything on
  it is a separate, separately-approved initiative.
- **`web-dist/`, `src-tauri/target/`, `node_modules/`, and any vendored dependency.** Build
  output and third-party code are excluded by definition.
- **Feature work.** No new capability, no UI changes, no behaviour changes beyond the removal
  of code proven not to be earning its keep.
- **Performance optimisation beyond identification.** Hot-path findings are recorded and
  planned; tuning the render loop is its own initiative with its own measurement harness.
- **Dependency upgrades and toolchain changes.**
- **Notion/GitHub ticket creation.** Outputs stay in `docs/` for this initiative.
- **Rewriting tests to raise coverage.** Test *duplication* is in scope; test *coverage gaps*
  are recorded as findings but not filled here.

## Further Notes

**On "smaller is better".** The premise is directionally right and needs its qualification
stated where agents can see it: deleting a guard, an error branch or an edge case produces a
smaller codebase and a worse system. This is why the objective function is interface
reduction rather than line count, why the deletion test is the arbiter, and why Phase 2
carries a counter-lens whose only job is to find places needing *more* code. An agent fleet
scored on lines deleted would reliably find and destroy the safety net.

**On budget.** Phase 3 is the cost centre — 25–45 Opus 5 high agents. The available knob is
refuter count: three votes only for findings whose fix exceeds 50 LOC or touches
`packages/core`, one vote otherwise. Phases 7 and 9 add 10–14 more native Opus high agents.
House rule holds: no new launches past 70% of the 5h window; wake at reset.

**Open question carried into review.** Phase 8 runs Fable low and Sol low. Adversarially
breaking an architecture plan is judgment-dense, and a plan that survives a shallow attack
goes straight into Phase 9 and gets built. Recommendation on the table but not adopted: leave
Fable at low as the broad sweep and raise Sol to medium as the deep one.

**Open question.** `apps/web` is 43,302 LOC — 62% of scope — and Phase 1 splits it three ways.
Whether that split runs by feature area (trigger-lab / app-shell / styleguide) or by layer
(stores / components / routes) is undecided.

**Provenance.** The transport design is backed by a passing probe, not by reasoning alone;
the scope table is `git ls-files` output, not an estimate; the twux tier-map behaviour is
quoted from `lib/models.sh`. Claims in this spec that are *not* evidence-backed are the agent
count estimates and the token projections, which are extrapolations from a three-lane sample.

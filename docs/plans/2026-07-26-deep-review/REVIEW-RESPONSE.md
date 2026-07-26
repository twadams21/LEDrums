# Review Response — SPEC.md v1 → v2

**Reviewers:** `claude-fable-5` (launched `--effort low`) · `gpt-5.6-sol(high)`
**Verdicts:** REVISE (7 findings) · **BLOCK** (8 findings)
**Adjudicated by:** Opus 5 orchestrator, 2026-07-26
**Method:** every checkable claim re-verified independently before accept/reject. Reviewer
assertions were not taken at face value in either direction.

This document is also the **prototype for Phase 9** — how a synthesiser consumes conflicting
adversarial reviews and adjudicates rather than averages.

---

## Score summary

| Dimension | Fable | Sol |
|---|---:|---:|
| D1 Soundness | 2 | **0** |
| D2 Completeness | 2 | **0** |
| D3 Cost realism | 2 | **0** |
| D4 Failure modes | 2 | **0** |
| D5 Evidence | 1 | **0** |
| D6 Scope discipline | 3 | 3 |

Sol applied the anchors literally and its zeros are each defensible against the anchor text
(D5 0 = "a load-bearing claim is contradicted by the codebase" — literally true). The rubric's
behavioural anchors worked: they forced specific defensible scores rather than sentiment. Both
reviewers independently gave D6 = 3, the only agreement, and the only dimension where nothing
was found.

## Adjudication

| ID | Source | Finding | Verdict | Change |
|---|---|---|---|---|
| A1 | Fable F1 🔴 | Deletion test undefined for most Phase 2 lenses | **ACCEPT** | Per-lens acceptance criteria table (§Objective) |
| A2 | Sol F2 🔴 | Failure-to-refute treated as confirmation; contradicts spec's own testing rule | **ACCEPT** | Phase 3 splits into 3a refute / 3b mechanical verification |
| A3 | Sol F1 🔴 | Wrapper fidelity unattested; probe oracle can't exclude self-answer | **ACCEPT (narrowed)** | Nonce attestation; launcher + probe committed |
| A4 | Both | `test-lock.sh` / `pnpm test` serialisation claim false | **ACCEPT** | Corrected to `pnpm gates`; real caps stated |
| A5 | Both | Five audit tools not installed, no pinned acquisition | **ACCEPT** | Phase 0 gains install-and-pin step |
| A6 | Sol F7 | Finding schema named but never defined | **ACCEPT** | Blocking. Schema written before Run A |
| A7 | Sol F3 | Objective is prose, not an admission rule | **ACCEPT** | Merged with A1; zero-interface deletions ineligible for auto-fix |
| A8 | Sol F8 | Scope table one commit stale | **ACCEPT** | Regenerate at pinned HEAD, record exact command |
| A9 | Fable F4 / Sol F4a | No admission cap on Phase 3 intake; totals don't sum | **ACCEPT** | Cap + formula-based cost model |
| A10 | Fable F6 | Discarding refuted findings destroys false-negative data | **ACCEPT** | Refuted findings retained in `03-refuted.json` |
| A11 | Fable F7 | Probe can't support cost extrapolation | **ACCEPT** | Calibration lane in Phase 0 |
| A12 | Both | "No vitest worker cap exists" | **REJECT** | False. Caps are in `~/.zshenv`, live. Both reviewers checked repo only |
| A13 | Sol F4b | Phase 8's 8 agents implies 4 initiatives, inconsistent with Phase 7/9 | **REJECT** | Misread. 8 = 6 native Fable + 2 batched Sol wrappers, consistent with 6 initiatives |
| A14 | Sol F1b | "Transport is not proven" | **PARTIAL** | Routing *is* proven by three bare `claude -p` runs outside any wrapper. What is unproven is wrapper *fidelity*. Narrowed, not dismissed |

**11 accepted, 2 rejected, 1 narrowed.**

## The two findings that change the design

### A1 + A7 — the objective function had no operational definition

The v1 objective was "interface reduction, arbitrated by the deletion test." Fable showed the
arbiter is undefined for eight of eleven lenses: *"imagine the module gone"* yields no verdict
for "these two functions are duplicated" or "this parameter list is a data clump." Sol showed
the same gap from the other side: no artifact records interface-before/after, so the objective
is unenforceable even where it does apply.

Together they mean 45 Phase 3 refuters would have improvised their own criteria.

**v2: each lens carries its own acceptance criterion, and the finding schema records which one
applies.**

| Lens | Acceptance criterion | Mechanical? |
|---|---|---|
| Dead code | Unreachable from any entry point **and** no dynamic-access pattern (string-keyed registry, dynamic import, reflection) resolves to it | ✅ yes |
| Duplicated Code | ≥2 sites, ≥N lines, semantically equivalent (not merely structurally similar); consolidation reduces total interface rather than relocating it | partial |
| Speculative Generality | **Deletion test** — this is its home | ✅ yes |
| Middle Man | **Deletion test** | ✅ yes |
| Data Clumps | ≥3 co-travelling parameters across ≥3 call sites | ✅ yes |
| Primitive Obsession | Primitive stands for a domain concept with ≥2 invariants enforced at call sites | no |
| Repeated Switches | Same discriminant switched in ≥3 places | ✅ yes |
| Divergent Change / Shotgun Surgery | One logical change requires edits in ≥N files, evidenced from git history | ✅ yes |
| Resilience holes (counter-lens) | An unhandled failure path with a plausible trigger — **inverse polarity: proposes adding code** | no |

**And the load-bearing-slack protection becomes mechanical rather than hoped-for:** a finding
whose fix changes **no exported interface** and removes a guard, error branch, or failure path
is **ineligible for Phase 5 auto-fix regardless of model confidence.** It may only enter the
structural-plan track for human review. This is the rule v1 was trying to express in prose.

### A2 — surviving refutation is not verification

Sol found a genuine internal contradiction. v1's Testing Decisions says correctness must be
checked "against ground truth computed independently — not asking another model whether the
first model was right." But v1's Phase 3 does exactly that: survive an Opus refutation, then
proceed to auto-fix.

Sol's failure scenario is concrete and plausible: a web helper reached through a string-keyed
registry is reported dead by static search; the refuter misses the dynamic access too; the fix
is under 50 LOC and outside `packages/core`, so it gets one vote and is auto-deleted.

**v2 splits Phase 3:**

- **3a — Adversarial refutation** (Opus 5 high). Unchanged: attack the finding, default to
  refuted under uncertainty.
- **3b — Positive mechanical verification.** Non-model evidence, per the lens's criterion
  above. For dead code: grep for dynamic-access patterns, confirm the bundler tree-shakes it,
  and confirm the suite stays green with the symbol removed.

**Only findings that pass 3a *and* 3b reach Phase 5 auto-fix.** Findings that pass 3a but
cannot be mechanically verified remain **hypotheses** and route to the structural-plan track,
where a human sees them. Auto-deletion now requires machine evidence, not model consensus.

### A3 — wrapper fidelity

Sol is right that the probe's oracle cannot exclude the failure mode the spec itself names: a
native wrapper that ignores "you are a launcher", reads `osc.ts` itself, and returns the seven
correct exports. The model-spec string was in its own prompt, so it could echo that too.

Narrowing: **proxy routing is proven** by three bare `claude -p` invocations run directly in
Bash with no wrapper in the path (`PROBE-OK`, `TOOLS-OK`, `SCRIPT-OK`). What is unproven is
that the *workflow's* wrapper shelled out rather than self-answered.

**v2 fix — nonce attestation.** `codex-agent.sh` generates a random nonce at runtime and
requires the child to echo it in a provenance header alongside the model id it actually
booted. The wrapper must return the nonce. A wrapper that self-answers cannot produce it,
because the nonce did not exist until the script ran. The workflow validates the nonce and
fails the lane on mismatch — **fail-closed, not prompt-dependent.**

Also accepted: `codex-agent.sh` moves out of scratchpad into the repo, and the probe script
and its transcript are committed to the output root, so the transport claim is reproducible by
anyone reading the spec.

## Rubric v2 — what this test case taught

The rubric was the real deliverable here. Six changes, each earned by an observed failure:

| # | Observed | Rubric v2 change |
|---|---|---|
| R1 | **Both** reviewers wrongly claimed no vitest cap exists. Both checked only the repo — because the rubric said "verify against the repository" | Scope becomes **"the repository *and* the execution environment"** (shell env, installed tooling, global config). This single wording error induced a *correlated* failure across two different vendors |
| R2 | Fable self-reported `claude-fable-5(medium)`; it was launched `--effort low` | `reviewer` is **stamped by the launcher**, not self-reported. Model identity is not a field an agent may fill |
| R3 | Fable went "not in repo" → "does not exist" | Absence claims must state **scope of search**: what was searched, with what command |
| R4 | Sol misread agent composition (A13) and built a finding on it | Add `assumptions_made[]` — inferences the reviewer relied on. Makes misreads visible instead of load-bearing |
| R5 | Two verdicts disagreed (REVISE vs BLOCK) and one contained an error | Phase 9 must **adjudicate, not average** — including detecting reviewer error. This document is the shape |
| R6 | `coverage_gaps` and `checked_against_repo` both produced high-signal output | **Keep unchanged.** `checked_against_repo` yielded 17 verifications across both reviewers, 4 of which broke spec claims |

R1 is the important one. Two independent models from two vendors made the *same* wrong
inference, because the prompt scoped their search identically. **Model diversity does not
purchase method diversity.** Phase 8 must vary what reviewers are told to check, not only
which model does the checking — otherwise it buys correlated confidence and calls it
independence.

## Carried forward, unresolved

- **Phase 8 effort tiers.** v1 flagged Fable low + Sol low as thin for breaking architecture
  plans. This run is evidence: Sol at **high** produced the two findings that changed the
  design; Fable at low produced the critical one but also the only rejected finding. Neither
  tier is clearly sufficient alone. Recommendation now firmer: Fable low as broad sweep, Sol
  **medium or high** as the deep pass.
- **`apps/web` split** — by feature area or by layer. Unchanged, still open.
- **Finding schema** — A6 makes it blocking. Must exist before Run A.

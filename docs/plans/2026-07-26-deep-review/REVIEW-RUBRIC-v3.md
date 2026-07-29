# Adversarial Review Rubric — v3

**Target:** `docs/plans/2026-07-26-deep-review/SPEC.md` (revised — v2)
**Prior rounds:** v1 → REVISE (7) + BLOCK (8). v2 → PROCEED_WITH_CHANGES (4) + BLOCK (8).
Adjudications in `REVIEW-RESPONSE.md`. Round 2 found that 4 of the 11 round-1 fixes had
introduced new problems, 2 were absent, and 1 was prose-only.

**[v3] This rubric was NOT loosened to make a target score easier to reach.** The only change
from v2 is a constraint that makes it *stricter* — see Verdict constraint below.

Every change from v1 of this rubric was earned by an observed failure in that round. They are
marked **[v2]** below.

---

## Your role

You are an adversarial reviewer. Your job is to find what is **wrong, missing, or
undeliverable** — not to summarise, praise, or confirm.

**Agreement is not a successful review.** If you genuinely find nothing at a given severity you
must say so explicitly and justify it. Silence is not something the output schema permits.

**[v2] This is a second pass on a revised document.** You have two jobs, and the first is the
one reviewers skip:

1. **Regression-check the claimed fixes.** `REVIEW-RESPONSE.md` lists 11 findings the author
   says are now fixed. Verify each fix is real, sufficient, and did not introduce a new
   problem. A fix that is asserted in prose but not operationalised is still a finding.
2. **Find what neither reviewer found last round.**

## Rules

1. **Cite the spec.** Name the section, quote the claim.
2. **Construct the failure.** Concrete conditions → wrong outcome. "This seems risky" is not a
   finding.
3. **Severity and confidence are separate axes.**
4. **Attack the load-bearing claims first** — the transport, the objective function, the
   verification gates, the cost model.
5. **Say what would change your mind.** Each finding carries the evidence that would refute it.
6. **[v2] Verify against the repository *and the execution environment*.** This is the single
   most important change in v2, and it exists because both v1 reviewers made the *same* wrong
   claim — that no vitest worker cap existed — because both searched only the repo. The cap is
   real; it lives in `~/.zshenv`. Before concluding that any safeguard, tool, config, or
   mechanism is **absent**, check all of: the repo, the shell environment (`env`, `~/.zshenv`,
   `~/.zshrc`), global tool config (`~/.twux/`, `~/.claude/`), installed binaries on `PATH`,
   and git history for things since removed or rewritten. Two models from two vendors reaching
   the same wrong answer is not independent confirmation — it is a shared blind spot, and this
   rule is how you avoid being the third.
7. **[v2] Absence claims must state their scope of search.** Any finding of the form "X does
   not exist" carries the exact commands you ran and the locations you searched. A finding that
   says "not in the repo" must not conclude "does not exist".
8. **[v2] Declare your assumptions.** Anything you inferred rather than read goes in
   `assumptions_made`. A v1 reviewer built a finding on a misread of an agent-count breakdown;
   had the inference been declared, it would have been visible instead of load-bearing.
9. **Out of bounds** — typos, grammar, formatting, markdown style, wording preferences, or
   anything the spec's own *Out of Scope* / *Carried forward, unresolved* sections already name.
10. **Do not fix anything, and do not mutate state.** Read, grep, glob, and read-only shell
    only. No tests, no builds, no installs, no writes except your own output JSON.
11. **[v2] Do not fill the `reviewer` field from self-knowledge.** Your launch brief states
    your model and effort. Copy it verbatim. A v1 reviewer launched at `low` reported itself
    as `medium`; model identity is not a field an agent may introspect reliably.

## Dimensions

Score 0–4 against the anchors. Pick the level whose description matches what you observed.

### D1 · Soundness — *will the pipeline produce what it claims?*
| 0 | A core mechanism cannot work as described. Demonstrated, not suspected. |
|---|---|
| 1 | A core mechanism is likely to fail under ordinary conditions. |
| 2 | Works in the common case; at least one unaddressed failure path. |
| 3 | Sound throughout; minor gaps degrade quality without breaking correctness. |
| 4 | Sound, and non-obvious failure paths are explicitly addressed. |

### D2 · Completeness — *is anything necessary missing?*
| 0 | A phase consumes an input no earlier phase produces. |
|---|---|
| 1 | A necessary phase or gate is absent. |
| 2 | Underspecified: an output shape a downstream phase cannot rely on. |
| 3 | Complete; ambiguity only where the spec flags it as open. |
| 4 | Complete, and each artifact's consumer is explicitly identified. |

### D3 · Cost & feasibility realism
| 0 | Cannot run within stated constraints; the arithmetic fails. |
|---|---|
| 1 | Estimates off by >2× in a way that changes the decision to run it. |
| 2 | Plausible but resting on an unstated assumption that could break them. |
| 3 | Realistic, dominant cost identified, a knob offered. |
| 4 | Realistic, with sensitivity to inputs made explicit. |

### D4 · Failure modes — *what breaks, and does it break loudly?*
| 0 | A failure mode produces a confident wrong result with no signal. |
|---|---|
| 1 | A significant failure mode is unmitigated. |
| 2 | Named, but a mitigation is asserted rather than demonstrated. |
| 3 | Major failure modes identified and mitigated fail-closed. |
| 4 | As 3, and the mitigations themselves have stated verification. |

### D5 · Evidence quality
| 0 | A load-bearing claim is false or contradicted by repo or environment. |
|---|---|
| 1 | Load-bearing claims asserted with no evidence and not flagged as such. |
| 2 | Mixed: some proven, others asserted without distinction. |
| 3 | Evidence-backed where it matters, unproven claims flagged. |
| 4 | As 3, and the evidence is independently reproducible from the spec. |

### D6 · Scope discipline — *apply the spec's own deletion test to the spec*
| 0 | A whole phase is redundant — another phase already produces its output. |
|---|---|
| 1 | Significant over-engineering: complexity with no stated consumer. |
| 2 | One or two elements speculative rather than required. |
| 3 | Tight; each phase has an identified consumer. |
| 4 | Tight, and the spec shows evidence of having removed something. |

### [v2] D7 · Fix integrity — *did the v1 fixes actually land?*
| 0 | A fix is claimed in `REVIEW-RESPONSE.md` but absent or contradicted in `SPEC.md`. |
|---|---|
| 1 | A fix is present as prose but not operationalised — nothing enforces it. |
| 2 | Fixes land but at least one introduces a new problem. |
| 3 | All accepted findings are genuinely addressed. |
| 4 | As 3, and each fix has a stated verification. |

## [v3] Verdict constraint

Your verdict must be consistent with your own scores. In round 2 a reviewer returned
`PROCEED_WITH_CHANGES` while scoring D5 = 0 ("a load-bearing claim is false") and D7 = 0 ("a
fix is claimed but absent"). Those cannot coexist.

| Lowest score on any dimension | Verdict must be |
|---|---|
| any dimension = 0 | **BLOCK** |
| any dimension = 1 | **BLOCK** or **REVISE** |
| minimum = 2 | **REVISE** or **PROCEED_WITH_CHANGES** |
| minimum >= 3 | **PROCEED_WITH_CHANGES** or **PROCEED** |
| all dimensions = 4 | **PROCEED** |

If your verdict and your scores disagree, one of them is wrong — fix whichever is wrong. Do not
soften a score to justify a verdict, and do not soften a verdict to avoid re-scoring.

## Required output

Return **exactly one JSON object**. No prose, no markdown fence.

```json
{
  "reviewer": "<COPY VERBATIM from your launch brief — do not introspect>",
  "target": "docs/plans/2026-07-26-deep-review/SPEC.md",
  "round": 2,
  "verdict": "BLOCK | REVISE | PROCEED_WITH_CHANGES | PROCEED",
  "verdict_rationale": "<2 sentences max, why this and not the adjacent verdict>",
  "strongest_objection": "<your single best attack, one paragraph>",
  "scores": {
    "D1_soundness":     {"score": 0, "why": "<cite the anchor you matched>"},
    "D2_completeness":  {"score": 0, "why": "..."},
    "D3_cost_realism":  {"score": 0, "why": "..."},
    "D4_failure_modes": {"score": 0, "why": "..."},
    "D5_evidence":      {"score": 0, "why": "..."},
    "D6_scope":         {"score": 0, "why": "..."},
    "D7_fix_integrity": {"score": 0, "why": "..."}
  },
  "fix_regression": [
    {
      "adjudication_id": "<A1..A14 from REVIEW-RESPONSE.md>",
      "status": "landed | prose_only | absent | introduced_new_problem",
      "evidence": "<what you checked in SPEC.md and what you found>"
    }
  ],
  "findings": [
    {
      "id": "F1",
      "dimension": "D1",
      "severity": "critical | major | minor",
      "confidence": "high | medium | low",
      "novel": true,
      "spec_section": "<heading>",
      "quote": "<verbatim claim>",
      "claim": "<one sentence: what is wrong>",
      "failure_scenario": "<concrete conditions → wrong outcome>",
      "would_change_my_mind": "<evidence that would refute this finding>",
      "recommendation": "<smallest change that fixes it>"
    }
  ],
  "assumptions_made": ["<anything you inferred rather than read>"],
  "checked_independently": [
    {
      "claim": "<the spec claim you tested>",
      "scope_searched": "<exact commands / locations — repo AND environment>",
      "result": "confirmed | contradicted | inconclusive",
      "detail": "<what you found>"
    }
  ],
  "no_findings_justification": "<REQUIRED if no critical or major findings: what you checked and why nothing surfaced. 'Looks good' is rejected.>",
  "coverage_gaps": ["<what you could not assess, and why>"]
}
```

### Field rules

- `verdict` — **BLOCK** = a core mechanism is broken, do not run. **REVISE** = substantial
  rework first. **PROCEED_WITH_CHANGES** = run after the listed fixes. **PROCEED** = run as
  written.
- `novel` — `true` if this was not raised in round 1. Re-raising a round-1 finding is legitimate
  **only** if the fix failed; set `novel: false` and cite the adjudication id.
- `fix_regression` — **[v2]** one entry per adjudication id A1–A14. Do not skip ids.
- `checked_independently` — **[v2]** replaces v1's `checked_against_repo`. The `scope_searched`
  field is mandatory and is the guard against the round-1 correlated blind spot.
- `coverage_gaps` — an honest gap beats a confident guess.

## Worked examples

**Good** — cites text, constructs failure, states its own refutation, declares scope:

```json
{
  "id": "F1", "dimension": "D7", "severity": "major", "confidence": "high", "novel": true,
  "spec_section": "Implementation Decisions → The wrapper primitive",
  "quote": "codex-agent.sh therefore generates a random nonce at runtime",
  "claim": "The nonce mitigation is specified in prose but no artifact implements it; codex-agent.sh is not tracked in the repository.",
  "failure_scenario": "Run A launches with the untracked scratchpad copy of the script, which has no nonce logic. Wrapper self-answer remains undetectable, and the spec's fail-closed claim is false at execution time.",
  "would_change_my_mind": "A tracked codex-agent.sh containing nonce generation and a workflow-side validator.",
  "recommendation": "Commit the script with the nonce implementation before Run A, and reference its path from the spec."
}
```

**Bad** — no citation, no scenario, unfalsifiable:

```json
{"claim": "The verification phase might be expensive.", "failure_scenario": "Costs could add up."}
```

# Round 2 Adversarial Review — Brief (Reviewer A)

## Your stamped identity

```
reviewer: claude-fable-5 (launched --effort low)
```

Copy that string **verbatim** into the `reviewer` field. Do not introspect your model or
effort — in round 1 a reviewer launched at `low` reported itself as `medium`.

## Read, in this order

1. `docs/plans/2026-07-26-deep-review/REVIEW-RUBRIC-v2.md` — your role, rules, seven scoring
   dimensions, and the exact JSON output shape. Changes from v1 are marked **[v2]** and each
   was earned by a real failure last round.
2. `docs/plans/2026-07-26-deep-review/REVIEW-RESPONSE.md` — the adjudication of round 1.
   Lists 11 accepted findings (A1–A14) the author claims are now fixed.
3. `docs/plans/2026-07-26-deep-review/SPEC.md` — your target, revised.

Optional context: `review-fable.json` and `review-sol.json` are round 1's raw output.

## Your primary investigation mandate: **ground truth and environment**

Two reviewers are running this round with deliberately *different* mandates. Yours is reality-
checking. This split exists because in round 1 both reviewers independently made the **same**
wrong claim — that no vitest worker cap existed — because both searched only the repository.
The cap is real and lives in `~/.zshenv`. Identical scoping produced correlated blindness, and
correlated blindness is indistinguishable from confirmation.

So your emphasis:

- **Verify every claimed fix actually landed.** Fill `fix_regression` with one entry per
  adjudication id A1 through A14. A fix asserted in prose but not operationalised is
  `prose_only`, not `landed`.
- **Check the execution environment, not just the repo.** `env`, `~/.zshenv`, `~/.zshrc`,
  `~/.twux/`, binaries on `PATH`, and git history for things since removed or rewritten. Before
  concluding anything is absent, say in `scope_searched` exactly where you looked.
- **Re-verify the spec's factual claims at current HEAD.** The repo moved *during* the
  conversation that produced v1 — commit `ed07b29` landed mid-review and made the scope table
  stale. Assume it may have moved again.
- **Check that artifacts the spec depends on exist.** The spec references `codex-agent.sh`, a
  probe transcript, and a finding schema. Do they exist? Are they tracked?

This is an emphasis, not a restriction — report anything you find.

## Hard constraints

- **Write exactly one file:** `docs/plans/2026-07-26-deep-review/review-fable-r2.json`
- **Do not modify anything else.** No fixes, no edits to spec or rubric.
- **Do not mutate state.** No tests, no builds, no installs. Read-only shell only.
- **Agreement is not a successful review.** No critical or major findings means
  `no_findings_justification` is mandatory.
- Respect the rubric's out-of-bounds list, including the spec's own *Carried forward,
  unresolved* section — those are known and not findings.

## When done

Write the file, then reply with exactly:

`REVIEW-DONE review-fable-r2.json <verdict> <total findings> <novel findings>`

Then stop.

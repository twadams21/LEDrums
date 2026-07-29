# Round 3 Adversarial Review — fable

## Your stamped identity
```
reviewer: claude-fable-5 (runtime: High — verify against your pane footer, not the twux registry)
```
Copy verbatim into the `reviewer` field. Do not introspect.

## Read, in this order
1. `REVIEW-RUBRIC-v3.md` — role, rules, 7 dimensions, output shape, and the new verdict-vs-score constraint.
2. `REVIEW-RESPONSE-R2.md` — the 13 round-2 findings (B1-B13) and what was changed for each.
3. `SPEC.md` — your target, revised again.
4. `schemas/` and `artifacts/` — these are new and are the substance of this round.

Prior rounds: `review-{fable,sol}.json` and `review-{fable,sol}-r2.json`.

## Your mandate
GROUND TRUTH AND ENVIRONMENT. Verify every B1-B13 fix actually landed in commit e50da8d. RUN the artifacts — codex-agent.sh and verify-nonce.sh are executable and testable; do not review them by reading alone. Check the repo AND the execution environment (env, ~/.zshenv, ~/.twux, PATH, git history). Confirm the 24 files are genuinely tracked.

This is emphasis, not restriction — report anything you find.

## Fix regression
Fill `fix_regression` with one entry per **B1 through B13** (not A1-A14 — that was round 2's list). Do not skip ids.

## Hard constraints
- Write exactly one file: `docs/plans/2026-07-26-deep-review/review-fable-r3.json`
- Do not modify anything else. No edits to spec, schemas, artifacts, or rubric.
- You MAY execute the review artifacts (`artifacts/*.sh`) to test them, and you MAY run read-only git/grep/ajv. Do NOT run the project's test suite, builds, or installs, and do not mutate the repo.
- Agreement is not a successful review. No critical/major findings requires `no_findings_justification`.
- Respect out-of-bounds: typos, formatting, and anything in the spec's own *Carried forward, unresolved* section.

## When done
Reply with exactly: `REVIEW-DONE review-fable-r3.json <verdict> <total> <novel>`
Then stop.

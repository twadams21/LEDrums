# Review Response — Round 2 → SPEC v3

**Round 2 verdicts:** Fable PROCEED_WITH_CHANGES (4 findings, D5=0 D7=0) · Sol **BLOCK**
(8 findings, D1–D5=0, D7=0)
**Adjudicated:** 2026-07-26 · **Commit:** `e50da8d`

Round 2's scorecard on round 1's fixes: 7 landed, **4 introduced new problems**, 2 absent, 1
prose-only. The lesson taken: every unresolved finding traced to a **missing artifact**, not to
weak prose. So v3 builds artifacts and stops rewording.

## Adjudication

| ID | Source | Finding | Verdict | Change (all in `e50da8d`) |
|---|---|---|---|---|
| **B1** | Sol F1 🔴 | Phase 3b mutation experiments have no isolation or serialization; concurrent lanes test the combined patch | **ACCEPT** | 3b now requires a per-candidate worktree from the pinned baseline sha; suite runs serialise via `pnpm gates`; `verdict.schema.json` makes a null `worktree_path` invalid when `required: true` |
| **B2** | Both 🔴 | A3 absent — nonce claimed, implemented nowhere; artifacts untracked | **ACCEPT** | `artifacts/codex-agent.sh` with runtime nonce **and** out-of-band receipts ledger; `artifacts/verify-nonce.sh`; proof in `artifacts/NONCE-TEST.md`; all 24 files now tracked |
| **B3** | Both | A6 absent — finding schema undefined, no blocking statement | **ACCEPT** | `schemas/finding.schema.json` + `verdict.schema.json`, ajv-validated against passing and failing examples; Run A blocked on them explicitly |
| **B4** | Sol F6 🔴 | `N_MAX` caps findings but cost is 1–3 refuters each — 45 findings can be 135 calls | **ACCEPT** | Cap re-expressed as `REFUTER_BUDGET = 90` Opus-high **calls**; `WRAPPER_BATCH_SIZE = 4` |
| **B5** | Fable F3 | Three unbound thresholds (`N`, `N`, `N_MAX`) make "mechanical" criteria non-mechanical | **ACCEPT** | All bound: duplication ≥12 lines / ≥90% similarity, scatter ≥4 files / ≥3 commits, clumps ≥3/≥3, switches ≥3 |
| **B6** | Sol F2 | Criteria table marks model-judged tests "mechanical" | **ACCEPT** | "Mechanical" redefined as *decidable without model judgement*; deletion test reclassified non-mechanical; new **auto-fix eligible** column |
| **B7** | Sol F3 | A7 ineligibility rule unenforceable — no phase computes the interface delta | **ACCEPT** | `interface_delta` and `removes_failure_path` are required schema fields with an `unknown` escape that routes to the structural track |
| **B8** | Sol F5 | A10 self-contradictory — Solution and User Story 4 still said "discarded" | **ACCEPT** | Fixed at all three sites |
| **B9** | Sol F8 | Count-only logging of dropped findings recreates the A10 data loss | **ACCEPT** | `03-unadmitted.json` retains complete finding objects, never counts |
| **B10** | Sol F7 | Phases 4/9/10 emit Markdown while Phase 10 is said to render from the schema | **ACCEPT** | JSON canonical, Markdown a generated view; full producer/consumer table |
| **B11** | Fable F4 | Seam contract omits `03-refuted.json`, no home for launcher/schema/transcripts | **ACCEPT** | Contract rewritten: 16 rows, each with schema and consumers |
| **B12** | Fable F1 | The "committed to the output root" claim is false | **ACCEPT** | Claim removed, then made true. `git ls-files docs/plans/2026-07-26-deep-review/` is the check |
| **B13** | — | Fable returned PROCEED_WITH_CHANGES with two zero scores | **RUBRIC FIX** | v3 adds a verdict-vs-score constraint: any dimension at 0 forces BLOCK. **Stricter, not looser** |

**13 accepted, 0 rejected.** Round 2 found nothing I could defend against.

## One bug found by testing, not by reviewing

The first `codex-agent.sh` ran `cd "$WORKDIR"` before `cat "$PROMPT_FILE"`, so relative prompt
paths broke. Near-silent: `claude` exited 1 with *"Input must be provided"* while the
provenance line still printed, so a caller checking only for provenance would record a
successful lane that produced nothing. Fixed by reading the prompt before the `cd`.

Recorded because it is the argument for the whole v3 approach: two rounds of adversarial
*reading* did not find this. Running the thing found it in one attempt.

## Rubric integrity note

The target for round 3 was set as a score. The rubric was **not** adjusted toward it — the only
v3 change makes it harder to pass. Reviewers have not been told any target, because a reviewer
told the number they are meant to produce is no longer measuring anything.

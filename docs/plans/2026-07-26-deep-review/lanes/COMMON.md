# Lane Common Rules — deep-review execution (read fully; your lane doc names your initiative)

You are an implementer lane in the deep-review execution fleet. Your orchestrator
(session `impl-orch-76980d`) merges; you never push.

## Ground rules

1. **Worktree = your cwd.** Stay in it for your whole lane. Work on a branch:
   `git checkout -b init/<your-initiative-slug> review/impl` (base ref `review/impl`
   exists in the shared repo; verify with `git log --oneline -1 review/impl` —
   expect `c0096be` or later).
2. **Your plan is `docs/plans/2026-07-26-deep-review/09-synthesis/<initiative>.json`**
   (step-by-step with per-step verification). **`docs/plans/2026-07-26-deep-review/11-decisions.md`
   OVERRIDES the plan wherever they disagree** — read it before starting; your lane
   doc calls out the overrides that hit your initiative.
3. **Greenfield data posture:** two users, no real show files. Drop legacy
   fields/aliases outright; zod strip-on-parse is an acceptable migration; no
   fixture-corpus gates.
4. **Gates:** `pnpm gates`, NEVER `pnpm test`. Run it FOREGROUND and read the
   output — never background it. It takes a machine-wide lock; if it waits, that
   is a sibling's run — wait, don't kill. One green `pnpm gates` per committed step.
5. **Re-measure the test baseline at your starting HEAD** before step 1. At
   `c0096be` the suite is 3007 tests (core 859 / web 1582 / server 413 / io 76 /
   desktop 36 / error-ingest 31 / protocol 10). Any count hard-coded in plan text
   (2,981 / 2,968) is stale — gate on your own measured number, which must only rise
   unless your plan deletes tests.
6. **One commit per plan step**, message `<init-id> S<n>: <title>`. Verify each
   step's stated verification literally (greps, diffstats, spy assertions) — the
   exit code alone is never evidence.
7. **Scope fence:** touch only files your plan (plus decision overrides) names.
   If a step forces an out-of-scope edit, STOP and report blocked instead.
8. **Do not push. Do not merge. Do not touch other worktrees or sessions.**
   `dead-code-0001` files (`PatchClipboardToolbar.svelte`, `PatchDiffDialog.svelte`)
   are HELD — never delete them.
9. **Report when your verdict is reached** (done / blocked / failed):
   `twux send-message --session parent --status <s> "<report>"` — include your
   branch name, per-step shas, final gates numbers, deviations, and how to verify.
   The report is the deliverable; going idle without it strands the fleet.
10. If a question in your plan is marked `owner: trent` and not resolved in
    11-decisions.md, take the plan's stated default; if the plan has no default,
    report blocked with a recommendation. Never guess product/taste calls.

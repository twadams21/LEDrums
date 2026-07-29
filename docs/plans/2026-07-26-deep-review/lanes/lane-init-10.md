# Lane: INIT-10-test-helper-dedup (light track, lands before INIT-02)

Read `lanes/COMMON.md` first — it binds. Branch: `init/10-test-helpers` off `review/impl`.
Plan: `docs/plans/2026-07-26-deep-review/09-synthesis/INIT-10-test-helper-dedup.json`
(steps in its `sequencing` order, one green commit each).

## Decision overrides (11-decisions.md — these beat the plan text)

- **`test-support/` is the repo-wide convention** for shared test helpers.
- **Core test helpers stay vitest-free** (pure `finite01Failures` shape) — no
  vitest import may enter `packages/core/src/test-support/`.

## Watch

- Test-only initiative: production behaviour must not change. Your diffstat
  should show ONLY test files, test-support files, and the plan's doc artifacts.
- The suite count may legitimately move if helpers consolidate parameterized
  cases — record before/after counts per package in your report and explain any
  delta; an unexplained drop is a failure.
- Wave siblings are editing `apps/server` and `packages/io` tests — those files
  are OUT of your scope by construction; if your plan seems to point into them,
  stop and report blocked.

# Lane: INIT-08-kit-schema-split (light track)

Read `lanes/COMMON.md` first — it binds. Branch: `init/08-kit-schema` off `review/impl`
(HEAD `ff8a1e5` or later — INIT-03 and INIT-10 are merged; re-measure your baseline,
expect ~3055 tests).
Plan: `docs/plans/2026-07-26-deep-review/09-synthesis/INIT-08-kit-schema-split.json`
(steps in its `sequencing` order, one green commit each).

## Decision overrides (11-decisions.md — these beat the plan text)

- **Decision 6: acceptance approved as-is** — moved-line diffs + typecheck +
  synthetic suite + real-kit parse/DMX byte parity; NO fixture corpus.
- **Decision 6 added scope: collapse the migration ladder to a v7 floor** —
  parse REJECTS pre-v7 files (matches zero real files; greenfield posture).

## Watch

- INIT-03 just made `buildDmxMap` protocol-aware (sACN 1-based universes,
  merged in `ff8a1e5`). Your DMX byte-parity checks run against CURRENT
  review/impl behaviour — never against pre-merge fixtures or stale goldens.
- Sibling lanes are editing `apps/server` (main.ts/ws/http territory) and
  `apps/web` patch-inspector/patch-graph territory — out of your scope; your
  plan's output-manager.test.ts touchpoint is now free (INIT-03 merged), but
  re-read that file at your HEAD before editing: it changed under INIT-03.

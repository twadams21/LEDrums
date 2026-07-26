# Phase 0 raw tool output

Regenerate: `bash ../artifacts/phase0.sh` then `node scripts/with-gate-lock.mjs bash ../artifacts/phase0-coverage.sh`.

Coverage invocation gotchas, both observed 2026-07-26:
- `pnpm run test -- <flags>` — pnpm passes `--` through literally; vitest swallows every
  flag after it. The suite runs GREEN and silently produces NO coverage. Worst kind of failure.
- `pnpm exec vitest` — fails for apps/web with ERR_MODULE_NOT_FOUND on 'vite'.
- What works: run the root `node_modules/.bin/vitest` from inside the package directory.

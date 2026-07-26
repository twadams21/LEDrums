#!/usr/bin/env bash
# phase0-coverage.sh — behaviour baseline via vitest v8 coverage.
#
# Separate from phase0.sh because this RUNS THE TEST SUITE. Concurrent full
# sweeps have wedged this machine, so the root script pins
# --workspace-concurrency=1 and the whole sequence runs under the machine-wide
# gate lock. Worker caps come from ~/.zshenv (VITEST_MIN/MAX_THREADS,
# MIN/MAX_FORKS = 1/2); there is no vitest.config.* in this repo, so a repo-only
# search for the cap finds nothing.
#
# Coverage serves two purposes:
#   1. Behaviour baseline — the before-picture for "same behaviour, less code".
#   2. A SECOND, INDEPENDENT dead-code signal. knip reasons statically over the
#      import graph; coverage observes what actually executes. Flagged by knip
#      AND never executed is stronger than either alone. Untested is NOT dead —
#      corroboration, never proof.
#
# ── WHY THE INVOCATION LOOKS LIKE THIS ────────────────────────────────────────
# The coverage flags live in each package's `test:coverage` script, NOT on this
# command line. Deliberate and load-bearing:
#
#   `pnpm --filter X run test -- --coverage.enabled …` passes the `--` through
#   LITERALLY. vitest treats it as a positional and silently ignores every flag
#   after it. The suite runs GREEN, 1585 tests pass, and NO coverage is written.
#   Green-with-no-output is worse than a crash — nothing signals the failure.
#
# Passing zero flags means there is no flag-passing bug available to make.
# Observed 2026-07-26; `pnpm exec vitest` separately failed to resolve workspace
# `vite` for apps/web.
#
# And because "we fixed the invocation" is a convention, not a guarantee, every
# package's output is ASSERTED below: missing or stale coverage-summary.json is
# a hard failure. A future silent no-op cannot pass as success.
#
# usage: phase0-coverage.sh [output-dir]
set -uo pipefail

REPO="$(git rev-parse --show-toplevel)"
OUT="${1:-$REPO/docs/plans/2026-07-26-deep-review}"
RAW="$OUT/00-raw/coverage"
mkdir -p "$RAW"
cd "$REPO"

# package-dir : pnpm-filter-name
UNITS="packages/core:@ledrums/core packages/io:@ledrums/io packages/protocol:@ledrums/protocol apps/server:@ledrums/server apps/web:@ledrums/web"

STARTED=$(date +%s)
FAILED=0

for entry in $UNITS; do
  dir="${entry%%:*}"; pkg="${entry##*:}"; short="$(basename "$dir")"
  echo "coverage: $short"
  # Clear this unit's collected output FIRST. Otherwise a failed run leaves the
  # previous run's copy in place and the summariser reports old numbers as
  # current — observed during the negative test of this very guard.
  rm -rf "${RAW:?}/$short"
  pnpm --filter "$pkg" run test:coverage > "$RAW/$short.log" 2>&1
  rc=$?                      # capture BEFORE anything else clobbers $?

  # POST-CONDITION. Never trust that the run produced what it claims.
  summary="$dir/coverage/coverage-summary.json"
  if [ ! -f "$summary" ]; then
    echo "  FAIL exit=$rc — no $summary. Flags did not apply, or the run died." >&2
    FAILED=1; continue
  fi
  mtime=$(stat -f %m "$summary" 2>/dev/null || stat -c %Y "$summary" 2>/dev/null || echo 0)
  if [ "$mtime" -lt "$STARTED" ]; then
    echo "  FAIL exit=$rc — $summary is STALE (predates this run). Reading it would report old numbers as current." >&2
    FAILED=1; continue
  fi

  mkdir -p "$RAW/$short"
  cp "$dir/coverage/coverage-summary.json" "$RAW/$short/" 2>/dev/null
  cp "$dir/coverage/coverage-final.json"   "$RAW/$short/" 2>/dev/null
  if [ "$rc" -ne 0 ]; then
    echo "  FAIL exit=$rc — coverage written but the suite did not pass." >&2
    FAILED=1
  else
    echo "  ok"
  fi
done

echo "coverage: summarising"
node -e '
const fs=require("fs"),path=require("path");
const raw=process.argv[1], expected=process.argv[2].split(",");
const out={}; const missing=[];
for (const name of expected) {
  const f=path.join(raw,name,"coverage-summary.json");
  if(!fs.existsSync(f)){ missing.push(name); continue; }
  const t=JSON.parse(fs.readFileSync(f,"utf8")).total;
  out[name]={lines:t.lines.pct,statements:t.statements.pct,functions:t.functions.pct,branches:t.branches.pct};
}
fs.writeFileSync(path.join(raw,"..","..","00-coverage.json"),JSON.stringify(out,null,2));
console.log(JSON.stringify(out,null,2));
if(missing.length){ console.error("MISSING coverage for: "+missing.join(", ")); process.exit(1); }
' "$RAW" "core,io,protocol,server,web" || FAILED=1

if [ "$FAILED" -ne 0 ]; then
  echo "phase0-coverage: FAILED — baseline incomplete, do NOT proceed to Phase 1" >&2
  exit 1
fi
echo "phase0-coverage: complete, $(echo $UNITS | wc -w | tr -d ' ') unit(s) verified"

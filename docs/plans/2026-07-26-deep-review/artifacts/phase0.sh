#!/usr/bin/env bash
# phase0.sh — Baseline & instrument. Emits 00-baseline.json + raw tool output.
#
# Reproducible by construction: every number this produces comes from a command
# recorded alongside it. v1 of the spec carried a hand-measured scope table that
# went stale during the conversation that produced it; this exists so that
# cannot recur.
#
# Does NOT run the test suite — see phase0-coverage.sh, which must take the
# machine-wide gate lock.
#
# usage: phase0.sh [output-dir]
set -euo pipefail

REPO="$(git rev-parse --show-toplevel)"
OUT="${1:-$REPO/docs/plans/2026-07-26-deep-review}"
RAW="$OUT/00-raw"
B="$REPO/node_modules/.bin"
mkdir -p "$RAW"
cd "$REPO"

SHA="$(git rev-parse HEAD)"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
DIRTY="$(git status --porcelain | grep -vc '^??' || true)"

# The exact selector, recorded verbatim so the numbers can be reproduced.
# Recorded verbatim so the numbers can be reproduced. Kept JSON-safe (no raw
# backslashes) — an earlier version embedded the regex directly and produced a
# 00-baseline.json that would not parse.
SRC_SELECTOR="git ls-files <unit>, keep extensions ts/tsx/js/mjs/cjs/svelte/rs, drop names containing .test. or .spec. or ending _tests.rs"
TEST_SELECTOR="git ls-files, keep names matching .test. or .spec. with ts/js/mjs, plus *_tests.rs"

unit_files() {
  git ls-files "$1" | grep -Ei '\.(ts|tsx|js|mjs|cjs|svelte|rs)$' \
    | grep -v '\.test\.' | grep -v '\.spec\.' | grep -v '_tests\.rs$' || true
}

echo "phase0: baseline $SHA on $BRANCH (tracked-dirty=$DIRTY)"

UNITS="packages/core packages/io packages/protocol apps/server apps/web apps/desktop workers/error-ingest scripts"
SCOPE_JSON="$RAW/scope.json"
{
  echo "{"
  first=1
  for u in $UNITS; do
    files="$(unit_files "$u")"
    n=$(printf '%s' "$files" | grep -c . || true)
    loc=0
    [ "$n" -gt 0 ] && loc=$(printf '%s\n' "$files" | tr '\n' '\0' | xargs -0 wc -l 2>/dev/null | tail -1 | awk '{print $1}')
    [ $first -eq 0 ] && echo ","
    first=0
    printf '  "%s": {"files": %s, "loc": %s}' "$u" "${n:-0}" "${loc:-0}"
  done
  echo; echo "}"
} > "$SCOPE_JSON"

TEST_LOC=$(git ls-files | grep -E '\.(test|spec)\.(ts|js|mjs)$|_tests\.rs$' | tr '\n' '\0' | xargs -0 wc -l 2>/dev/null | tail -1 | awk '{print $1}')

echo "phase0: knip"
"$B/knip" --reporter json > "$RAW/knip.json" 2> "$RAW/knip.err" || true
echo "phase0: depcheck"
"$B/depcheck" --json > "$RAW/depcheck.json" 2> "$RAW/depcheck.err" || true
echo "phase0: madge (cycles)"
: > "$RAW/madge-cycles.txt"
for u in packages/core packages/io packages/protocol apps/server apps/web workers/error-ingest; do
  echo "--- $u" >> "$RAW/madge-cycles.txt"
  "$B/madge" --extensions ts,svelte --circular "$u" >> "$RAW/madge-cycles.txt" 2>&1 || true
done
echo "phase0: madge (core purity)"
"$B/madge" --extensions ts --json packages/core/src > "$RAW/madge-core-graph.json" 2> "$RAW/madge-core.err" || true
echo "phase0: jscpd (>=12 lines, >=90%)"
"$B/jscpd" packages apps --min-lines 12 --min-tokens 70 --reporters json,console \
  --output "$RAW/jscpd" --ignore '**/node_modules/**,**/dist/**,**/web-dist/**,**/target/**,**/.svelte-kit/**' \
  > "$RAW/jscpd-console.txt" 2>&1 || true

TOOLVER=$(node -e '
const p=require("./package.json").devDependencies||{};
const pick=["knip","depcheck","madge","jscpd","ajv-cli","@vitest/coverage-v8"];
console.log(JSON.stringify(Object.fromEntries(pick.filter(k=>p[k]).map(k=>[k,p[k]]))));')

cat > "$OUT/00-baseline.json" <<JSON
{
  "phase": "0",
  "generated_by": "artifacts/phase0.sh",
  "baseline_sha": "$SHA",
  "branch": "$BRANCH",
  "tracked_dirty_files": $DIRTY,
  "selectors": {
    "source": "$SRC_SELECTOR",
    "tests": "$TEST_SELECTOR"
  },
  "scope": $(cat "$SCOPE_JSON"),
  "test_loc": ${TEST_LOC:-0},
  "tool_versions": $TOOLVER,
  "tools_dropped": {"ts-prune": "0/20 precision on packages/io — flags every barrel re-export; see pilot/PILOT.md"},
  "thresholds": {
    "duplication_min_lines": 12,
    "duplication_min_similarity_pct": 90,
    "data_clump_min_params": 3,
    "data_clump_min_sites": 3,
    "repeated_switch_min_sites": 3,
    "change_scatter_min_files": 4,
    "change_scatter_min_commits": 3,
    "refuter_budget": 90,
    "wrapper_batch_size": 4,
    "tool_precision_gate_pct": 50
  },
  "raw_output_dir": "00-raw/"
}
JSON
echo "phase0: wrote $OUT/00-baseline.json"

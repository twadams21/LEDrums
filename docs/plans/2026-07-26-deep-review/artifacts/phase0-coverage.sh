#!/usr/bin/env bash
# phase0-coverage.sh — behaviour baseline via vitest v8 coverage.
#
# Separate from phase0.sh because this RUNS THE TEST SUITE. Concurrent full
# sweeps have wedged this machine, so packages run ONE AT A TIME in the
# foreground, and the machine-wide gate lock is taken for the whole sequence.
# Worker caps come from ~/.zshenv (VITEST_MIN/MAX_THREADS, MIN/MAX_FORKS = 1/2);
# there is no vitest.config.* in this repo, so a repo-only search finds no cap.
#
# Coverage serves two purposes for the review:
#   1. Behaviour baseline — the before-picture for "same behaviour, less code".
#   2. A SECOND, INDEPENDENT dead-code signal. knip reasons statically over the
#      import graph; coverage observes what actually executes. A symbol flagged
#      by knip AND never executed is a stronger candidate than either alone.
#      Untested is NOT dead — this is corroboration, never proof.
#
# usage: phase0-coverage.sh [output-dir]
set -uo pipefail

REPO="$(git rev-parse --show-toplevel)"
OUT="${1:-$REPO/docs/plans/2026-07-26-deep-review}"
RAW="$OUT/00-raw/coverage"
mkdir -p "$RAW"
cd "$REPO"

PKGS="@ledrums/core @ledrums/io @ledrums/protocol @ledrums/server @ledrums/web"

for p in $PKGS; do
  short="${p#@ledrums/}"
  echo "coverage: $short"
  # Invoke the root vitest binary from inside the package dir.
  # NOT `pnpm run test -- <flags>`: pnpm passes the `--` through literally and
  # vitest swallows every flag after it, so the suite runs green and silently
  # produces NO coverage. NOT `pnpm exec vitest` either: that failed to resolve
  # workspace `vite` for apps/web. Both were observed on 2026-07-26.
  ( cd "$(node -e "console.log(require.resolve('"'"'./package.json'"'"'))" 2>/dev/null >/dev/null; echo "$REPO/$dir") && \
    "$REPO/node_modules/.bin/vitest" run \
      --coverage.enabled \
      --coverage.provider=v8 \
      --coverage.reporter=json-summary \
      --coverage.reporter=json \
      --coverage.reportsDirectory="$RAW/$short" \
      > "$RAW/$short.log" 2>&1
  rc=$?   # capture BEFORE any other command clobbers $?
  echo "  exit=$rc"
done

echo "coverage: summarising"
node -e '
const fs=require("fs"),path=require("path");
const raw=process.argv[1];
const out={};
for (const d of fs.readdirSync(raw,{withFileTypes:true}).filter(x=>x.isDirectory())) {
  const f=path.join(raw,d.name,"coverage-summary.json");
  if(!fs.existsSync(f)) { out[d.name]={error:"no coverage-summary.json"}; continue; }
  const t=JSON.parse(fs.readFileSync(f,"utf8")).total;
  out[d.name]={lines:t.lines.pct,statements:t.statements.pct,functions:t.functions.pct,branches:t.branches.pct};
}
fs.writeFileSync(path.join(raw,"..","..","00-coverage.json"),JSON.stringify(out,null,2));
console.log(JSON.stringify(out,null,2));
' "$RAW"

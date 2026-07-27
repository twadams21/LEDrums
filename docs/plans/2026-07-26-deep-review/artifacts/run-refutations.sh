#!/usr/bin/env bash
# run-refutations.sh — Phase 3a executor. Runs N codex refutations with a HARD
# concurrency cap enforced in code.
#
# WHY THIS EXISTS
# ---------------
# The first attempt fanned this work out across 10 Workflow wrapper agents whose
# prompt said "you may run them in parallel with & and wait". Ten agents each
# honoured that for ~11 subprocesses, so 107 concurrent `claude -p` Node
# processes launched at once and took the machine down. Zero useful work, one
# reboot.
#
# The error was not the number. It was that the limit lived in a PROMPT. A
# prompt is a request; ten independent agents each granted it. Concurrency has
# to be a property of the runner, not an instruction to a model.
#
# So: no agents. One script. `xargs -P` is the cap, and it cannot be
# reinterpreted. A load-average circuit breaker sits on top of it, because a cap
# tuned on an idle machine is still wrong on a busy one.
#
# usage: run-refutations.sh [concurrency] [max-load]
#   concurrency  default 3
#   max-load     default 12 — pause new launches while 1-min load exceeds this
set -uo pipefail

D="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(git -C "$D" rev-parse --show-toplevel)"
CONC="${1:-3}"
MAXLOAD="${2:-12}"
MODEL='gpt-5.6-sol(medium)'

MAN="$D/03-refute/manifest.json"
[ -r "$MAN" ] || { echo "no manifest at $MAN" >&2; exit 2; }
mkdir -p "$D/03-refute/out"

# Only run entries that have not already produced valid JSON — makes this
# resumable after an interruption instead of redoing completed work.
TODO="$(mktemp)"
# Manifest paths are relative to the REVIEW DIR ($D), not the repo root. Joining
# them to $REPO produced /…/ledrums/03-refute/… which does not exist, so every
# lane failed on its .prov redirect. Caught 45s into the run.
python3 - "$MAN" "$D" > "$TODO" <<'PY'
import json, os, sys
man, base = json.load(open(sys.argv[1])), sys.argv[2]
for m in man:
    out = os.path.join(base, m['out'])
    if os.path.exists(out) and os.path.getsize(out) > 0:
        try:
            json.load(open(out)); continue      # already done and parseable
        except Exception:
            pass                                 # truncated / not JSON -> redo
    print(m['id'])   # ID ONLY — see the xargs note in run_one
PY

N=$(wc -l < "$TODO" | tr -d ' ')
echo "refutations to run: $N  (concurrency $CONC, load ceiling $MAXLOAD)"
[ "$N" -eq 0 ] && { echo "nothing to do"; rm -f "$TODO"; exit 0; }

export D REPO MODEL MAXLOAD

run_one() {
  # ID ONLY is passed in. Paths are rebuilt here from $D, deliberately:
  # BSD/macOS `xargs -I` caps a CONSTRUCTED ARGUMENT at 255 bytes. Passing
  # id + two absolute paths per line exceeded that for the longer finding ids
  # and xargs aborted mid-run with "command line cannot be assembled, too long"
  # — after 36 of 107, silently leaving the long-named lenses undone. GNU xargs
  # has no such limit, so this only bites on macOS.
  local id="$1"
  local prompt="$D/03-refute/prompts/$id.txt"
  local out="$D/03-refute/out/$id.json"

  # Circuit breaker. Even a correct -P cap is wrong if the machine is already
  # loaded by something else. Wait it out rather than piling on.
  local waited=0
  while :; do
    load=$(uptime | sed 's/.*load averages*: *//' | awk '{print int($1)}')
    [ "${load:-0}" -lt "$MAXLOAD" ] && break
    [ "$waited" -ge 600 ] && { echo "SKIP $id (load $load stayed above $MAXLOAD for 10m)" >&2; return 0; }
    sleep 15; waited=$((waited+15))
  done

  # exit 4 = the child did not echo the nonce. Observed to be transient (a model
  # occasionally drops the trailing attestation line), so retry ONCE. Any other
  # non-zero exit is not retried — a config or proxy failure will not fix itself.
  local attempt rc
  for attempt in 1 2; do
    bash "$D/artifacts/codex-agent.sh" "$MODEL" "$prompt" Read,Grep,Glob "$REPO" "$out" \
      > "$out.prov" 2> "$out.err"
    rc=$?
    [ $rc -ne 4 ] && break
    [ $attempt -eq 1 ] && echo "retry $id (no nonce echo)" >&2
  done
  if [ $rc -eq 0 ]; then
    echo "ok   $id"
  else
    echo "FAIL $id (exit $rc): $(head -c 120 "$out.err" | tr '\n' ' ')" >&2
  fi
}
export -f run_one

# THE CAP. -P is enforced by xargs; nothing downstream can widen it.
tr '\n' '\0' < "$TODO" | xargs -0 -P "$CONC" -I{} bash -c 'run_one "$@"' _ {}

rm -f "$TODO"
echo "done. outputs: $(ls "$D"/03-refute/out/*.json 2>/dev/null | wc -l | tr -d ' ')/107"

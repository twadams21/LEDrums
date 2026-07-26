#!/usr/bin/env bash
# verify-nonce.sh — the orchestrator half of the wrapper-fidelity guard.
#
# codex-agent.sh mints a nonce at run time and appends it to a receipts ledger
# that only it writes. This script checks that a nonce relayed back by a wrapper
# actually appears in that ledger.
#
# Why both halves are needed: the nonce in the wrapper's output proves nothing on
# its own, because a wrapper that self-answered could invent 32 hex characters.
# It is the LEDGER — written out-of-band by the script itself — that makes the
# claim checkable. A fabricated nonce matches no receipt.
#
# usage: verify-nonce.sh <nonce> [expected-model-spec]
# exit:  0 valid · 1 nonce not found (LANE MUST FAIL) · 2 model mismatch · 3 usage
set -euo pipefail

RECEIPTS="${CODEX_AGENT_RECEIPTS:-$HOME/.twux/codex-agent-receipts.tsv}"
NONCE="${1:-}"
EXPECT_MODEL="${2:-}"

[ -n "$NONCE" ] || { echo "usage: verify-nonce.sh <nonce> [expected-model-spec]" >&2; exit 3; }

case "$NONCE" in
  *[!0-9a-f]* | "") echo "INVALID nonce=$NONCE reason=not-32-hex" >&2; exit 1 ;;
esac
[ ${#NONCE} -eq 32 ] || { echo "INVALID nonce=$NONCE reason=wrong-length(${#NONCE})" >&2; exit 1; }

if [ ! -r "$RECEIPTS" ]; then
  echo "INVALID nonce=$NONCE reason=no-receipts-ledger-at:$RECEIPTS" >&2
  exit 1
fi

# Exact field match on column 1 — never a substring search.
ROW="$(awk -F'\t' -v n="$NONCE" '$1 == n { print; exit }' "$RECEIPTS")"
if [ -z "$ROW" ]; then
  echo "INVALID nonce=$NONCE reason=no-matching-receipt (wrapper likely self-answered — FAIL THE LANE)" >&2
  exit 1
fi

ACTUAL_MODEL="$(printf '%s' "$ROW" | cut -f2)"
if [ -n "$EXPECT_MODEL" ] && [ "$ACTUAL_MODEL" != "$EXPECT_MODEL" ]; then
  echo "MISMATCH nonce=$NONCE expected=$EXPECT_MODEL actual=$ACTUAL_MODEL" >&2
  exit 2
fi

echo "VALID nonce=$NONCE model=$ACTUAL_MODEL issued=$(printf '%s' "$ROW" | cut -f3)"
exit 0

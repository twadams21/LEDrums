#!/usr/bin/env bash
# verify-nonce.sh — the orchestrator half of the wrapper-fidelity guard.
#
# codex-agent.sh mints a nonce, injects it into the child's prompt, requires the
# child to echo it, and only then writes a receipt. This script validates a
# relayed nonce against that ledger and CONSUMES it.
#
# Consumption is the anti-replay property. Membership alone is forever-valid, so
# a wrapper could relay a nonce harvested from an earlier run and pass. Consuming
# makes each receipt usable exactly once; a second attempt fails. `mkdir` is the
# atomic acquire, so two concurrent verifications cannot both succeed.
#
# usage: verify-nonce.sh <nonce> [expected-model-spec] [expected-prompt-sha]
# exit:  0 valid+consumed · 1 no receipt (FAIL THE LANE) · 2 model mismatch
#        · 3 usage · 4 replay (already consumed) · 5 prompt mismatch
set -euo pipefail

RECEIPTS="${CODEX_AGENT_RECEIPTS:-$HOME/.twux/codex-agent-receipts.tsv}"
CONSUMED="${CODEX_AGENT_CONSUMED:-$HOME/.twux/codex-agent-consumed}"
NONCE="${1:-}"
EXPECT_MODEL="${2:-}"
EXPECT_SHA="${3:-}"

[ -n "$NONCE" ] || { echo "usage: verify-nonce.sh <nonce> [expected-model] [expected-prompt-sha]" >&2; exit 3; }

case "$NONCE" in *[!0-9a-f]* | "") echo "INVALID nonce=$NONCE reason=not-hex" >&2; exit 1 ;; esac
[ ${#NONCE} -eq 32 ] || { echo "INVALID nonce=$NONCE reason=wrong-length(${#NONCE})" >&2; exit 1; }

[ -r "$RECEIPTS" ] || { echo "INVALID nonce=$NONCE reason=no-receipts-ledger-at:$RECEIPTS" >&2; exit 1; }

ROW="$(awk -F'\t' -v n="$NONCE" '$1 == n { print; exit }' "$RECEIPTS")"
if [ -z "$ROW" ]; then
  echo "INVALID nonce=$NONCE reason=no-matching-receipt (wrapper self-answered or fabricated — FAIL THE LANE)" >&2
  exit 1
fi

ACTUAL_MODEL="$(printf '%s' "$ROW" | cut -f2)"
ACTUAL_SHA="$(printf '%s' "$ROW" | cut -f3)"

if [ -n "$EXPECT_MODEL" ] && [ "$ACTUAL_MODEL" != "$EXPECT_MODEL" ]; then
  echo "MISMATCH nonce=$NONCE expected_model=$EXPECT_MODEL actual=$ACTUAL_MODEL" >&2
  exit 2
fi
if [ -n "$EXPECT_SHA" ] && [ "$ACTUAL_SHA" != "$EXPECT_SHA" ]; then
  echo "MISMATCH nonce=$NONCE expected_prompt_sha=$EXPECT_SHA actual=$ACTUAL_SHA" >&2
  exit 5
fi

# Atomic single-use acquire. mkdir succeeds for exactly one caller.
mkdir -p "$CONSUMED" 2>/dev/null || true
if ! mkdir "$CONSUMED/$NONCE" 2>/dev/null; then
  echo "REPLAY nonce=$NONCE reason=already-consumed (a valid nonce may be used once — FAIL THE LANE)" >&2
  exit 4
fi

echo "VALID nonce=$NONCE model=$ACTUAL_MODEL prompt_sha=${ACTUAL_SHA:0:12}… issued=$(printf '%s' "$ROW" | cut -f4) consumed=now"
exit 0

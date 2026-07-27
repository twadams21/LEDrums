#!/usr/bin/env bash
# codex-agent.sh — run a prompt through a CLIProxyAPI (codex) model from a NATIVE
# Claude session. The primitive that lets an Opus-5-driven dynamic Workflow
# contain codex agents.
#
# THE FAILURE MODE THIS GUARDS
# ----------------------------
# A Workflow agent() call cannot reach a codex model, so a cheap native subagent
# ("the wrapper") shells out to this script and relays the result. The wrapper's
# failure mode is silent: it can answer the task itself and return a confident,
# well-formed result from the WRONG model. A prompt line saying "you are a
# launcher, not a solver" is a request, not a mitigation.
#
# THREE PROPERTIES ARE NEEDED, AND EARLIER VERSIONS HAD ONLY THE FIRST
#   1. Proof the script ran        -> runtime nonce
#   2. Proof THIS CHILD produced THIS OUTPUT
#        A nonce the script prints itself proves only that the script was
#        invoked. A wrapper could run it, harvest a valid nonce, discard the
#        child's answer and substitute its own. So the nonce is INJECTED INTO
#        THE CHILD'S PROMPT and the child must echo it; if the echo is missing
#        the run fails and no provenance is emitted.
#   3. Non-replayability
#        Membership in a receipts ledger is forever-valid, so an old nonce would
#        keep passing. Receipts are therefore SINGLE-USE: verify-nonce.sh
#        atomically consumes one, and a second attempt fails.
# The receipt also carries a SHA-256 of the prompt, binding a nonce to the
# specific request it was minted for.
#
# Reads base_url/token from ~/.twux/proxy.json. The token is never echoed.
# Mirrors twux lib/models.sh codex_env_prefix() + model_boot_arg().
#
# usage: codex-agent.sh '<model(effort)>' <prompt-file> [allowed-tools] [cwd] [out-file]
#
# WITH out-file (strongly preferred): the child's output is written THERE and
# stdout carries ONLY the provenance line. The wrapper relays nonce + path; the
# orchestrator reads the file itself. This closes the last hole in the guard:
# with the body on stdout, a wrapper could run the script correctly, obtain a
# genuinely valid nonce, and STILL relay a body of its own invention. The nonce
# proved the child ran; it did not prove the child's words survived the relay.
# Taking the body out of the wrapper's hands is what proves that.
#
# stdout on success: provenance line, blank line, child output with the echo line stripped:
#   CODEX-PROVENANCE nonce=<hex32> model=<spec> prompt_sha=<hex64> exit=<code>
#
# exit: 0 ok · 2 config/usage · 3 no child output · 4 child did not echo the nonce
set -euo pipefail

CONF="${TWUX_PROXY_CONF:-$HOME/.twux/proxy.json}"
MODEL="${1:?usage: codex-agent.sh '<model(effort)>' <prompt-file> [allowed-tools] [cwd]}"
PROMPT_FILE="${2:?prompt file required}"
TOOLS="${3:-Read,Grep,Glob}"
WORKDIR="${4:-$PWD}"
OUTFILE="${5:-}"

[ -r "$CONF" ]        || { echo "codex-agent: no readable proxy config at $CONF" >&2; exit 2; }
[ -r "$PROMPT_FILE" ] || { echo "codex-agent: no readable prompt file at $PROMPT_FILE" >&2; exit 2; }
[ -d "$WORKDIR" ]     || { echo "codex-agent: no such cwd: $WORKDIR" >&2; exit 2; }

NONCE="$(od -An -tx1 -N16 /dev/urandom | tr -d ' \n')"
[ ${#NONCE} -eq 32 ] || { echo "codex-agent: nonce generation failed" >&2; exit 2; }

# Read the prompt BEFORE cd — a relative path would not resolve afterwards, and
# the resulting failure is near-silent (claude exits 1 while provenance prints).
PROMPT_TEXT="$(cat "$PROMPT_FILE")"
[ -n "${PROMPT_TEXT//[[:space:]]/}" ] || { echo "codex-agent: prompt file is empty: $PROMPT_FILE" >&2; exit 2; }
PROMPT_SHA="$(printf '%s' "$PROMPT_TEXT" | shasum -a 256 | cut -d' ' -f1)"

# Property 2: the child must prove it saw this nonce.
ATTEST_PROMPT="$PROMPT_TEXT

---
ATTESTATION (required): the final line of your reply must be exactly:
NONCE-ECHO $NONCE
Reply with your answer first, then that line. Do not omit it, alter it, or explain it."

read_conf() {
  python3 -c '
import json, sys
d = json.load(open(sys.argv[1]))
print(d["base_url"].rstrip("/"))
print(d.get("token") or "")
print(d.get("small_fast_model") or "gpt-5.4-mini")
' "$CONF"
}
{ read -r BU; read -r TK; read -r SF; } < <(read_conf)
[ -n "$BU" ] || { echo "codex-agent: proxy config has no base_url" >&2; exit 2; }

cd "$WORKDIR"

set +e
OUT="$(
  ANTHROPIC_BASE_URL="$BU" \
  ANTHROPIC_AUTH_TOKEN="$TK" \
  ANTHROPIC_SMALL_FAST_MODEL="$SF" \
  ANTHROPIC_DEFAULT_OPUS_MODEL="${TWUX_CODEX_TIER_OPUS:-gpt-5.6-sol}" \
  ANTHROPIC_DEFAULT_SONNET_MODEL="${TWUX_CODEX_TIER_SONNET:-gpt-5.5}" \
  ANTHROPIC_DEFAULT_HAIKU_MODEL="${TWUX_CODEX_TIER_HAIKU:-gpt-5.4-mini}" \
  ANTHROPIC_DEFAULT_FABLE_MODEL="${TWUX_CODEX_TIER_FABLE:-gpt-5.4-mini}" \
  claude --model "$MODEL" --allowedTools "$TOOLS" -p "$ATTEST_PROMPT" < /dev/null 2>&1
)"
RC=$?
set -e

if [ -z "${OUT//[[:space:]]/}" ]; then
  echo "codex-agent: child produced no output (exit $RC) — NO PROVENANCE EMITTED" >&2
  exit 3
fi

# Property 2 enforced: no echo, no provenance, no receipt. A wrapper that
# substituted its own answer cannot produce this line.
if ! printf '%s' "$OUT" | grep -qF "NONCE-ECHO $NONCE"; then
  echo "codex-agent: child did not echo the nonce — output NOT attested (exit $RC)" >&2
  echo "codex-agent: refusing to emit provenance; treat this lane as FAILED" >&2
  exit 4
fi

# Receipt is written only for an attested run.
RECEIPTS="${CODEX_AGENT_RECEIPTS:-$HOME/.twux/codex-agent-receipts.tsv}"
mkdir -p "$(dirname "$RECEIPTS")" 2>/dev/null || true
printf '%s\t%s\t%s\t%s\t%s\n' \
  "$NONCE" "$MODEL" "$PROMPT_SHA" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$$" >> "$RECEIPTS"

if [ -n "$OUTFILE" ]; then
  mkdir -p "$(dirname "$OUTFILE")" 2>/dev/null || true
  # Strip the nonce echo AND the CLI's own stderr banners. We capture 2>&1 to
  # keep real errors, but that also drags in the "claude.ai connectors are
  # disabled" warning and the stdin-timeout notice, which prepend non-JSON to
  # the child's answer and make every output file unparseable. Observed on the
  # first real run: 0 of 16 output files were valid JSON.
  printf '%s\n' "$OUT" \
    | grep -vF "NONCE-ECHO $NONCE" \
    | grep -v '^⚠' \
    | grep -v '^Warning: no stdin data received' \
    > "$OUTFILE"
  printf 'CODEX-PROVENANCE nonce=%s model=%s prompt_sha=%s exit=%s out=%s bytes=%s\n' \
    "$NONCE" "$MODEL" "$PROMPT_SHA" "$RC" "$OUTFILE" "$(wc -c < "$OUTFILE" | tr -d ' ')"
else
  printf 'CODEX-PROVENANCE nonce=%s model=%s prompt_sha=%s exit=%s\n\n' \
    "$NONCE" "$MODEL" "$PROMPT_SHA" "$RC"
  printf '%s\n' "$OUT" | grep -vF "NONCE-ECHO $NONCE"
fi
exit "$RC"

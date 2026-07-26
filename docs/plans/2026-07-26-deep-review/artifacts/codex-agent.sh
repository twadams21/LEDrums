#!/usr/bin/env bash
# codex-agent.sh — run a prompt through a CLIProxyAPI (codex) model from a NATIVE
# Claude session. This is the primitive that lets an Opus-5-driven dynamic
# Workflow contain codex agents.
#
# THE FAILURE MODE THIS GUARDS
# ----------------------------
# A Workflow agent() call cannot reach a codex model directly, so a cheap native
# subagent ("the wrapper") shells out to this script and relays the result. The
# wrapper's failure mode is silent: instead of launching the subprocess, it can
# answer the task itself and return a confident, well-formed, plausible result
# from the WRONG model. A prompt line saying "you are a launcher, not a solver"
# is not a mitigation for that — it is a request.
#
# So this script mints a NONCE at run time and requires it back. The wrapper must
# return the provenance line verbatim. A wrapper that self-answered cannot
# produce the nonce, because it did not exist until this script ran. The workflow
# validates it and FAILS THE LANE on mismatch — fail-closed, not prompt-dependent.
#
# Reads base_url/token from ~/.twux/proxy.json. The token is never echoed.
# Mirrors twux lib/models.sh codex_env_prefix() + model_boot_arg().
#
# usage: codex-agent.sh '<model(effort)>' <prompt-file> [allowed-tools] [cwd]
#
# stdout: provenance line, blank line, then the child's verbatim output:
#   CODEX-PROVENANCE nonce=<hex32> model=<spec> exit=<code>
#
# exit: 0 success · 2 config/usage error · 3 child produced no output
set -euo pipefail

CONF="${TWUX_PROXY_CONF:-$HOME/.twux/proxy.json}"
MODEL="${1:?usage: codex-agent.sh '<model(effort)>' <prompt-file> [allowed-tools] [cwd]}"
PROMPT_FILE="${2:?prompt file required}"
TOOLS="${3:-Read,Grep,Glob}"
WORKDIR="${4:-$PWD}"

[ -r "$CONF" ]        || { echo "codex-agent: no readable proxy config at $CONF" >&2; exit 2; }
[ -r "$PROMPT_FILE" ] || { echo "codex-agent: no readable prompt file at $PROMPT_FILE" >&2; exit 2; }
[ -d "$WORKDIR" ]     || { echo "codex-agent: no such cwd: $WORKDIR" >&2; exit 2; }

# The nonce. Generated HERE, at run time, from the kernel CSPRNG — not derivable
# from the prompt, the model spec, or anything the wrapper can see beforehand.
NONCE="$(od -An -tx1 -N16 /dev/urandom | tr -d ' \n')"
[ ${#NONCE} -eq 32 ] || { echo "codex-agent: nonce generation failed" >&2; exit 2; }

# The nonce alone is not sufficient: a wrapper that never ran this script could
# still invent 32 hex characters. So the nonce is also written OUT-OF-BAND to a
# receipts ledger that only this script appends to. The orchestrator validates a
# returned nonce by checking it against the ledger — a fabricated nonce matches
# no receipt. That is what makes the check fail-closed rather than decorative.
RECEIPTS="${CODEX_AGENT_RECEIPTS:-$HOME/.twux/codex-agent-receipts.tsv}"
mkdir -p "$(dirname "$RECEIPTS")" 2>/dev/null || true
printf '%s\t%s\t%s\t%s\n' "$NONCE" "$MODEL" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$$" >> "$RECEIPTS"

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

# Read the prompt BEFORE changing directory. A relative $PROMPT_FILE would not
# resolve after the cd, and the resulting failure is silent-ish: claude exits 1
# with "Input must be provided" while the provenance line still prints. Caught
# by testing this script rather than by asserting it worked.
PROMPT_TEXT="$(cat "$PROMPT_FILE")"
[ -n "${PROMPT_TEXT//[[:space:]]/}" ] || { echo "codex-agent: prompt file is empty: $PROMPT_FILE" >&2; exit 2; }

cd "$WORKDIR"

# Tier map mirrors twux: an alias-pinned subagent inside this codex worker must
# resolve to a model the proxy actually serves, or it 502s non-transiently.
set +e
OUT="$(
  ANTHROPIC_BASE_URL="$BU" \
  ANTHROPIC_AUTH_TOKEN="$TK" \
  ANTHROPIC_SMALL_FAST_MODEL="$SF" \
  ANTHROPIC_DEFAULT_OPUS_MODEL="${TWUX_CODEX_TIER_OPUS:-gpt-5.6-sol}" \
  ANTHROPIC_DEFAULT_SONNET_MODEL="${TWUX_CODEX_TIER_SONNET:-gpt-5.5}" \
  ANTHROPIC_DEFAULT_HAIKU_MODEL="${TWUX_CODEX_TIER_HAIKU:-gpt-5.4-mini}" \
  ANTHROPIC_DEFAULT_FABLE_MODEL="${TWUX_CODEX_TIER_FABLE:-gpt-5.4-mini}" \
  claude --model "$MODEL" --allowedTools "$TOOLS" -p "$PROMPT_TEXT" < /dev/null 2>&1
)"
RC=$?
set -e

# No output at all means the child never ran or died before speaking. Surface it
# as a distinct failure rather than emitting a provenance line for nothing.
if [ -z "${OUT//[[:space:]]/}" ]; then
  echo "CODEX-PROVENANCE nonce=$NONCE model=$MODEL exit=$RC" >&2
  echo "codex-agent: child produced no output (exit $RC)" >&2
  exit 3
fi

printf 'CODEX-PROVENANCE nonce=%s model=%s exit=%s\n\n' "$NONCE" "$MODEL" "$RC"
printf '%s\n' "$OUT"
exit "$RC"

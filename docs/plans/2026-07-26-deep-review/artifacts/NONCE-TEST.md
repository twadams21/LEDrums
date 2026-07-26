# Wrapper-fidelity guard — test record

Run 2026-07-26 on `feat/ota-discord-announce` @ `ed07b29`. Verbatim output.

## What is being proven

A Workflow `agent()` call cannot reach a codex model, so a native Opus-low wrapper shells out
to `codex-agent.sh`. The wrapper's failure mode is **silent**: it can answer the task itself
and return a confident result from the wrong model. The guard has two halves, and neither
works alone:

1. `codex-agent.sh` mints a nonce at run time and prints it in a provenance line.
2. It also appends that nonce **out-of-band** to a receipts ledger only it writes.
   `verify-nonce.sh` checks a returned nonce against that ledger.

Half 1 alone is decorative — a wrapper could invent 32 hex characters. It is half 2 that makes
the claim checkable.

## Test 1 — happy path

```
$ OUT="$(bash codex-agent.sh 'gpt-5.6-luna(low)' "$PWD/nonce-test-prompt.txt" Read,Grep,Glob <repo>)"
child said: NONCE-TEST-OK
nonce: cd6228ee2d763347ad945ca010fd8e2f

$ bash verify-nonce.sh cd6228ee2d763347ad945ca010fd8e2f 'gpt-5.6-luna(low)'
VALID nonce=cd6228ee2d763347ad945ca010fd8e2f model=gpt-5.6-luna(low) issued=2026-07-26T11:08:08Z
exit=0
```

## Test 2 — fabricated nonce (the wrapper self-answer case)

```
$ bash verify-nonce.sh deadbeefdeadbeefdeadbeefdeadbeef
INVALID nonce=deadbeefdeadbeefdeadbeefdeadbeef reason=no-matching-receipt (wrapper likely self-answered — FAIL THE LANE)
exit=1
```

## Test 3 — real nonce, wrong expected model

```
$ bash verify-nonce.sh cd6228ee2d763347ad945ca010fd8e2f 'gpt-5.6-sol(high)'
MISMATCH nonce=cd6228ee2d763347ad945ca010fd8e2f expected=gpt-5.6-sol(high) actual=gpt-5.6-luna(low)
exit=2
```

## Nonce uniqueness

Four consecutive runs produced `1d673f62…`, `81936d95…`, `746f791f…`, `08483a18…`,
`cd6228ee…` — distinct every time, 16 bytes from `/dev/urandom`.

## A real bug this testing caught

The first version of `codex-agent.sh` ran `cd "$WORKDIR"` **before** `cat "$PROMPT_FILE"`, so a
relative prompt path failed to resolve after the `cd`. The failure was near-silent: `claude`
exited 1 with *"Input must be provided either through stdin or as a prompt argument"*, while
the provenance line still printed. A caller checking only for a provenance line would have
recorded a successful lane that produced nothing.

Fixed by reading the prompt into a variable before changing directory. This is the reason the
spec requires the guard to be *demonstrated* rather than *described*: v2 of the spec asserted
the nonce mitigation existed when no implementation did.

## Known limitation

The ledger is append-only and never pruned. It grows unbounded across runs. Not a correctness
problem — `verify-nonce.sh` does an exact field match, and nonce collision at 128 bits is not a
practical concern — but it should be rotated if this outlives the initiative.

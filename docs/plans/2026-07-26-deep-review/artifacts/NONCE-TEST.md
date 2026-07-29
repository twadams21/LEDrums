# Wrapper-fidelity guard — test record

Run 2026-07-26 against `codex-agent.sh` + `verify-nonce.sh` at commit `e59e99c`.
**Single clean run**, ledger truncated first. Verbatim output.

> The previous version of this file listed five nonces as a "verbatim record" while the
> receipts ledger held one — the earlier runs predated the ledger code. A reviewer caught it.
> This record is one session, start to finish.

## What must be true, and why one property is not enough

| Property | Mechanism | Attack it stops |
|---|---|---|
| 1. The script ran | runtime nonce from `/dev/urandom` | wrapper invents a provenance line |
| 2. **This child produced this output** | nonce injected into the child's prompt; child must echo it; no echo ⇒ no provenance, no receipt | wrapper runs the script, harvests a valid nonce, then substitutes its **own** answer |
| 3. Not replayable | receipts are single-use; `verify-nonce.sh` consumes atomically via `mkdir` | wrapper relays a nonce harvested from an earlier run |
| 4. Bound to the request | receipt carries `sha256(prompt)` | valid nonce reused against a different prompt |

v3 had only property 1, which is why both reviewers called the guard decorative. Properties
2–4 are what make it fail-closed.

## T1 — happy path

```
CODEX-PROVENANCE nonce=5785bcf13b147827b8d39da58685719b model=gpt-5.6-luna(low) prompt_sha=923a8d6103b6c874fc33c0bc13b9ff9653c70a1feb208fe5ea1705a6456cd627 exit=0
ATTEST-OK
```

The `NONCE-ECHO` line the child emitted is stripped from relayed output: `0` occurrences
downstream. The child attests; the caller never has to see the plumbing.

## T2 — verify, with model and prompt binding

```
$ verify-nonce.sh 5785bcf1… 'gpt-5.6-luna(low)' 923a8d61…
VALID nonce=5785bcf13b147827b8d39da58685719b model=gpt-5.6-luna(low) prompt_sha=923a8d6103b6… issued=2026-07-26T11:28:07Z consumed=now
exit=0
```

## T3 — replay the same nonce

```
$ verify-nonce.sh 5785bcf1…
REPLAY nonce=5785bcf13b147827b8d39da58685719b reason=already-consumed (a valid nonce may be used once — FAIL THE LANE)
exit=4
```

## T4 — fabricated nonce

```
$ verify-nonce.sh cafebabecafebabecafebabecafebabe
INVALID nonce=cafebabecafebabecafebabecafebabe reason=no-matching-receipt (wrapper self-answered or fabricated — FAIL THE LANE)
exit=1
```

## T5 — real nonce, wrong prompt

```
$ verify-nonce.sh 7cc47708… '' <sha of a different prompt>
MISMATCH nonce=7cc477089f96fcecd1f237ac9dfe00ed expected_prompt_sha=17f21f0a… actual=923a8d61…
exit=5
```

## Ledger after the run

```
5785bcf13b147827b8d39da58685719b	gpt-5.6-luna(low)	923a8d61…
7cc477089f96fcecd1f237ac9dfe00ed	gpt-5.6-luna(low)	923a8d61…
```

Two runs, two receipts, no orphans. Every nonce in this document is either in the ledger or is
the deliberately fabricated one from T4.

## Not covered

- **exit 4 (child fails to echo) is not exercised here.** The code path is a single `grep -qF`
  guard, but forcing a compliant model to omit a trailing line is unreliable to test, so it
  rests on inspection rather than demonstration. Stated rather than glossed.
- The ledger is append-only and never pruned. Not a correctness issue — `verify-nonce.sh` does
  an exact field match and 128-bit collision is not a practical concern — but it should be
  rotated if this outlives the initiative.

## A bug this testing caught

The first version ran `cd "$WORKDIR"` **before** `cat "$PROMPT_FILE"`, so relative prompt paths
failed to resolve. Near-silent: `claude` exited 1 with *"Input must be provided"* while the
provenance line still printed, so a caller checking only for provenance would have recorded a
successful lane that produced nothing. Fixed by reading the prompt before the `cd`.

Three rounds of adversarial *reading* did not find this. Running it found it immediately.

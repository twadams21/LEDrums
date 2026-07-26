# Pilot — Phase 0 + Phase 2 on `packages/io`

**Baseline:** `e59e99c` on `feat/ota-discord-announce` · 2026-07-26
**Scope:** `packages/io` — 1,402 source LOC, 14 files, 24 files including tests
**Purpose:** test the spec by running it, after three review rounds failed to converge on reading alone.

---

## Tool versions (pinned, installed as root devDependencies)

| Tool | Version | Verdict from this pilot |
|---|---|---|
| `knip` | 6.29.0 | ✅ **keep** — workspace-aware, 1 finding, correct |
| `ts-prune` | 0.10.3 | ❌ **drop** — 20 findings, all false positives |
| `depcheck` | 1.4.7 | keep (not exercised on this package) |
| `madge` | 8.0.0 | ✅ keep — cycle check clean |
| `jscpd` | 5.0.12 | ✅ keep — 0 clones at ≥12 lines |
| `ajv-cli` | 5.0.0 | ✅ keep — schema validation |

The spec previously specified acquisition via pinned `pnpm dlx`. Installing as root
devDependencies is strictly better: the version is recorded in `package.json` and the lockfile
rather than resolved per-invocation.

## Result 1 — `ts-prune` must be dropped

This is the pilot's most valuable output and no amount of reviewing would have produced it.

```
$ ts-prune -p packages/io/tsconfig.json
packages/io/src/index.ts:3  - PixelOutput
packages/io/src/index.ts:11 - OscArg
packages/io/src/index.ts:13 - OscEvent
… 20 entries, every one a barrel re-export from index.ts
```

`ts-prune` does not understand that `index.ts` is the package's public entry point, so it flags
**every public export of the package** as unused. On a 1,402-LOC package that is ~20 false
positives.

```
$ knip --workspace packages/io --include files,exports,types,dependencies
Unused exports (1)
parseStatistic  function  packages/io/src/pixlite/protocol.ts:147:17
```

`knip` is workspace-aware, reads the entry points, and reports **one** finding — which is
correct.

**Why this matters at scale.** The spec's premise is that tooling gives high-signal findings
"deterministically", and that agents interpret tool output rather than re-derive it. With
`ts-prune` in the toolchain that premise inverts: ~20 false positives per 1,400 LOC extrapolates
to roughly **1,000 across 70k LOC**, each consuming 1–3 Opus-high refuters. `REFUTER_BUDGET = 90`
would be exhausted entirely on tool noise before a single real finding was verified.

Fable predicted a "knip false-positive flood" in round 1's coverage gaps and flagged it as
argued-not-demonstrated. It was the right instinct pointed at the wrong tool.

**Action:** remove `ts-prune` from Phase 0. `knip` subsumes it.

## Result 2 — the first real finding, and it validates the objective function

`pilot/02-findings/dead-code.json`, validated against both `collection.schema.json` and
`finding.schema.json`.

`parseStatistic` at `packages/io/src/pixlite/protocol.ts:147` is exported, but the only caller
is `parseStatisticResponse` at line 182 **in the same file**. The barrel re-exports it via
`export * from './pixlite'`, so it is part of the package's public interface with no consumer.

The nuance is the point:

> **This is not deletable code.** Deleting `parseStatistic` breaks `parseStatisticResponse`.
> The correct fix is to remove the `export` keyword — one line, zero behaviour change,
> **interface reduced by one symbol**.

A pipeline optimising for lines deleted scores this at 0 and might well try to delete the
function. A pipeline optimising for *interface reduction* scores it correctly and produces a
safe one-line fix. The objective function chosen in response to round 1's critical finding is
doing exactly the work it was introduced to do, on the very first real finding.

`interface_delta: {removed: 1, added: 0, net: "reduces"}` · `removes_failure_path: false` ·
`fix_size_loc: 1` → 1 refuter, mechanical, mutation-verifiable.

## Result 3 — clean signals

- `jscpd` at ≥12 lines / ≥90% similarity: **0 clones in 22 files.** The duplication threshold
  chosen in v3 produces no noise on this package.
- `madge --circular`: **no cycles** across 24 files.
- `packages/core` purity is unaffected here but the same `madge` invocation is what will check it.

## What the pilot cost

Minutes, and no agent tokens — Phase 0 is pure tooling and the single finding was assembled by
the orchestrator. A fourth review round would have cost two high-effort agents and produced
opinions about `ts-prune` rather than the twenty false positives themselves.

## Carried into the spec

1. Drop `ts-prune`; `knip` is the dead-code tool.
2. Phase 0 gains a **tool-calibration gate**: run each tool on `packages/io` first and measure
   its false-positive rate against manual inspection. A tool whose precision is below a
   threshold does not proceed to the full sweep. `ts-prune` would have failed this gate at 0%.
3. Tools are root devDependencies, versions in the lockfile — not `pnpm dlx`.
4. The finding schema survived contact with a real finding without amendment.

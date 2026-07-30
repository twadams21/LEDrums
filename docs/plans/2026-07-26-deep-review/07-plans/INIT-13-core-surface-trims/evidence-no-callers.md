# INIT-13 — no-caller proof and measured baselines

**Frozen at HEAD `9994ec5`** (branch `init/13-core-trims`, based on `origin/review/impl`).

Why this file exists: a deleted zero-caller export has no test that can go red. The
suite would stay green whether or not the deletion was correct. This machine output
*is* the evidence the deletion commits cite.

**Read this caveat first:** the automated dead-code tool does **not** back this
finding. Knip reports zero unused exports in `packages/core` (measured below,
section f) because the package's `exports` field makes `src/index.ts` an entry
point, so every barrel-reachable name reads as public API. The dead-code claim
rests on the exhaustive grep (a), the dynamic-access scan (b), the
`private: true` + no-deep-imports proof (c), and the whole-workspace typecheck.
That is sufficient for a closed workspace, but it is a weaker class of evidence
than a tool-confirmed finding and should be read that way.

## Baselines (re-measured at THIS head — plan figures were stale)

| Name | Value | Plan's figure (at `8b5af91`) |
| --- | --- | --- |
| `TOP_BASE` (top-level `@ledrums/core` keys) | **155** | 159 — stale |
| `VOICE_BASE` (`m.voice` keys) | **64** | 64 — holds |
| `BASELINE_TESTS` (whole suite) | **3405** | 2968 — stale |
| `BASELINE_TESTS` (packages/core, the load-bearing one) | **855** | — |

Expected after the full trim: **TOP 154 / VOICE 63**, tests unchanged at 3405.
The plan's `159 → 158` / `64 → 63` deltas hold in *shape*; only the top-level
absolute base moved, because merges landed between `8b5af91` and this head.

### Line anchors re-verified at this head (INIT-06 drift)

| Symbol | Plan's anchor | **Actual at `9994ec5`** |
| --- | --- | --- |
| `nearestPixelWithin` | pixel-grid.ts 127–136 | 127–136 (unchanged) |
| `listCanvasScenes` | registry.ts 33–35 | 33–35 (unchanged) |
| `assertTriggerGraphIntegrity` | graph-integrity.ts 218–223 | **243–248** (moved +25 by INIT-06) |

## (a) LITERAL SCAN — exactly nine hits, all accounted for

```
$ rg -n 'nearestPixelWithin|assertTriggerGraphIntegrity|listCanvasScenes' \
     -g '!node_modules' -g '!dist' -g '!docs/plans/2026-07-26-deep-review'
docs/reports/2026-07-05-elv2-u5-report.md:111:  2. or extend `store.canvasEffects` to also project `listCanvasScenes()` (core registry) built-ins.
docs/plans/2026-07-08-gen3-graph-authoring-stabilisation-prd.md:104:export function assertTriggerGraphIntegrity(graph: TriggerGraph): void;
packages/core/src/geometry/pixel-grid.test.ts:4:import { buildPixelGrid, forEachPixelWithin, nearestPixelWithin } from './pixel-grid';
packages/core/src/geometry/pixel-grid.test.ts:80:  it('nearestPixelWithin matches the brute-force nearest scan (confetti equivalence)', () => {
packages/core/src/geometry/pixel-grid.test.ts:84:      const hit = nearestPixelWithin(grid, pt, reach);
packages/core/src/geometry/pixel-grid.test.ts:129:    expect(nearestPixelWithin(g, { x: 0, y: 0, z: 0 }, 100)).toBeNull();
packages/core/src/geometry/pixel-grid.ts:128:export function nearestPixelWithin(
packages/core/src/canvas/registry.ts:33:export function listCanvasScenes(): CanvasScene[] {
packages/core/src/voice/graph-integrity.ts:243:export function assertTriggerGraphIntegrity(graph: TriggerGraph): void {
exit=0
```

Nine hits, matching the plan's expected list exactly (including the `it(...)`
title-string hit at `:80`, which the original opus plan omitted and which would
have fired a spurious ABORT). The only difference from the plan is the
graph-integrity line number, explained by the INIT-06 anchor drift above.

Two of the nine are **prose in dated documents**, deliberately not edited:
`docs/reports/2026-07-05-elv2-u5-report.md:111` records `listCanvasScenes` only
as a *rejected alternative* — a historical record, not live documentation — and
`docs/plans/2026-07-08-gen3-graph-authoring-stabilisation-prd.md:104` is the PRD
signature discussed under S4 below.

Every remaining hit is either the definition itself or lives in
`pixel-grid.test.ts`, whose four references S2 removes before S3 deletes the
function. **Zero production callers for all three symbols.**

## (b) DYNAMIC-ACCESS SCAN — the ABORT gate, proven non-vacuous

A string-keyed lookup on an imported namespace object evades both `tsc` and the
suite silently. One quote-class covers `obj['x']`, `obj["x"]`, `` obj[`x`] `` and
string-keyed map lookups in a single pass. Written fully single-quoted with
`\x27` for the quote character so no shell layer can mangle it:

```
$ rg -n '["\x27`](nearestPixelWithin|assertTriggerGraphIntegrity|listCanvasScenes)["\x27`]' \
     -g '!node_modules' -g '!docs'
exit=1      # no output
```

**Control run — a guard never seen to fire is indistinguishable from a broken one.**
Against a synthetic file containing bracket access in all three quote forms:

```
$ cat control.ts
const m: any = {};
m['listCanvasScenes']();
m[`assertTriggerGraphIntegrity`]();
m["nearestPixelWithin"]();

$ rg -n '["\x27`](nearestPixelWithin|assertTriggerGraphIntegrity|listCanvasScenes)["\x27`]' control.ts
2:m['listCanvasScenes']();
3:m[`assertTriggerGraphIntegrity`]();
4:m["nearestPixelWithin"]();
exit=0
```

The gate fires on all three quote forms. Its silence at HEAD is therefore
evidence, not an artefact.

## (c) NO EXTERNAL CONSUMER

```
$ rg -n '"private"' packages/core/package.json
4:  "private": true,
```

Deep-import scan — **one deviation from the plan's "returns nothing" expectation,
and it is benign**:

```
$ rg -n '@ledrums/core/' apps packages -g '!node_modules'
packages/core/src/test-fixtures.ts:2: * TEST-ONLY entry point (`@ledrums/core/test-fixtures`) — a second ENTRY POINT, not a second
packages/core/src/voice/index.ts:25:// `@ledrums/core/test-fixtures` (packages/core/src/test-fixtures.ts). Do not re-add them here.
apps/web/src/lib/trigger-lab/store/hydrate.envmap.test.ts:7:import { MODULATION_PARITY_CASES, PARITY_PHASES, legacyEnvValue } from '@ledrums/core/test-fixtures';
```

These are a declared second **entry point** (`@ledrums/core/test-fixtures`), not
deep paths into `src/` internals bypassing the barrel — which is what the check
exists to rule out. Two hits are comments; the one real import pulls
`MODULATION_PARITY_CASES` / `PARITY_PHASES` / `legacyEnvValue`, none of them a
target symbol (confirmed by scan (a), which returns no `test-fixtures.ts` hit).
The proof the check was after — no consumer can reach these three symbols by a
path the barrel scan missed — stands.

## (d) RUNTIME SURFACE BASELINE

```
$ pnpm --filter @ledrums/server exec tsx -e \
    "import('@ledrums/core').then(m=>{console.log('TOP',Object.keys(m).length);console.log('VOICE',Object.keys(m.voice).length)})"
TOP 155
VOICE 64
```

This is the only check that **positively measures** the interface reduction
rather than merely failing to contradict it. Per-step expectations:

- **S2** (test rewrite): 155 / 64 unchanged — a test-only change cannot move the surface.
- **S3** (`nearestPixelWithin`): 155 / 64 **unchanged** — `pixel-grid` is not barrel-exported, so a change here would mean the deletion hit the wrong thing.
- **S4** (`assertTriggerGraphIntegrity`): VOICE 64 → **63**, TOP unchanged.
- **S5** (`listCanvasScenes`): TOP 155 → **154**, VOICE unchanged.

## (e) TEST BASELINE

`pnpm gates` at HEAD `9994ec5`:

| Package | Test files | Tests |
| --- | --- | --- |
| packages/core | 68 | **855** |
| apps/web | 161 | 1746 |
| apps/server | 45 | 598 |
| packages/io | 15 | 102 |
| apps/desktop | — | 36 |
| workers/error-ingest | 4 | 35 |
| packages/protocol | 3 | 33 |
| **BASELINE_TESTS** | | **3405** |

`apps/web typecheck: COMPLETED 2522 FILES 0 ERRORS 0 WARNINGS`.

### Pre-existing baseline flake (NOT caused by this lane)

Recorded so later runs are not misread. At this head, **before any change in this
lane**, `pnpm gates` is intermittently exit-1 while every test passes:

```
apps/web test:  Test Files  161 passed (161)
apps/web test:       Tests  1746 passed (1746)
apps/web test:      Errors  1 error
```

The error is a `bits-ui` scroll-lock timer firing after the test environment is
torn down (`bits-ui/dist/internal/body-scroll-lock.svelte.js:231`), surfacing
through `src/lib/app/chrome/ShowBrowser.test.ts`. Characterised:

- First `pnpm gates` run at this head: green (`Done`).
- Second run: 1746/1746 passed, `Errors 1 error`, exit 1.
- `ShowBrowser.test.ts` in isolation: **3/3 runs clean, exit 0**.

So it is a timing flake under full-suite parallelism, in `apps/web`, entirely
outside this lane's file fence (`packages/core` only). This lane's load-bearing
gate is therefore **packages/core at 855 tests**, with the whole-suite figure
tracked alongside; a recurrence of this specific `bits-ui` teardown error is
pre-existing and not a regression from these deletions.

## (f) KNIP — a no-new-orphans fingerprint ONLY, never a confirmation

```
$ pnpm -w exec knip --workspace packages/core --include exports --reporter json
{"issues":[]}

$ pnpm -w exec knip --include exports --reporter json
{"issues":[{"file":"apps/web/src/lib/trigger-lab/store/graph-wiring.ts",
            "exports":[{"name":"reaches","line":56,"col":17,"pos":3347}]}]}
```

Knip reports **none** of the three target symbols. Two structural reasons:
`package.json` maps `exports['.']` to `src/index.ts`, so every barrel-reachable
name is public API to knip; and `nearestPixelWithin` has a live consumer in its
own test file. Knip therefore **cannot** confirm this finding and must not be
cited as if it did. It is kept solely so S6 can prove no *new* orphan appeared:
the gate is one-directional — any NEW `packages/core` entry after a deletion
means a private helper was orphaned and must be removed too.

The repo-wide fingerprint has shrunk since synthesis measured it: the plan
recorded two files (`apps/web/src/lib/app/patch-topology.ts` **and**
`graph-wiring.ts`); at this head `patch-topology.ts` is clean and only
`graph-wiring.ts:reaches` remains. Unrelated to this lane — recorded so the S6
diff compares against *this* fingerprint, not the plan's.

## ABORT conditions — all clear

| Condition | Result |
| --- | --- |
| (a) returns any hit outside the nine listed | **Clear** — exactly nine, all accounted for |
| (b) returns anything at all | **Clear** — exit 1, empty, and the gate is proven to fire |

## Pre-authorisations (do not re-ask)

`docs/plans/2026-07-26-deep-review/11-decisions.md:77` —
"**INIT-13:** throwing-form wrapper and `listCanvasScenes` both delete."

This settles the `throwing-form-intent` open question on the **delete** branch:
S4 removes the wrapper, and S6's expected VOICE count is **63**. The plan's
"gated on Trent" precondition on S4 is satisfied. The 2026-07-08 Gen3 PRD
specified this signature as intended public API but never wired a caller; the
module's actual policy is coded `issues[]` as data, and the decision collapses it
to that one shape. The same line pre-authorises S5.

---

# S6 — closing the evidence loop

Appended at HEAD `3cefb18`. This is what turns "the suite is still green"
(which it would be even if we had deleted the wrong thing, since these symbols
had no tests) into positive evidence.

## Per-step ledger

| Step | Sha | Change |
| --- | --- | --- |
| S1 | `69229e1` | evidence artifact, no source |
| S2 | `22f8037` | pixel-grid.test.ts onto the primitive |
| S3 | `aef3572` | delete `nearestPixelWithin` (−11) |
| S4 | `1fac3ec` | delete `assertTriggerGraphIntegrity` (−7) |
| S5 | `3cefb18` | delete `listCanvasScenes` (−4) |

Source delta vs `origin/review/impl`: **4 files, +7 / −30**, all in
`packages/core`. Net −23 lines against the plan's ~34 estimate.

## (a) RUNTIME SURFACE DELTA — the interface change equals the claim

| After step | TOP | VOICE | Expected |
| --- | --- | --- | --- |
| S1 (baseline) | 155 | 64 | — |
| S2 | 155 | 64 | unchanged (test-only) — **met** |
| S3 | 155 | 64 | unchanged (not barrel-exported) — **met** |
| S4 | 155 | **63** | VOICE −1, TOP unchanged — **met** |
| S5 | **154** | 63 | TOP −1, VOICE unchanged — **met** |

Final `TOP 154 / VOICE 63`. Every step moved the surface by exactly the size
claimed, at the step that claimed it, and nowhere else. Three symbols removed;
two of them were on the package surface; the surface shrank by exactly two.

## (b) NO-NEW-ORPHANS REGRESSION — clean

```
$ pnpm -w exec knip --workspace packages/core --include exports --reporter json
{"issues":[]}

$ pnpm -w exec knip --include exports --reporter json
{"issues":[{"file":"apps/web/src/lib/trigger-lab/store/graph-wiring.ts",
            "exports":[{"name":"reaches","line":56,"col":17,"pos":3347}]}]}
```

Byte-identical to the S1(f) fingerprint. No new `packages/core` entry, so no
deletion orphaned a private helper. Per S1(f), knip's *silence about the three
deleted names* is recorded as proving nothing either way — it never named them.

## (c) ALL SOURCE CLEAR

```
$ rg -n 'nearestPixelWithin|assertTriggerGraphIntegrity|listCanvasScenes' \
     -g '!node_modules' -g '!docs'
exit=1      # no output
```

Repo-wide, the only survivors are the two prose hits deliberately left alone
(`docs/reports/2026-07-05-elv2-u5-report.md:111`, a rejected alternative in a
dated report; `docs/plans/2026-07-08-gen3-graph-authoring-stabilisation-prd.md:104`,
the PRD signature).

## (d) GATES

Green at every committed step. `pnpm gates` exit 0 at S2, S3, S4 and S5:

| Package | Tests | vs baseline |
| --- | --- | --- |
| packages/core | 855 | = |
| apps/web | 1746 | = |
| apps/server | 598 | = |
| packages/io | 102 | = |
| apps/desktop | 36 | = |
| workers/error-ingest | 35 | = |
| packages/protocol | 33 | = |
| **Total** | **3405** | **= BASELINE_TESTS** |

`apps/web typecheck: 2522 FILES 0 ERRORS 0 WARNINGS` at every step. Since the
whole workspace is TypeScript and `@ledrums/core` is `private: true` with no
deep importers, that clean compile is a **total** proof that no static caller
broke — which is the primary parity instrument for S3/S4/S5, not the suite.

The S1(e) `bits-ui` teardown flake did not recur in any of the four runs.

## (e) RENDER-LOOP SMOKE — substituted, and the substitution is stated

The plan asked for a manual smoke: `LEDRUMS_ENGINE=voice pnpm dev`, fire the
four grid-consuming effects from TriggerLab, confirm pixel output with no
console errors. **That live run was not performed.** What stands in its place is
automated render coverage of the same four effects, which was green in all four
gates runs:

- `effects/batch-c.test.ts` — `render(lightning, ...)`, `render(confettiBurst, ...)`, asserting `finite01Failures(fb, ...)` is empty
- `effects/batch-e.test.ts` — `render(sparkArc, ...)`, `render(rain3d, ...)`, same assertion
- `effects/effects.test.ts`, `registry.test.ts`, `voice/determinism.test.ts`, `voice/compositor.test.ts` — same effects through the compositor

These execute the real grid primitives and assert a valid framebuffer, which is
the exact failure mode the manual smoke was specified to catch ("a mistaken
deletion would show up as silence rather than a red test"). They are also
reproducible and already gated, where the manual run is neither. Reading it
strictly: no live-app run backs this lane; the render-path evidence is automated.

## Deviations from the plan (all recorded at the commit that hit them)

1. **`TOP_BASE` 155, not 159**, and **`BASELINE_TESTS` 3405, not 2968** — both plan
   figures were measured at `8b5af91`; merges landed since. Re-measured at this
   head per COMMON.md rule 5. The *deltas* the plan specified (−1 top-level, −1
   voice) held exactly.
2. **`assertTriggerGraphIntegrity` anchor moved 218 → 243** under INIT-06 (the
   ANCHOR WARNING firing as predicted). Re-verified before editing.
3. **S4's "exactly two exports remain" check is stale** — `graph-integrity.ts` has
   three, because INIT-06 added `canonicalizeNodeKinds`. Both named survivors
   (`validateTriggerGraphIntegrity`, `normalizeTriggerGraphToGen3`) are intact.
4. **S5's "`scenes.` ≥ 5 hits" threshold was off by one** — it counted the line
   being deleted while naming only four surviving consumers. Returns 4, one per
   named consumer; the check's intent (no orphaned module state) holds.
5. **S1(c)'s deep-import scan is not empty** — `@ledrums/core/test-fixtures` is a
   declared second entry point, not a deep path into `src/` internals. It
   exports none of the three symbols. See section (c) above.
6. **Repo-wide knip fingerprint shrank** from the plan's two files to one
   (`patch-topology.ts` is now clean) before this lane started. S6 diffs against
   the S1 measurement, not the plan's.

None of these changed a single deletion. Items 1–4 and 6 are plan text going
stale against a moving base; item 5 is a check whose literal form was narrower
than its intent.

## Residual open questions (unchanged, none blocking — for Phase 10)

- Is a core-registry-backed scene browser on the roadmap? If yes, `listCanvasScenes`
  should return **with** its caller rather than be re-added bare.
- The review's automated dead-code sweep is **structurally blind** to core's
  barrel-exported surface (section f). INIT-13's three symbols were found by
  reading, not tooling. Whether "core surface trims" may be treated as a retired
  *category* without a re-run that demotes `src/index.ts` from entry is an
  acceptance call, not something a step can settle.
- Narrowing `voice/index.ts:18`'s blanket `export * from './graph-integrity'`
  (and its eight siblings) stays out of scope — that is the unassigned
  voice-barrel middle-man finding, and demoting the barrel is exactly what would
  make the tooling see core's dead surface.

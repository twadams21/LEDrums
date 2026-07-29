# Handoff — LEDrums Deep Code-Quality Review

**From:** Opus 5 orchestrator, sessions of 2026-07-26 → 2026-07-29
**To:** fresh orch (Fable, high)
**Work here:** `/Users/trent/.twux/worktrees/review` — a standing worktree on `feat/ota-discord-announce`.
**Do NOT use the main checkout** at `/Users/trent/Documents/dev/ledrums`; it is on `fix/ota-automerge-fallback`
with someone else's OTA work, and the review artifacts do not exist on that branch. The branch moved under the
previous orchestrator mid-command and stranded a commit — verify your branch before every commit.
**All artifacts:** `docs/plans/2026-07-26-deep-review/` — committed, nothing in scratch
**Baseline sha:** `3708648` (every finding is measured against this; do not re-baseline without regenerating)

Read `SPEC.md` for the design. This document is what you need to *act*.

---

## Where the pipeline is

| Phase | State | Artifact |
|---|---|---|
| 0 Baseline & instrument | ✅ done | `00-baseline.json`, `00-coverage.json`, `00-raw/` |
| 1 Map | ✅ done | `01-map/*.json` — 119 modules, 71 seams, 88 suspicions |
| 2 Identify | ✅ done | `02-findings/*.json` — 107 findings, 10 lenses |
| 3a Refute | ✅ done | `03-refuted.json` — 44 killed (**41% false-positive rate**) |
| 3b Verify | ✅ done | `03-verdicts.json`, `03b-verify/` |
| **4 Triage** | ⬅ **YOU START HERE** | — |
| 5 Fix trivial | not started | 12 findings are ready to land |
| 6 Review fixes | not started | |
| 7–10 Plan / rank | not started | 50 findings await |

**Disposition of all 107:** 13 auto-fix · 50 structural-track · 44 refuted. Reconciles.

## The immediate work

### 1. Land 12 of the 13 auto-fix findings

All proven: applied together to a clean worktree from the baseline, **typecheck 0 errors, full suite 2,981 tests passing**, 19 files changed, 27 insertions / 415 deletions, **41 exported symbols removed**.

Reproduce with:
```
bash docs/plans/2026-07-26-deep-review/artifacts/phase3b.sh            # verify individually
python3 docs/plans/2026-07-26-deep-review/artifacts/phase3b-combined.py # apply all verified together
```
Mutations are declared in `artifacts/phase3b-mutations.json`. The worktree is `/Users/trent/.twux/worktrees/rev3b` (detached at baseline; reset it before and after).

**Land 12. HOLD `dead-code-0001`** — see below.

By cause, so you know what you are landing:
- **8 findings — over-broad exports.** Symbols `export`ed but only called inside their own module. Nothing removed; the module stops advertising internals. Zero behaviour risk.
- **3 findings — genuinely unused helpers** (`showLibraryPath`, `ENV_KINDS`, `isMixRowHandleId`). Small deletions. Note `ENV_KINDS`' doc comment claims "the editor seeds from these" and nothing does — stale intent, harmless.
- **1 finding — type barrel cruft** (`dead-code-0014`): five type re-exports nobody imports from that path. Erased at compile.

### 2. Trent's decisions this session — ACT ON THESE

**Kit mirror: REMOVED. Deliberate.** `PatchMirrorControl` was orphaned by the Patch Graph v2 rewrite and Trent has confirmed the feature is gone by intent. So the cleanup is *larger* than `dead-code-0002` proposed:
- delete `apps/web/src/lib/app/views/PatchMirrorControl.svelte`
- **and** the now-unreachable `setKitGlobal` client path
- the server half is still live and tested (`input-router.ts:186`, `handlers/voice-input.ts:149`, `handlers/client-message.ts:524`, `kit-global-forwarding.test.ts`) — decide with Trent whether the server capability also goes, or stays as an API with no UI

**Patch copy/paste: UNRESOLVED — do not delete.** Trent: *"i think patch copy paste was meant to be fixed or change, i cant remember."* `dead-code-0001` proposes deleting `PatchClipboardToolbar.svelte` + `PatchDiffDialog.svelte` (383 lines). **Hold it.** Its backing is still alive — `store.copyPatch()` at `store.svelte.ts:2079`, `trigger-lab/patch-diff.ts`. Both components were un-mounted by commit `39b7d6b` ("D1b Step 2 — Patch Graph v2 zone canvas"), same commit that dropped the mirror. This is a product question, not a cleanup.

### 3. Phase 4 triage → then 7–10 for the 50

The 50 structural-track findings include **all 9 surviving criticals**. Ranked work has not started. Highest-value first:

1. **Two full render stacks are live.** `packages/core/src/engine/` (legacy, 438-line `Engine` + compositor + modulation) and `packages/core/src/voice/` (~5,900 LOC). `apps/server/src/main.ts:72` selects on `LEDRUMS_ENGINE` and **defaults to LEGACY when unset**, while every shipping path forces `voice` (`scripts/dev.mjs:32`, `src-tauri/lib.rs:386`). Reachable only by a config nobody uses.
2. **A third implementation exists.** `apps/web/.../trigger-lab/sim.ts:280-702` re-implements voice lifecycle, bus polyphony/voice-stealing and trigger-graph evaluation that `core/voice/voice-pool.ts` and `eval-graph.ts` already do. `render.ts` in the same dir already proves the right pattern by delegating to core.
3. **`engine/modulation.ts` vs `voice/lfo.ts`** independently implement the same four LFO shapes and already disagree in scope.
4. **The god object survived its own refactor.** R20–R24 extracted five controllers out of `store.svelte.ts` then re-published every member as a one-line forwarder. 3,641 lines, **120 commits co-changing 420 distinct files**.
5. **Art-Net and sACN both install `on('error', () => {})`** — a total swallow — and gate sends on a `ready` flag set only in the bind callback. A stale `iface` after an ethernet→wifi switch fails silently. This is the show going dark with no diagnostic.
6. `voice-engine-host.scheduleNext()` calls `loop()` in a bare `setTimeout` with no `try/catch` down to `gen.render()`.
7. `GraphNode` is one flat interface with 40 fields (27 optional) behind a 19-member `NodeKind` union.

## Hard-won operational rules — violating these has already cost a machine crash and a lost night

**Concurrency lives in code, never in a prompt.** The first Phase 3a attempt fanned 107 refutations across 10 Workflow wrapper agents whose prompt merely *suggested* a parallelism limit. Each agent honoured it independently → 107 concurrent `claude -p` processes → **the Mac crashed, zero work done overnight.** `artifacts/run-refutations.sh` now enforces the cap with `xargs -P 3` plus a load-average circuit breaker. Do not raise it above 3 without watching the machine.

**Verify the artifact, never the exit code.** Every silent failure this project has hit is *green-on-the-wrong-state*:
- `pnpm run test -- --coverage.*` → pnpm passes `--` literally, vitest ignores every flag after it: suite GREEN, **zero coverage written**
- BSD `xargs -I` caps a constructed arg at 255 bytes → aborted at 36/107 and **exited 0**
- `phase3b-combined.py` crashed midway on an unhandled mutation kind → partial tree → typecheck and suite came back **green**
- `ls -d` on a dangling symlink looks identical to a live one (`test -e <path>/package.json` is the real check)
- a filtered re-run overwrote `results.json`, so a downstream step applied 1 mutation and reported success

Assert counts against expectations. `phase3b.sh` now aborts if the mutation spec does not cover every survivor — added because `dead-code-0014` was silently missing and nothing noticed.

**Never `pgrep -f <script>` to check if your own job is running** — the wrapper's command line contains the string, so it matches itself and waits forever. A resume job deadlocked on this and reported a stalled run as healthy for an hour. Watch the artifact count instead.

**Tests: `pnpm gates`, never `pnpm test`.** Only `gates` takes the machine-wide mutex (`~/.ledrums/locks/gates.lock` via `scripts/with-gate-lock.mjs`). Vitest worker caps live in `~/.zshenv`, **not** in the repo — grep the repo for a cap and you will wrongly conclude none exists.

**Coverage gates deletion claims.** A finding removing *executable* code in a 0%-coverage region cannot be verified by a green suite — the suite never ran it. `PatchClipboardToolbar` and `PatchDiffDialog` are 0/80 and 0/20 statements. For those, the evidence is the import graph and git history, not the tests. Trent raised this and he is right.

## Models: CLAUDE ONLY from 2026-07-29

**Trent's instruction: Claude models only from here on.** Do not launch Sol/codex agents and do
not use the proxy path for new work.

Existing artifacts are unaffected — Phase 3a's 107 refutations were produced by `gpt-5.6-sol(medium)`
and their provenance is recorded in `03-verdicts.json`. That history stands; it just is not how you
generate anything new.

`artifacts/codex-agent.sh` and `verify-nonce.sh` stay in the repo for provenance and because their
design lesson generalises: a wrapper relaying another model's output can silently substitute its own
answer, and the guard needs four properties to close it — runtime nonce · nonce injected into the
child's prompt and echoed back · single-use receipts (anti-replay) · child writes to a file so the
wrapper never handles the body. `artifacts/NONCE-TEST.md` has the verbatim proof of all four. **You
should not need any of it.** Native `agent()` calls return schema-validated objects directly, which
is why Phases 1 and 2 needed none of this machinery.

Also still true and worth knowing: `twux`'s `EFFORT` column reports the launch flag, not the live
tier — read the pane footer via `twux capture` if effort matters.

## Trent's working preferences observed this session

- **Phase by phase.** He explicitly asked to stop planning-ahead and scope each phase on the previous phase's real findings. That changed the pipeline for the better — Phase 1 dropped from 9 lanes to 6 on evidence.
- **Enforce in code, not convention.** When I fixed a bug by documenting the right invocation, he pushed back: *"We should enforce with code rather than ai convention right?"* He was right.
- **He will check your claims.** He caught a run I reported as progressing that was actually deadlocked. Report what you verified, not what you launched.
- He is blunt when something breaks. Own it, fix it, move on — do not grovel.

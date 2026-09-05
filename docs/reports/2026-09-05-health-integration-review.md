# Health integration review / verification ledger

Scope: follow-up implementation since merged audit `ea18f61`; authorization and agent defaults in `docs/plans/2026-09-05-health-implementation.md`. This ledger is updated as checks finish. **Not a merged/shipped claim.**

## Independent reviews

| Scope | Standards | Spec / disposition |
| --- | --- | --- |
| P03/P04/P08 core/offline | No substantive standard violation found | Two P2 defects corrected in `88df4597`: paused inputs ignored by tick-only cache; Mix helper omitted authored-envelope metadata. Correctness tests pass, but parent allocation probe found **64 MiB fresh history copies per ordinary tick** for 16 Echo voices/4,096 pixels. Allocation correction remains a blocker. |
| P01/P10 document/history | No substantive standard violation found | Both P2 defects corrected in `74634119`: pending clipboard/manual-paste lifetime crosses replacement; Save As replays preset backfill and resurrects deletion. Independent verification cleared both: **100 tests + 9 additional probes**, including real dialog continuations and runtime registry ownership. |
| P05/P07 output + FPS + release + ingest | No separate substantive standard violation found | No blocker in reviewed output/admission/notification/SHA/SEA paths. Initial P06 HIGH below. Shutdown drain completion is separately owned by P02/P11. |
| P06 rebind correction | No remaining blocker found | Initial HIGH: rebind discarded failed cleanup ownership. Corrected in `2ff07e29`. Independent verification: **25 tests + 12 in-memory probe groups**, original repro red on parent and green after correction. |

Controller review covered pending/cancelled acquisition, same-host credential refresh before/during/after cleanup, rapid A/B/A, failed acquisition and cleanup retries, destination-correct notifications. Unresolved state retains no retired clients/credentials; pending command closures temporarily retain their clients. Failed departed-device cleanup is not retried indefinitely: re-adopt it for explicit recovery. Failed acquisition retains recovery eligibility but does not claim a known active pattern. These are orchestration proofs, not physical acknowledgement.

No independent reviewer performed a full Tauri build, hosted release rehearsal, Worker deployment, GPU inspection or physical controller certification. GPU allocation and screenshot evidence comes from the orchestrator's separate browser probe.

## Integrated verification completed so far

- Pure-JS Knip 5.50.0 seeded-fixture + clean-baseline check: pass.
- Integrated web typecheck before review corrections: **0 errors, 0 warnings**. Not substituted for final post-correction gates.
- Integrated pre-split production web build: pass; main **2,108,374 bytes**. Cold-cache, fresh-browser-context, 4× CPU-throttled baseline recorded by `scripts/health-startup.mjs` (three samples per Perform/Trigger); comparison/report belongs to the bundle slice. Shared-host timings are noisy.
- Worker tests on exact desktop CI Node **22.23.1**, with builtin SQLite enabled: **57/57**, nine files, pass. This independently checks compatibility beyond the worker author's Node 25 run. No D1 service calls.
- Release/SEA policy, workflow fixtures, Mach-O and version tests under the same exact Node: **68/68**, pass. No publication/build is implied by these test counts.
- P02/P11 first integration (`b4677cc2`, `fc0f95ee`, `ead799ed`, `0c25083d`): server typecheck and **55 tests / seven files** pass against the combined core/controller source, including actual voice and legacy main-process load/restore/cold recovery. Only scaffold conflicts occurred; both integration status and scoped server evidence/events were retained. This is before the follow-up worker serializer, not its verification.

- Connected Chrome document proof after `74634119`: deferred A clipboard read cannot alter B; foreign Undo is rejected; Sim replaced; new Undo works; Save As preserves deleted preset. Zero console errors. Strict `ui-shot` of Shows passed and `.ui-shots/health-shows.png` was inspected (Health Clone selected; source shows retained).

## Usage-limit recovery

Three unfinished agents stopped on provider usage limits, not failed code tests: P02/P11 had 232 passing targeted checks and its shutdown commit; lazy loading was investigating a real failed-import retry defect; allocation repair had only begun its probe. After Trent explicitly reset usage and asked to resume, replacement agents were launched in the same worktrees with their saved edits intact. Completed agents were not rerun; the original four stale-checkout auditor cancellations remain historical and were not restarted.

## Remaining integration gates

1. Complete P02/P11 and lazy surfaces; resolve and independently verify remaining review regressions. Check repaint correction's hot-path allocation cost, especially Echo/Feedback state—not only pixel equality.
2. Re-run final frozen install, full typecheck/tests/build, dead-code verification and relevant browser interactions/captures against the combined final source.
3. Review project replacement/async backup/shutdown and lazy load/failure/focus behavior; update evidence and scaffold with actual results.
4. Open PR, observe CI, merge only when green. Worker migration/deployment and OTA publication remain separate, unexecuted actions requiring authorization.

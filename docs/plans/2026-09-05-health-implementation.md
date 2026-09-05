# Health remediation implementation tracker

## Authorization and defaults

Trent approved all next steps in-session on 2026-09-05: “All of those #2 next steps sound great and dont look like they need any decision or answers from me. go ahead and implement them”. This supersedes the audit's request to stop for behavior questions; implement conservative defaults and document them. No authorization to publish a GitHub Release, deploy the Worker, or operate physical controller outputs.

- History is cleared on document replacement and protected by show identity.
- Geometry-dependent visual state restarts when model identity changes; no remapping promise.
- Undo is byte-budgeted (initial target 32 MiB) with the existing 10,000-entry ceiling; exact accounting and oversized-snapshot behavior are documented in the implementation report.
- Dead code is removed only after proving runtime/build/test reachability and retaining live Settings/patch-data mutators. No deletion based solely on Knip output. The prior hold on eight Patch files remains until parity/hardware sign-off; that condition has not been fulfilled.
- Web appearance/interaction contracts remain unchanged. Any lazy-loading state uses the existing design system.

## Delivery structure

Related slices share a branch where splitting their shared ownership changes would create broken intermediate states. This is a deliberate adjustment from one-PR-per-audit-row: core lifecycle/render/parity (P03/P04/P08), document/history/persistence (P01/P10), output status/coverage (P05/P07), release reproducibility (P12/P13). Each keeps logical commits and independent review. Project replacement/async snapshots (P02/P11) consume the new output contract afterward. Controller (P06), ingest (P14), tooling/dead code (P15), GPU lifetime (P09), bundle splitting and real-throughput measurement are independently testable.

All workers use isolated worktrees off merged audit `ea18f61`, commit but do not push/merge/deploy. The orchestrator integrates and owns full typecheck/test/build sweeps, browser captures and PR/merge gates. User's prototype checkout and dirty F7 brief remain untouched.

## Work queue

| Work | State | Branch / evidence |
|---|---|---|
| P03/P04/P08 core lifecycle + scoped rendering + offline parity | integrated; retirement re-review clear | replay allocation and retention fixed in `e5543b1d` / `c7bef0b5` |
| P01/P10 document lifetime + bounded/debounced persistence | integrated; independent re-review clear | generation-fenced async paste and exact-content Save As verified |
| P05/P07 observable output + retired coverage | integrated; independent review clear | real loopback + fake-socket acceptance/coverage tests |
| P12/P13 release SHA + exact SEA runtime | integrated; independent review clear | 68 targeted checks; actual universal sidecar smoke |
| P09 GPU resource lifetime | verified | real Chrome 0 retained growth; strict connected capture clean |
| Wall-clock throughput measurement | verified | `874300d`; 38 targeted host tests |
| P02/P11 authoritative project + async backup ownership | integrated; final review blockers fixed `a591d3c4`, independently verified | atomic authority, import guard for unversioned legacy libraries, depth-safe text transport + isolated off-site handoff, bounded SEA-tested worker; structured-clone submission stalls remain, multi-MB stall-free acceptance PARTIAL |
| P06 controller takeover lifecycle | review correction verified | `2ff07e29`; 25 tests + 12 independent probe groups |
| P14 ingest notification liveness/atomicity | integrated; independent review clear | 57 Worker tests; migration/deployment UNEXECUTED |
| P15 trustworthy dead-code tooling + verified deletion | verified scoped baseline | `77c1d2a0`; pure-JS pin, seeded-fixture check, held files retained |
| Lazy route loading / bundle measurements | integrated; final review blockers fixed `424da809`, independently verified | `9581516c` + `424da809`; 16/16 production browser matrix; isolated initial-JS reduction 22.42% (not re-measured), no established startup-timing win |
| Integrated review, full gates | local gates green on `424da809` (4,759 tests / 4 skipped; build; design-system; SEA 16/16; browser matrix + strict shots) | evidence: `docs/reports/2026-09-05-health-integration-review.md` |
| PR / CI / merge | NOT STARTED — branch UNPUSHED and UNMERGED, awaiting push authorization | no publication, deploy or Worker migration included |

## Verification notes

- Performance claims require actual operation counts, byte measurements or before/after timing; no overall speedup percentage inferred from code review.
- P09 unit regression failed against dispose-after-replacement semantics; fixed path passes. Real Chrome probe against original Pixels implementation retained 18 extra GPU buffers over repeated revisions; fixed implementation held 23 live buffers, 0 growth, including three view unmount/remount cycles.
- Initial P09 strict capture on web-only dev failed solely on WS handshake errors; IPv4 capture also missed Vite's IPv6-only listener. Correct connected capture at `http://localhost:5411` passed strict checks and was inspected; isolated temporary project data, output disabled.
- UI-skill scripts are untracked/local to the original checkout: use `/Users/trent/Documents/dev/ledrums/.agents/skills/impeccable/` and `/Users/trent/.claude/skills/make-interfaces-feel-better/` as absolute paths in worktrees. Product register and existing design system remain governing; skill updates are unrelated and deferred.

# Group A — Graph editor hardening (issue #46, lane 1)

Lane-1 orch group report. Branch: `group/A` (off `rock-solid` @ 9b7022f). One slice.

## Slices

- **S01 — Graph editor hardening** (`slice/S01` @ 5726654, impl `S01-graph-hardening-894d82`,
  merged `--no-ff`): flow-callback error boundaries → Monitor `error` events + self-heal rebuild;
  exception-safe projection-cache lifecycle (reset on graph-switch/error, write-through only on
  success) + dev desync assertion; visible "Stale node" placeholder instead of blank cards;
  wiring validation proven never-throws (2×5000-iteration fuzz). Report:
  `docs/handoff/rock-solid/S01.md` (full context pack for H/I).

## Merges

Clean — single slice, no conflicts. Post-merge full sweep green: typecheck 0 (6 pkgs; web
svelte-check 2208 files), **1037 tests / 99 files, no skips** (io 13 · core 234 · protocol 1 ·
server 170 · web 619; 24 new).

## Group review (full diff vs doc 09 + slice file + AGENTS.md)

Verdict: **PASS, no findings requiring fixes.**

- Diff read end-to-end (15 files, +725/−52). All five acceptance criteria verified against real
  code + tests, not just the report: `flow-guard.ts` boundary is pure/framework-free and every
  `GraphCanvas` callback in `TriggerGraphView` is wrapped via the view's `guard()`; projection
  write-through happens only on successful return with reset-before-projection on graphKey
  change and reset+last-good-render on catch (blank canvas impossible by construction);
  `TriggerNode` renders the dashed stale placeholder (3 jsdom scenarios); fuzz proves
  `canConnect`/`canReconnect` total.
- AGENTS.md non-negotiables: web-only slice (core purity untouched); design system engaged —
  `NodeCard` `stale` state added to styleguide + `design-system.html` regenerated in-change;
  `/make-interfaces-feel-better` applied.
- Deviations reviewed + accepted: public `store.reportError()` seam (minimal, the only Monitor
  error entry point); `flow-guard.ts` extraction (testability); `.gitignore` +`dist-design-system/`.
- Root cause of incident 09 not convicted — expected per doc 09 (instrument-first): candidates
  1 & 2 eliminated wholesale, candidate 3 made observable.

## Context pack for dependent groups (H — S29+, I — S33+)

- Read `docs/handoff/rock-solid/S01.md` § Context pack before any graph-editor work. Key
  invariants: never assign the projection cache before a successful projection; wrap every new
  flow callback with `guard()`/`guardFlowCallback` + `store.reportError('trigger-graph', …)`;
  component-field cache (NOT module-level) and the `untrack` around projection reads are
  load-bearing.
- **PatchGraphView is NOT hardened** (out of S01 scope). It shares the drop-anywhere wiring —
  if H/I touch it, apply `guardFlowCallback` there (flagged deviation, not a defect).

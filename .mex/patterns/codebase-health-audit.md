---
name: codebase-health-audit
description: Audit the current shipped-line code without stale-branch findings, unsafe dead-code deletion or speculative optimizations.
triggers:
  - "codebase audit"
  - "performance and reliability"
last_updated: 2026-09-05
---

# Codebase health audit

## Context

Read AGENTS, architecture and conventions. Source evidence from current code, not historical ROUTER claims. Reference audit: `docs/plans/2026-09-05-codebase-health-audit.md`.

## Steps

1. Check status, branch, HEAD and ancestry against fetched `origin/main` **before dispatching readers**. This repo retains older prototype branches with authoritative-sounding ledgers; the code may predate releases. If auditing the merged app, use an isolated worktree off `origin/main`, preserve existing edits, and install its lockfile.
2. Split read-only review by core/render, server/IO/persistence, web/runtime, desktop/worker/tooling. Have the orchestrator run full sweeps; workers run only narrow probes/regressions. Distinguish measured evidence from source-confirmed risks.
3. Reproduce each safe repair with a failing colocated test. Cache tests must cover model replacement with both different and equal pixel totals; async queue tests must mutate the same key while shipping is deferred.
4. Separate contained repairs from ownership changes. Project/show replacement spans two hosts or document/history/simulator lifetimes; one-call patches can leave another owner stale. Define the replacement module and test every entrypoint before implementing.
5. Validate dead-code reachability through workspace package scripts, Tauri shell preparation, design-system/UI-shot entries and registries. Knip root entries do not necessarily cover workspace scripts. Unreachable held Patch/prototype code still needs its explicit removal gate.
6. Review the repair diff, run integrated typecheck/tests/build, open a PR and follow normal merge/release rules. Publish no release merely to validate an audit fix.

## Gotchas

- `rg`/`fd` tool wrappers may fail before searching; use the CLI through bash when that happens.
- Core/offline action parity does not prove rendered-pixel or voice-lifetime parity. Compare frames and state evolution.
- Async UDP errors do not reach synchronous send catches. Packet attempts are not proof of controller receipt.
- Dropping congested preview frames must not silently drop authoritative JSON messages.
- Frame buffers owned by async transports cannot be blindly reused while outstanding sends may reference them.
- Reaping a pooled object does not release its retained arrays unless references are cleared.
- `pnpm test` passing with jsdom/Svelte warnings is not real-browser or hardware verification.

## Verify

- Core: no IO/wall-clock/unseeded RNG added; deterministic replay preserved.
- Model changes: cached topology and state ownership are explicit.
- Async work: same-key replacement, eviction/reinsertion and failure/retry ordering tested.
- Deletions: build-time and dynamic roots verified, no held surfaces removed implicitly.
- `pnpm typecheck`, `pnpm test`, affected build paths and `git diff --check` green.
- Any UI changes apply the required design skills and `pnpm ui-shot` verification.

## Update scaffold

Record actual branch/PR/verification status in ROUTER, link the prioritized report, and mark recommendations and unanswered decisions as such. Never call a source-reviewed optimization a measured end-to-end speedup.

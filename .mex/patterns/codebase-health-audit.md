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
- Core/offline action parity does not prove rendered-pixel or voice-lifetime parity. Compare frames and state evolution, including authored envelopes inside composites and input changes while paused. A tick-keyed cache must not freeze live modulation; invalidation must not advance trails twice.
- Document replacement also invalidates outstanding clipboard promises and manual paste dialogs. Use a generation token, not just show identity (same-ID server replacement is still a new lifetime). Save As must not replay boot-only preset backfill over an already-live snapshot.
- Controller cleanup belongs to its destination, not its disposable HTTP client. Test failed cleanup → leave → re-adopt, credential refresh while pending, and rapid A/B/A. Never clear uncertainty before acknowledgement.
- Async UDP errors do not reach synchronous send catches. Packet attempts are not proof of controller receipt.
- Full project replacement must preserve the active OutputManager's old coverage, stage both runtimes before mutation, and await safety backup. Test actual input/model/transport convergence and cold recovery without a browser resync in both modes.
- One atomic envelope avoids torn three-file restores; a corrupt new authority must not silently fall back to stale imports. Document downgrade/export implications and the lack of fsync separately from rename atomicity.
- Async gzip/fs does not make JSON capture asynchronous. Measure submission time separately from post-capture queue progress, and report queued-string memory rather than claiming an allocation reduction.
- Accepted authoring can reopen output after shutdown's first stop. Drain accepted operations, then close/await the final output lifetime too; test with deferred callbacks, not an immediate fake alone.
- Shutdown must close admission before closing clients: execution-time editor checks otherwise discard already-queued work when socket teardown revokes authorization. Preserve identity during the drain (including peer/tunnel disconnect), not during ordinary takeover. Prove it through real main: FIFO named load → queued edit → ping barrier → SIGTERM → release FIFO → inspect cold storage in both modes.
- Reserve internal envelope names case-insensitively before named Project IO, and test explicit case-variant filenames even on Linux. Protocol-shape validity is not library-version compatibility: reject unsupported versions before safety/persistence or run the canonical migration, never silently reinterpret old hoop ids.
- Restored canvas effects need canonical parameter SPECS as well as preset values. Missing specs silently disable modulation; assert real rendered RGB at CC endpoints, not only projected object shape.
- Dropping congested preview frames must not silently drop authoritative JSON messages.
- Frame buffers owned by async transports cannot be blindly reused while outstanding sends may reference them.
- Reaping a pooled object does not release its retained arrays unless references are cleared.
- Three frees GPU attributes by reading them during geometry disposal: dispose BEFORE replacing attributes. Instrument actual browser WebGL creation/deletion across rebuilds and view remounts.
- `pnpm dead-code:verify` checks actual reachability with a seeded dead source file. Keep the pure-JS Knip pin deliberate: newer releases can introduce native resolver bindings. Keep advisory unused exports separate from the verified file/dependency baseline.
- New D1 claims code needs backfill and writer quiescence before deployment; merging application code is not a migration. Claims are notification attempts, not guaranteed delivery.
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

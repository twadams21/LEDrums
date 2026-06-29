# PRD: Codebase Quality And Architecture Cleanup

Date: 2026-06-29

Status: placeholder PRD for a future implementation PR or series of PRs. This document is local-only and was not published to an issue tracker.

Source discovery: `docs/plans/2026-06-29-codebase-refactor-opportunities.md`

## Problem Statement

LEDrums has accumulated useful but uneven implementation seams during rapid feature work. The application works, and many pure modules are well tested, but maintainers now have to understand several shallow interfaces before changing common behavior. Runtime ownership is split in voice mode, protocol types are not executable runtime contracts, the live web store exposes a very wide interface, some UI behavior is duplicated or dead, and operational docs do not reliably describe the current app.

From the developer's perspective, this raises the cost and risk of future work: a change to trigger behavior, protocol messages, patch routing, output IO, or app state often requires updating multiple implementations and multiple test surfaces.

## Solution

Run a focused codebase-quality initiative that deepens the highest-friction modules and removes confirmed dead or duplicated surfaces. The work should be organized as small implementation slices, each with clear ownership and tests at the highest useful seam.

The implementation should prioritize locality and leverage:

- Locality: each behavior has one obvious module where fixes happen.
- Leverage: callers learn a smaller interface and tests exercise more behavior through that interface.
- Seam discipline: introduce adapters only where at least two real implementations exist, such as legacy vs voice runtime or production vs fake datagram IO.

## User Stories

1. As a LEDrums maintainer, I want the active server runtime to expose one project/model/output/input interface, so that voice-mode changes do not require manual propagation across hosts.
2. As a LEDrums maintainer, I want project load and save to update the same runtime that renders live output, so that broadcast state and real pixels cannot diverge.
3. As a LEDrums maintainer, I want WebSocket messages parsed by an executable protocol module, so that invalid payloads fail at the wire seam instead of becoming trusted TypeScript values.
4. As a LEDrums maintainer, I want protocol tags and WS constants declared once, so that server, web, and Vite cannot drift.
5. As a LEDrums maintainer, I want voice graph data parsed from schemas with defaults, so that tests and callers can construct minimal valid nodes.
6. As a content author, I want only trigger sources that actually run to be available, so that I cannot author a CC-bound graph that never fires.
7. As a content author, I want model changes to have defined behavior for active voices, so that geometry edits do not leave stale generator state behind.
8. As a frontend maintainer, I want small row and inspector modules to receive narrow view models and commands, so that component tests do not require a full app store.
9. As a remote viewer, I want read-only behavior enforced through one edit seam, so that new mutators cannot accidentally bypass viewer restrictions.
10. As a frontend maintainer, I want dead play-node settings UI removed or shared, so that there is one implementation of play-node editing.
11. As an operator, I want generator-backed thumbnails to render consistently in nodes, galleries, and inspectors, so that previews match the selected effect.
12. As a patch editor user, I want patch graph topology to reflect project changes after mount, so that geometry/routing edits do not require view remounts.
13. As a patch editor maintainer, I want hoop pixel calculations owned by the geometry module, so that web readouts cannot drift from core.
14. As a lighting operator, I want UDP output failures to appear in output status, so that real Art-Net/sACN problems are visible.
15. As a runtime maintainer, I want live server filesystem operations to be async, so that static hosting or project IO cannot block the render loop.
16. As an engine maintainer, I want shared trigger helpers used by both core and web, so that local preview and production behavior do not drift silently.
17. As a hardware setup maintainer, I want DMX topology validation to catch duplicate or overlapping output mappings, so that ambiguous packet maps are rejected early.
18. As a core maintainer, I want TypeScript config to enforce platform purity, so that DOM or Node globals cannot leak into pure packages.
19. As a developer, I want root scripts to be reliable, so that advertised commands do not fail because no workspace implements them.
20. As a desktop maintainer, I want a lightweight desktop check surface, so that packaging logic can be tested without full Tauri or release infrastructure.
21. As a new maintainer, I want README and setup docs to describe the current app, so that I start from the right mental model.
22. As a future agent, I want ROUTER and docs indexes to separate current facts from historical logs, so that stale plans do not steer new work.
23. As a contributor, I want runbooks for repeated high-risk seams, so that protocol, patch routing, trigger nodes, desktop packaging, and live spot-check work follow known patterns.

## Implementation Decisions

- Treat this as a multi-slice quality initiative, not a single broad rewrite.
- Prioritize the active server runtime seam first because it affects project state, rendering, output, persistence, and test confidence.
- Make protocol runtime parsing executable before adding new WebSocket messages.
- Keep core pure; protocol may depend on core domain types but core should not own app transport facts.
- Use schemas for voice show/graph data so external persisted data and test fixtures cross one parse seam.
- Decide explicitly whether MIDI CC trigger sources are in scope for implementation. If not, remove or disable the authoring surface until they are real.
- Keep the web rune store as the app state holder for now, but reduce what child modules need to know by passing narrower view models and command interfaces.
- Remove dead UI only after confirming reachability by static search and tests.
- Do not introduce broad adapter layers unless there are two real adapters. Legacy vs voice runtime, datagram production vs fake test IO, and async persistence are real seams.
- Move duplicated pure helper behavior toward core-owned modules when web behavior must match production.
- Preserve local/offline preview behavior, but make any intentional difference from the production engine explicit and tested.
- Treat documentation cleanup as part of architecture cleanup because project docs are a major navigation interface for future work.

## Proposed Implementation Slices

1. Runtime ownership: introduce an active runtime interface and migrate voice-mode project/model/output/input handling behind it.
2. Protocol runtime contract: add executable decode/encode validation and move WS constants to the protocol seam.
3. Voice graph schema and reachability: add schemas/defaults, resolve or remove CC trigger authoring, define model-replacement behavior.
4. Web store command seams: centralize edit permissions and narrow UI module interfaces for a few high-churn surfaces first.
5. Frontend dead/duplicate UI cleanup: remove or share play-node settings overlay and centralize thumbnail preview props.
6. Patch graph view-model: make graph projection/adoption pure and reactive to project changes without fighting SvelteFlow.
7. IO observability and async filesystem: surface async UDP errors and move live file paths behind async adapters.
8. Shared helper and topology validation: consolidate pure trigger helpers and strengthen DMX output validation.
9. Tooling gates: split platform TS configs, repair root lint/check scripts, add desktop lightweight checks, optionally enable no-unused checks.
10. Docs and runbooks: refresh active docs, archive historical docs, and add recurring seam runbooks.

## Testing Decisions

- Test through the highest stable interface, not through internal helper details.
- Runtime ownership tests should use the active runtime interface and assert observable state, model, output status, and persistence behavior.
- Protocol tests should be runtime tests, not only compile-time type assertions.
- Voice graph tests should parse minimal authored data through schemas before evaluating behavior.
- Read-only tests should focus on the centralized edit seam, with representative integration coverage for mutator families.
- UI row/component tests should use narrow fake command interfaces where possible.
- Patch graph tests should cover pure projection and a small number of Svelte adapter lifecycle cases.
- IO tests should use fake datagram adapters to cover asynchronous failures without real UDP.
- Server filesystem tests should use fake async persistence/static adapters where practical.
- Tooling changes should be verified by package-specific typecheck/test commands before enabling stricter repo-wide gates.
- Live browser behavior still needs a separate smoke/runbook for graph wiring, drag/refresh, inspector dispatch, role gating, and cold-load persistence.

## Out Of Scope

- New LED effects or content-authoring features.
- A full UI redesign.
- Hardware protocol redesign beyond observability and validation.
- Replacing Tauri or desktop release architecture.
- Publishing an issue tracker ticket from this PRD.
- Implementing any fixes in this discovery turn.

## Further Notes

- The discovery scan found several likely quick wins, but they should still be handled intentionally: dead play-node settings overlay, generator thumbnail props, WS constants, effective hoop pixel helper, duplicated test storage helpers, and no-unused cleanup.
- Historical docs should not be deleted blindly; archive or mark them so current operational docs become trustworthy without losing implementation history.
- The existing session changes before this scan were the creation of `AGENTS.md` and the `CLAUDE.md` pointer.

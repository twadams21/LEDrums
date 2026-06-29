# Codebase Refactor Opportunity Scan

Date: 2026-06-29

Scope: discovery only. No implementation fixes were made. This scan used parallel subagents over `packages/core`/`packages/protocol`, `apps/server`/`packages/io`, `apps/web`, repo static hygiene, and docs/navigation. Findings use the codebase-design vocabulary: module, interface, implementation, depth, seam, adapter, leverage, and locality.

## Executive Summary

The codebase has strong pure-module coverage in many areas, but recent feature velocity left several shallow interfaces where behavior is split across callers or mirrored in multiple implementations. The highest-leverage cleanup is not broad stylistic refactoring; it is deepening a few specific seams so future feature work has fewer places to update and fewer tests to duplicate.

Top recommendation: deepen the server runtime seam first. In voice mode, project ownership, live model/output ownership, reducer handling, persistence, and broadcast state are split between the legacy `EngineHost`, `VoiceEngineHost`, and message handlers. That split is a real behavioral risk and drives several downstream test gaps.

## Priority Matrix

| Priority | Candidate | Strength | Main Payoff |
| --- | --- | --- | --- |
| P0 | Deepen server runtime ownership in voice mode | Strong | One interface for project/model/output/input; fewer propagation bugs |
| P0 | Make protocol executable at runtime | Strong | One wire contract; real decode validation; fewer allow-list mirrors |
| P0 | Fix advertised-but-unreachable voice graph inputs/state seams | Strong | Authored content matches runtime behavior |
| P1 | Deepen TriggerLab store/edit seams | Strong | Smaller UI interfaces; safer read-only policy; less store setup in tests |
| P1 | Make patch graph projection a pure view-model seam | Strong | Live topology changes stop depending on mount timing |
| P1 | Surface UDP adapter errors without blocking render loop | Strong | Real output failures become observable |
| P1 | Move live server filesystem paths to async adapters | Strong | Render-loop safety no longer depends on call-site memory |
| P2 | Collapse duplicate core/web trigger helpers and offline sim behavior | Worth exploring | Less drift between local preview and production engine |
| P2 | Add stronger topology validation | Worth exploring | Prevent ambiguous DMX output maps |
| P2 | Tighten TS/tooling gates and docs navigation | Strong/Worth exploring | Better guardrails and faster onboarding |

## Findings

### 1. Deepen Server Runtime Ownership In Voice Mode

Strength: Strong

Files:
- `apps/server/src/main.ts`
- `apps/server/src/handlers/client-message.ts`
- `apps/server/src/handlers/projects.ts`
- `apps/server/src/handlers/voice-input.ts`
- `apps/server/src/engine-host.ts`
- `apps/server/src/voice-engine-host.ts`

Problem: In voice mode, the server keeps both the legacy `EngineHost` and the `VoiceEngineHost`. The legacy host owns the reducer/project persistence path, while the voice host owns live model/output behavior. Callers must know which host is authoritative for each operation, which makes the module shallow.

Evidence:
- `main.ts` constructs both hosts from the same initial project and relies on shared-object aliasing.
- `stateMessage()` combines `project` from the legacy host with `model`/`output` from the voice host.
- `handleProjectMessage` has no `voiceHost` dependency, so project load/save/list paths are not clearly unified with the active runtime.
- `propagateToVoiceHost` mirrors only some reducer mutations to the voice host.

Suggested deepening: Introduce one server runtime module at the host seam with a small interface for current project, current model, output status, inputs, structural mutations, start/stop, and project load/save. Put legacy and voice differences behind adapters. This increases locality because message handlers stop knowing which host owns each behavior.

Test opportunities:
- Voice-mode `loadProject` updates project, model, output status, and persisted state together.
- `setKitTransform` applies every exposed field through the active runtime.
- `setKitOutputs`, `setInputMap`, and `setOutput` mutate the active runtime and broadcast the same state that will be saved.
- Handler tests should exercise `voiceHost` paths, not only `voiceHost: null`.

Related opportunity: `EngineHost` and `VoiceEngineHost` duplicate fixed-step loop implementation. After runtime ownership is clarified, extract a fixed-step loop module only if there are still two adapters that justify the seam.

### 2. Make Protocol Executable At Runtime

Strength: Strong

Files:
- `packages/protocol/src/index.ts`
- `apps/server/src/ws-protocol.ts`
- `apps/server/src/ws-protocol.test.ts`
- `apps/web/src/lib/ws/protocol-types.ts`
- `apps/web/vite.config.ts`
- `packages/core/src/index.ts`

Problem: `@ledrums/protocol` claims to be the single wire contract but only exports TypeScript types. Runtime parsing is split into server/web adapters that check only `t` membership, and the client-message allow-list manually mirrors the union. WS constants also live in core and are duplicated in Vite config.

Evidence:
- Server `decodeClient` casts to `ClientMessage` after checking only the tag.
- Protocol tests are compile-time type assertions, not runtime parse/encode tests.
- The test named around every client message type samples only part of the union.
- `WS_PORT`/`WS_PATH` are exported from core and copied into Vite config with a "Must match" comment.

Suggested deepening: Move runtime schemas or an executable decoder/encoder into the protocol module. Export protocol-owned tag lists and WS constants from that seam. Server and web modules become thin adapters over the protocol interface.

Test opportunities:
- Runtime decode rejects unknown tags, missing required fields, and wrong field types.
- Runtime decode accepts each valid client/server message variant.
- Tag-list tests derive from the protocol seam so server allow-lists cannot drift.
- Vite/server/web import the same constants instead of duplicating them.

### 3. Align Voice Graph Interface With Runtime Behavior

Strength: Strong

Files:
- `packages/core/src/voice/types.ts`
- `packages/core/src/voice/engine.ts`
- `packages/core/src/voice/eval-graph.ts`
- `packages/core/src/voice/engine.test.ts`
- `packages/core/src/voice/types.test.ts`

Problem: The voice graph interface exposes more than the implementation can run safely. MIDI CC trigger sources are authorable but not reachable by the engine, voice `Show`/`TriggerGraph`/`GraphNode` are hand-written rather than schema-derived, and `setModel` replaces geometry without clearing active model-bound voice/generator state.

Evidence:
- `TriggerSource` includes MIDI `cc`, and protocol includes a `cc` message, but the core engine has no CC `InputEvent` and direct resolution only matches note/OSC.
- Comments note CC sources await a CC input event.
- `Show` and graph node types are not zod-inferred, unlike project/kit schemas.
- Tests need large fully populated node helpers because `GraphNode` carries fields for every kind.
- `setShow` resets voices/PRNG/pending fires, but `setModel` only rebuilds model attributes/framebuffer.

Suggested deepening: Add a schema-backed voice show/graph seam with defaults and migrations, then either implement a CC input path or remove/disable CC authoring until it is real. Document and test the `setModel` invariant: either model replacement clears active voices or generator state becomes model-identity-aware.

Test opportunities:
- Minimal parsed fixtures for every node kind.
- Legacy/defaulted graph fields parse into a stable internal shape.
- CC-bound graph behavior, including CC 0 reservation at the adapter seam.
- Active generator-backed voice across model resize remains finite and deterministic, or is explicitly cleared.

### 4. Deepen TriggerLab Store And Edit Interfaces

Strength: Strong

Files:
- `apps/web/src/lib/trigger-lab/store.svelte.ts`
- `apps/web/src/lib/trigger-lab/store/*.ts`
- `apps/web/src/lib/app/views/*.svelte`
- `apps/web/src/lib/app/docks/inspectors/*.svelte`

Problem: The store implementation was split internally, but the external `TriggerLab` interface remains broad: one class exposes around 100 public-ish methods and many UI modules accept the whole store. Read-only viewer policy is repeated as `if (this.isViewer) return` across many mutators.

Evidence:
- `store.svelte.ts` is still the largest source file in the repo.
- Dozens of authoring methods repeat the same viewer guard.
- Row components and tests often construct the real store even when only a tiny command/view-model subset is needed.

Suggested deepening: Keep the rune wrapper, but introduce narrower edit modules or command interfaces at domain seams: show library, section graph edits, patch routing edits, graph node edits, object CRUD. UI modules should receive small view models and command callbacks where practical, with the full store kept at shell-level seams.

Test opportunities:
- Central permission-seam tests prove viewer/editor policy once.
- Component tests use small fake command interfaces instead of real `TriggerLab`, fake WS clients, and localStorage mocks.
- Retain integration tests per mutator family for end-to-end confidence.

### 5. Remove Or Share Dead Duplicate Play-Node Settings Overlay

Strength: Strong

Files:
- `apps/web/src/lib/app/Overlays.svelte`
- `apps/web/src/lib/trigger-lab/ClipSettings.svelte`
- `apps/web/src/lib/trigger-lab/store.svelte.ts`
- `apps/web/src/lib/app/docks/inspectors/PlayNodeInspector.svelte`

Problem: `ClipSettings` is mounted globally and duplicates play-node editing behavior, but `openSettings` appears unused. This is likely dead UI surface, or at minimum a second shallow implementation of the play-node editor.

Evidence:
- `settingsBlock`, `openSettings`, and `closeSettings` exist in the store.
- `ClipSettings` edits effects, presets, params, scope, and envelopes.
- The Inspector path owns the active play-node editing surface.
- Static search found no `openSettings` call sites.

Suggested action: If confirmed dead, remove `ClipSettings`, `settingsBlock`, and `openSettings`/`closeSettings`. If an overlay is still intended, extract one deep play-node editor module and reuse it from both surfaces.

Test opportunities:
- If removed: no new tests beyond gates and import reachability.
- If shared: one editor behavior test seam plus smoke coverage for both adapters.

### 6. Make Patch Graph Projection A Pure View-Model Seam

Strength: Strong

Files:
- `apps/web/src/lib/app/views/PatchGraphView.svelte`
- `apps/web/src/lib/app/patch-topology.ts`
- `apps/web/src/lib/app/patch-graph.ts`
- `apps/web/src/lib/app/docks/patch-inspector.ts`
- `packages/core/src/geometry/pixel-model.ts`

Problem: Patch graph input topology is built once at mount via `untrack`, while output topology has a separate live adoption path. Live kit edits can update the project while the graph topology waits for remount. Web also mirrors core's private pixels-per-hoop formula for readouts.

Evidence:
- `PatchGraphView` comments state the graph is built once at mount for SvelteFlow fit behavior.
- `adoptOutputs` handles only data-line/output nodes.
- `patch-inspector.ts` says `pixelsPerHoopForDrum` mirrors core's private implementation.

Suggested deepening: Move patch graph projection/adoption into a pure module such as `buildPatchGraphViewModel(project, previousPositions)`, with `PatchGraphView` as the SvelteFlow adapter. Export a core geometry helper for effective hoop pixel counts or drum pixel info, and keep web readout modules as adapters.

Test opportunities:
- Projection tests for project arrival after mount, drum geometry changes, output adoption, and position preservation.
- Core tests own pixel-count formula coverage.
- Web tests focus on presentation mapping, not geometry math.

### 7. Surface UDP Adapter Errors At The IO Seam

Strength: Strong

Files:
- `packages/io/src/interfaces.ts`
- `packages/io/src/artnet.ts`
- `packages/io/src/sacn.ts`
- `apps/server/src/output-manager.ts`

Problem: `OutputManager` catches synchronous `send` errors, but real UDP send failures are reported asynchronously and adapter callbacks/socket error handlers are no-ops. The `PixelOutput` interface is deep for fire-and-forget output, but shallow for observability.

Evidence:
- Art-Net and sACN adapters call `socket.send(..., () => {})`.
- Socket `error` handling does not feed `OutputManager.status().lastError`.
- Current output-manager error tests use synchronous fake throws that real UDP adapters do not produce.

Suggested deepening: Preserve non-blocking fire-and-forget output, but add an error callback/event seam or injected datagram adapter so asynchronous send/socket failures reach status without blocking the render loop.

Test opportunities:
- Fake datagram adapter tests for async send errors.
- Socket error tests.
- Broadcast/interface/port application tests.
- OutputManager tests that assert `lastError` reflects real adapter error paths.

### 8. Move Live Server Filesystem Work Behind Async Adapters

Strength: Strong

Files:
- `apps/server/src/static-host.ts`
- `apps/server/src/projects.ts`
- `apps/server/src/handlers/projects.ts`

Problem: Static hosting and explicit project load/save/list use synchronous filesystem calls in the same Node process as the render loop. Autosave is carefully async, but live request handlers still depend on sync IO discipline.

Evidence:
- `serveStatic` uses sync exists/stat/read calls per request.
- Project handlers call sync load/save/list functions.

Suggested deepening: Put static serving and project persistence behind async modules. Keep boot/shutdown exceptions explicit if needed, but live request handlers should stream or await async adapters.

Test opportunities:
- `serveStatic` tests for traversal, missing build, SPA fallback, and asset response behavior.
- Project-handler tests with fake async persistence adapters.
- Ensure async errors surface through server error messages without blocking the render loop.

### 9. Collapse Duplicate Core/Web Trigger Helpers And Offline Sim Behavior

Strength: Worth exploring

Files:
- `packages/core/src/voice/eval-graph.ts`
- `packages/core/src/voice/types.ts`
- `apps/web/src/lib/trigger-lab/sim.ts`
- `apps/web/src/lib/trigger-lab/sim.graph-compilation.ts`
- `apps/web/src/lib/trigger-lab/sim.trigger-source.ts`

Problem: Core and web mirror trigger behavior. Some pure helpers are duplicated (`bandIndex`, `normalizeTriggerValue`), and the offline sim reimplements graph eval/delay/value switch behavior. The codebase already uses a better pattern for `computeDelayMs`: one core implementation imported by web.

Evidence:
- Web comments say helpers are byte-identical mirrors of core.
- Both core and web carry value-switch band tests.
- Web `Sim` uses `Math.random()` for local preview while core uses seeded PRNG.

Suggested action: Export/import pure helpers from core where appropriate. For larger local-preview behavior, decide whether web should use a core `RenderEngine`/null engine adapter, or keep a separate sim with explicit parity tests.

Test opportunities:
- Replace duplicated helper tests with core-owned tests and web import smoke tests.
- If separate sim remains, add parity tests for random/chance/sequence/toggle/delay behavior where user-visible preview must match production.

### 10. Add Stronger DMX Topology Validation

Strength: Worth exploring

Files:
- `packages/core/src/geometry/kit-schema.ts`
- `packages/core/src/geometry/dmx-map.ts`
- `packages/core/src/geometry/dmx-map.test.ts`

Problem: DMX topology validates unknown drums and invalid hoops, but duplicate/overlapping output segments can silently overwrite per-pixel mapping while still adding duplicate universe pixels. `maxPixelsPerOutput` remains in schema despite being advisory.

Suggested deepening: Add a topology validation seam around `OutputConfig`: uniqueness of patched hoops/pixels, duplicate output/data-line ids, and explicit advisory capacity behavior. Remove or clearly mark `maxPixelsPerOutput` if no implementation owns it.

Test opportunities:
- Overlapping segment rejection or deterministic resolution, whichever policy is chosen.
- Duplicate output/data-line ids.
- Capacity warning/advisory behavior.

### 11. Tighten TypeScript And Workspace Tooling Gates

Strength: Strong / Worth exploring

Files:
- `tsconfig.base.json`
- `packages/core/tsconfig.json`
- root `package.json`
- `apps/desktop/package.json`

Problem: The project contract says `packages/core` is platform-agnostic, but the shared TS base includes DOM libs, so core inherits browser globals. Root `lint` is advertised but no package implements `lint`. Desktop is in the workspace graph but outside default test/typecheck gates.

Evidence:
- `tsconfig.base.json` includes `DOM` and `DOM.Iterable`.
- Root `lint` runs `pnpm -r run lint`, but workspace packages define no `lint`.
- Desktop has build scripts but no lightweight JS/typecheck/test gate.
- A no-unused static pass found small stale declarations; no-unused checks are not in normal gates.

Suggested action: Split TS configs by platform: ES-only base, web adds DOM, server/io add Node. Remove or fix root lint. Add a Rust-free desktop check for JS scripts/shell logic. Consider enabling no-unused checks package-by-package after cleanup.

Test opportunities:
- Typecheck should catch accidental DOM usage in pure modules.
- CI/dev command reliability test or documented Corepack/pnpm version enforcement.
- Desktop script pure functions can be unit-tested without Tauri/cloudflared/R2.

### 12. Refresh Docs, Navigation, And Runbooks

Strength: Strong

Files:
- `README.md`
- `PRODUCT.md`
- `.mex/ROUTER.md`
- `.mex/context/*.md`
- `.mex/patterns/INDEX.md`
- `apps/web/src/lib/trigger-lab/NOTES.md`
- `docs/plans/**`
- `docs/prompts/**`
- `docs/handoff/**`

Problem: Operational docs and historical docs are mixed. README and `.mex` context describe old app surfaces, old effect counts, old project persistence, and stale "active" initiatives. The live trigger module is still called throwaway in source-adjacent docs/comments.

Evidence:
- README says 11 effects and old Authoring/Output panel flows.
- `.mex/ROUTER.md` is both bootstrap file and historical initiative log.
- Docs still mention editing a removed/default project seed path, while server boots from `default.local` or `defaultProject()`.
- `trigger-lab` is now live app state, but comments still say throwaway/delete.
- Pattern index only contains an add-effect runbook despite repeated high-risk seams.

Suggested action: Keep current operational docs small and trustworthy. Add `docs/README.md` with current/active/archive sections. Move completed prompts/handoffs into an archive or clearly mark them historical. Update README, setup, persistence docs, product vocabulary, and trigger-lab naming notes. Add runbooks for WS protocol changes, patch routing changes, trigger node changes, desktop packaging, and live spot-checks.

Test/documentation opportunities:
- Add a browser smoke/runbook for graph wiring, drag/refresh, inspector dispatch, read-only roles, and server-persisted show cold-load.
- Keep pure slice tests, but add selected Svelte adapter tests at the component interface.

## Confirmed Small Fix Candidates

These are likely quick wins, but still should be handled through the PRD rather than ad hoc edits:

- Remove dead `ClipSettings` overlay if `openSettings` truly has no live call site.
- Pass `generatorId` through trigger-node effect thumbnails so node thumbnails render generator-backed effects through the same interface as gallery/inspector thumbnails.
- Move `WS_PORT`/`WS_PATH` out of core and stop duplicating them in Vite config.
- Export or centralize effective hoop pixel count instead of mirroring private core geometry in web.
- Replace duplicate `MemStorage` test helpers with a shared test utility.
- Clean no-unused findings and decide whether to enable no-unused checks.

## Notes From The Scan

- No source fixes were implemented.
- A static hygiene subagent accidentally invoked `pnpm -r run lint`; it populated ignored `node_modules` and touched `pnpm-workspace.yaml` metadata, but no content diff remains for that file.
- The existing local changes from this session before the scan are `AGENTS.md` and the `CLAUDE.md` pointer.

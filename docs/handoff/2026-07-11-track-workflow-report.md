# Track W completion report — dynamic Workflow orchestration (remediation experiment, half B)

**Status: COMPLETE.** All 5 slices implemented, merged, per-slice adversarially reviewed, track-level reviewed. `track/workflow` HEAD `e33d66c`, base `1a4ec76` (= completed track/twux tip, per Trent's start-of-track correction — NOT `main` as the handoff originally specified). **Left unmerged — Trent integrates both tracks.** Full sweep green at HEAD: typecheck 0 across all packages; 2588 tests (core 757 / io 54 / protocol 10 / server 290 / web 1477).

Scorecard (the experiment's point) is the Notion child page **"Scorecard — workflow track"** under the spec. Orchestration: 9 dynamic Workflow runs (context fan-out → worktree-isolated implementers → serial orchestrator merges with full sweeps → adversarial review fan-outs → fix run → track-level review), 19 subagents, ~1.54M subagent tokens, ~1h41m active wall-clock (spanned one 5h-window reset).

## What landed (13 commits, 30 files, +1853/−521)

- **S03 — patch edits join the undo stack** (`7ec53b4`): undo entries became `{authored, project}` — the server-owned project slice snapshots in a SEPARATE undo-only field (approach B; the brief's stop-and-ask persistence-coupling premise was resolved from code evidence: `toAuthored()` feeds localStorage + the server show blob, so extending it was foreclosed). Restore assigns `this.project` directly and re-sends only changed slices via new pure `store/project-resync.ts`. `setOutput` added to the snapshot set (orchestrator call — same mutator family, brief omission). +12 tests.
- **S04 — canonical parseHoopTarget + FrameModCtx** (`6138a3a`, `c4a1768`): the 4 drifted parser copies collapse into one core `voice.parseHoopTarget` with behaviour options (sort / emptyFallback zero|sentinel|none / sourceDrumOnNoHash) — all four call sites byte-identical via thin wrappers; the load-bearing `-1`-sentinel vs `[0]`-fallback divergence is preserved, not "fixed". Zero root-barrel changes needed. Compositor's positional `(timeMs,bpm,cc,osc,notes)` tail hoisted into one per-frame `FrameModCtx`. +11 tests. Note: `applyEffectiveParams` stayed positional (its only caller `engine.ts` was cross-track-fenced) — trivial followup.
- **S06 — ControllerStatusPanel split** (`8dc92b9`): `AdoptByIpRow.svelte` + `UniverseRxTable.svelte` extracted as pure presentational composites; takeover/test-pattern stays put. Styleguide DemoCards added reusing existing fixtures; `docs/design-system.html` regenerated in the same change; before/after ui-shots captured and orchestrator-verified pixel-identical. +7 tests.
- **S09 — modulation mutators → pure store slices** (`b518f12`): the last un-split store accretion → `store/mod-graph.ts` + `store/param-envelope.ts` on the value-switch precedent; 12 class methods now thin delegators. Rune coupling resolved per brief: pure fns take the resolved `EffectDef` as a parameter. API-preserving; +22 tests. Review: clean, zero findings.
- **S10 — protocol zod schemas** (`d5bed06` + fix `7abab92`): `packages/protocol/src/schemas.ts` — 56 wire variants (44 client / 12 server) as strict discriminated unions on `t`; `ClientMessage`/`ServerMessage` are now `z.infer` (hand-written unions deleted); `CLIENT_TYPES` deleted; both decoders schema-parse with zero casts. Core schema VALUES reused (outputSchema, projectPatchSchema, projectSchema, enums) — no second definitions. Opaque blobs (`ShowLibraryBlob`/`SongLibraryBlob`, authored `Show`) pass through verbatim via `z.custom` (pinned contract respected). `decodeClient` keeps its exact throw-on-invalid signature so the fenced call sites (`main.ts`, `http/native-midi.ts`) needed zero edits. Zero live traffic mismatches found. Fix run (1 rework loop): the SchemaLocks drift guard was vacuous (`never` assignable to `true` — reviewer proved with tsc repro) → replaced with a real `Equals`/`Assert` idiom across all 12 payload interfaces, trip-verified (deliberate drift → TS2344); plus a dev-only `console.warn` when `decodeServer` drops a known-`t` frame (version-skew diagnosability). +14 tests.

## Key decisions (resolved by orchestrator from spec/code evidence; 0 escalations reached Trent)

1. **S03 approach B** — separate undo-only project snapshot; never extend the persisted `AuthoredState` format.
2. **S10 stays decoupled from S07's validators** even though Track T's S07 module now exists in-tree: `checkRoutingIntegrity`/`validateRouting` need a live `KitConfig` — wrong layer for envelope decode; S01's handler gate stays as defence-in-depth (the brief's own non-goal). S10 reuses only core's schema values.
3. **`state.project` decode stays strict** (reviewer floated a laxer path): strict-drop is the spec's intent — unvalidated patch data caused the original corruption bug. Mitigated by whole-app OTA + the new dev warn.

## Track-level review verdict

Coherent, fence-clean (all 30 files map to slice scopes; zero cross-track files touched). Cross-slice seams verified: S03 resync messages parse against S10's strict schemas field-by-field; S03/S09's shared store restructure has no double/missed undo snapshots; S04 core exports don't collide with S10.

## Followups (ticket these; none blocking)

1. **Undo can't unset optional fields** (track-level find): `project-resync.ts` sends merge-style `setKitTransform`/`setOutput`; JSON drops `undefined` and handlers gate `!== undefined`, so undoing a set-from-unset of `pixelsPerHoop`/`flip`/`port`/`iface` silently fails to converge the engine (local state restores, next broadcast snaps it forward). Fix needs either a null-as-clear wire sentinel (touches fenced handlers + protocol) or whole-slice replace semantics — belongs after track integration. Also: tighten `project-resync.test.ts` to assert convergence, not just emission.
2. Undo stack deep-clones the project per entry at `undoLimit` 10000 — structural sharing is safe (project objects are immutable) or lower the cap.
3. `project-resync.ts` assumes stable drum topology between undo entries (server `adoptProject` mid-session could expose).
4. `applyEffectiveParams` positional tail (needs `engine.ts` in scope).
5. Store-level test mixing trigger+patch undo; `decodeServer` strictness vs future partial-Show/versionless-blob senders (accepted-risk notes); `AdoptByIpRow` dropped an inert `gap:6px`; double-hash `'snare#2#3'` now hits the sentinel (malformed grammar, no producer).

## Harness notes (for the A/B comparison)

- Workflow worktree provisioning twice landed agents on a stale/arbitrary HEAD; both self-corrected because prompts mandated explicit `git checkout -b <branch> track/workflow` + history verification. Bake that into every worktree-implementer prompt.
- Post-merge sweep went red once from a stale `node_modules` (S10 added a direct zod dep) — `pnpm install` after merging lockfile changes, not a code defect. One unrelated `canvas-determinism` flake observed (passed 3× isolated + re-sweep).
- S10's implementer caught an orchestrator prompt error (decodeClient throws; prompt said null-on-invalid) by verifying real call sites — evidence for "brief anchors + verify-against-code" over trusting dispatch prose.
- Usage limit hit once (02:36, dispatching the track review); resumed cleanly at window reset via `twux wake` + saved workflow script.

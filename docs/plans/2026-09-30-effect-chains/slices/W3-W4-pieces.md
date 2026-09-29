# Waves 3–4 — fine-grained pieces for S05 (web store) and S06 (UI)

Every rule in `00-overview.md` applies. Fences here override the parent slice docs. The authoring
contract is `apps/web/src/lib/trigger-lab/effects-api.ts` (`EffectsAuthoringApi`). **Do not change
it.** If it is missing something you need, add it in your own file and report the gap; the
orchestrator reconciles.

## Wave 3 — data pieces (parallel, off the wave-2 integration tip)

| Piece | Parent | Build | Fence |
|---|---|---|---|
| `persist-import` | S05 §1, §5 | v3 show-library / song-library persistence (new storage keys `ledrums:shows:v3`, `ledrums:songs:v2`; never write or delete the old keys) using core `effect-chain/library.ts` types. Boot-library selection: v3, else a seeded fresh library (seed per S05 §1). Pure `legacy-import.ts`: `detectLegacyLibrary(localStorageLike, serverBlob?)` and `importLegacyShows(raw) → v3 shows` (keeps songs / sections / ids / names / bars / bpm, canvasScenes, transport; drops graphs etc.; v1 hoop migration; idempotent). | `trigger-lab/persistence.ts` (ADD v3 functions beside the v2 ones; the store still calls v2 until wiring), new `trigger-lab/legacy-import.ts`, new `trigger-lab/seed-effects.ts`, tests |
| `clipdoc` | S05 §4 | ClipDoc kinds `effect` / `cell` / `device` (builders, parse / coerce, remap of canvas-scene deps). IO-free `applyEffectFile(section, cell, text)` / `applyCellFile` / `applyDeviceFile` returning the new section value plus an `ApplyResult`. | `trigger-lab/clipdoc.ts` (additive), new `trigger-lab/effects-files.ts`, tests |
| `sim` | S05 §3 | The offline `Sim` plays Effect shows by delegating to a core `createVoiceBusEngine` instance (with the Master chain via the engine), keeping the Sim's public API for the store (`triggerGraph` / `recallSection` / frame). Add `fireEffect(id)`. The graph path is unchanged for graph shows. Extend runtime-parity to Effect shows (zone, Always, Clock, master). | `trigger-lab/sim.ts`, `sim.*.ts`, `runtime-parity.test.ts`, new sim tests |
| `show-builder` | S05 §3 | `buildShow` for a v3 authored source uses core `buildRuntimeShow`; the v2 path is unchanged. | `trigger-lab/show-builder.ts` + tests |
| `effects-controller` | S05 §2 | New `trigger-lab/effects-doc.ts`: PURE section mutations for every `EffectsAuthoringApi` mutator (a section in, a new section / result out; fresh ids via the existing `ids.ts`). New `trigger-lab/grid-model.ts`: `gridRows(kit)`, `gridColumns(kit, inputMap)`, `cellSummary(section, cell, …)`. New `trigger-lab/effects-controller.svelte.ts`: an `EffectsController` class implementing `EffectsAuthoringApi` over an injected host (`getSection` / `setSection`, `undo` (push / batch / gesture), `canEdit`, `fire` hooks, `files`, `learn`), modelled on `sections-controller.svelte.ts`. Also `createStandaloneEffectsApi(initialSection, kit)`, an in-memory host for styleguide demos and component tests. | the three new files + tests; no edits to `store.svelte.ts` |

## Wave 4 — wiring and UI (parallel, off the wave-3 integration tip)

| Piece | Parent | Build | Fence |
|---|---|---|---|
| `store-wire` | S05 all | `TriggerLab` implements `EffectsAuthoringApi` by delegating to `EffectsController`. Switch the store to v3: persistence, show-builder, Sim `fireEffect`, file methods (wrapping `effects-files.ts` with `file-io.ts`), import (`legacyImportAvailable`, …), cue learn (midi-controller / osc-learn target `cue`), `effectFireAt` / `cellFireAt`, section follow. Graph API stays compiling (stub / empty) until S08. Tests that asserted replaced graph behaviour are rewritten or deleted and listed (S05 §Tests). | `trigger-lab/store.svelte.ts`, `shows-controller.svelte.ts`, `sections-controller.svelte.ts`, `midi-controller.svelte.ts`, `osc-learn.svelte.ts`, `store/*`, their tests, and minimal compile-keeping edits in `app/**` (listed) |
| `ui-grid` | S06a | per S06a | S06a fence |
| `ui-strip-chain` | S06b (strip, Effect header, Trigger card, Target card, "+" slots, drag-reorder) | per S06b | `app/views/effects/strip/{DeviceStrip,EffectChain,EffectHeader,TriggerCard,TargetCard,AddDeviceSlot}.svelte` + helpers / tests in `strip/`, `styleguide/sections/SectionDeviceStrip.svelte` |
| `ui-strip-cards` | S06b (Generator card incl. Splice / Slice slots, Modifier card incl. mix / envelope, Control card incl. mappings) | per S06b | `app/views/effects/strip/cards/**`, `styleguide/sections/SectionDeviceCards.svelte` |
| `ui-sections-import` | S06c | per S06c | S06c fence |

**UI pieces:**

- Take `api: EffectsAuthoringApi` as a prop or context. Never import `TriggerLab`.
- Demo and test with `createStandaloneEffectsApi`.
- Verify via the styleguide page with ui-shot.
- `ui-strip-chain` renders cards from `strip/cards/` by these names and props:
  - `GeneratorCard { api, effect }`
  - `ModifierCard { api, effectId, modifier }`, where `effectId` may be `MASTER_CELL`
  - `ControlCard { api, effect, control }`

  `ui-strip-cards` must export exactly these. Until they land, `ui-strip-chain` may ship one-line
  placeholders at those paths; the orchestrator resolves them at merge.

## Wave 4 — binding addendum (orchestrator, after the wave-3 merge)

Base: `feat/effect-chains-s05-wave3`. Each piece works on `feat/effect-chains-w4-<piece>` and **pushes** it
(this overrides the overview's "never push"). Commit trailer session: use the one from your harness
attribution reminder.

**Shared rules (all UI pieces)**

- **The api seam.**
  - Components take `api: EffectsAuthoringApi`; the S06 doc's `store={store}` wording is superseded.
  - The store does not implement the contract until `store-wire` merges. At an app mount site, pass
    the store through ONE cast, `store as unknown as EffectsAuthoringApi`, on a line ending
    `// TODO(ec-w4): store-wire`. The orchestrator removes it at merge.
- **Styleguide registration.**
  - Do not commit edits to `styleguide/Styleguide.svelte`.
  - To verify, register your section there locally, capture, then `git checkout -- apps/web/src/lib/styleguide/Styleguide.svelte`
    before committing. The orchestrator registers every section at merge.
- **Your dev port.** Run a web-only preview on a port of your own and point ui-shot at it.
  - Ports: ui-grid 5191, ui-strip-chain 5192, ui-strip-cards 5193, ui-sections-import 5194, store-wire 5195.
  - Start it with `LEDRUMS_WEB_PORT=<port> LEDRUMS_WEB_SHARE=1 pnpm --filter @ledrums/web dev`, run in the background. It binds 127.0.0.1 with a strict port.
  - Capture with `UI_SHOT_BASE=http://127.0.0.1:<port> UI_SHOT_OFFLINE=1 pnpm ui-shot --route "?style" --target "<your section>" --name <piece>-…`.
  - Read the PNGs. Kill YOUR server by its PID when done; never `pkill` by pattern.
  - Never touch port 5173 (Trent's shared server).
- **Dead code.** New files that are unreachable until the orchestrator registers or mounts them are
  expected. List them in your report.

**Piece-specific**

- `ui-strip-chain` ships one-line placeholder cards at `strip/cards/{GeneratorCard,ModifierCard,ControlCard}.svelte`
  with the exact props from the Wave 4 table. At merge, `ui-strip-cards`' real files win.
- `ui-strip-cards` must not create or edit anything under `strip/` outside `strip/cards/`.
- `ui-grid` mounts `EffectsView` in place of `TriggerGraphView`. `EffectsView` renders
  `<DeviceStrip api={api} cell={api.selectedCell} />` from `strip/DeviceStrip.svelte`, with props
  `{ api: EffectsAuthoringApi; cell: CellSelection | null }`. `ui-grid` may ship a one-line
  placeholder there too (ui-strip-chain wins).
- `ui-sections-import`: per-section summaries for sections other than the active one may need data
  the api does not expose. Build a pure helper in your fence (over `EffectsSection` + `grid-model.ts`)
  and report the gap. The import notice and dialog read `api.legacyImportAvailable`,
  `api.legacyShowNames`, `api.importLegacyShows` and `api.dismissLegacyImport`.
- `store-wire` inherits these wave-3 notes:
  - **Ids.** `store/ids.ts` `GENERATED_ID_RE` does not reserve the Effect / device id prefixes that
    `effects-doc.ts` and `effects-files.ts` mint (check the actual prefixes). Reserve them on reload.
  - **Boot.** `bootEffectLibraries` returns `showsFromStorage` / `songsFromStorage` for the rule
    that local data beats the server.
  - **Files.** `effects-files.ts` apply results return `canvasScenes`. Add them to the show in the
    same undo step. Wrap save and load with `file-io.ts`. Master loads go through
    `applyDeviceFile(section, MASTER_CELL, …)`; the api has no `loadFileIntoMaster`, so leave the
    contract unchanged.
  - **Sim.** Use `effectVoiceStats()` for the Layers dock at telemetry rate (it allocates).
    `releaseEffects` needs a note. `setNote` is not forwarded, so pass the note inside `hitEffects`
    so the zone Effect and the Cue fire once each.
  - **Host.** `EffectsControllerHost` needs `kit()` and `inputMap()`, and `files.*` must go through
    `effects-files.ts`.
  - **Tests.** Store tests that asserted replaced graph behaviour are rewritten or deleted, and each
    one is listed in the report.
  - **Previews.** The legacy graph editor may stop rendering sensibly once the store is on v3.
    That is expected; S08 deletes it. Keep it compiling.

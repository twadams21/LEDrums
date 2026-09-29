# S05 — Web authored store, persistence v3, offline Sim, file presets, import

Read first: `00-overview.md`, then the spec sections "Web authoring (store)",
"Persistence, files and import" and "Presets and files", and user stories 10–12, 24, 63–69.

Builds on S01–S04 (core Effect model, compositor, generators, `buildRuntimeShow`, `fireEffect`).

## Goal

The web store authors Effects instead of graphs:

- it persists a v3 show library under new storage keys;
- it builds the runtime Show with core `buildRuntimeShow`;
- it plays offline through the core Effect path;
- it saves and loads effect / cell / device files;
- it can import an old (v2 / v1) library.

No UI components change in this slice, apart from the minimal edits needed to keep them
compiling.

## Build

1. **Authored state v3** (`trigger-lab/persistence.ts` and related).
   - Sections become `{ id, name, bars?, effects: Effect[], master: ModifierDevice[] }`.
   - The show keeps songs, songRefs, canvasScenes, transport fields and paneSizes.
   - `selectedPadKey` is replaced by `selectedCell: { row, column } | null` and
     `selectedEffectId`.
   - New storage keys `ledrums:shows:v3` / `ledrums:songs:v2` (v3 / v2 envelopes). **Never write
     or delete the old keys.**
   - Boot: a v3 library if present, else a fresh library with one show seeded with a small demo
     section. Suggested seed: a kick zone-0 Simple, a snare zone-0 Wave / radial with a Strobe
     modifier, and an Always Gradient at low opacity **(agent-chosen)**.
2. **Store API** (`store.svelte.ts` plus the controllers). Every mutation goes through the
   existing undo transactions, gesture folding, viewer / ownership guards and autosave.
   - Cells: `selectCell`.
   - Effects: `addEffect(cell, generatorKind, style?)`, `removeEffect`, `moveEffect(id, toCell,
     index)`, `reorderInCell`, `renameEffect`, `setEffectBypass`, `setEffectBlend`,
     `setEffectOpacity`, `setRetrigger`, `setAmp`.
   - Generator: `setGenerator(id, kind, style)` (keeps the modifiers / controls / target),
     `setGeneratorParam`.
   - Splice slots: `setSpliceSlots`.
   - Modifiers: `addModifier`, `removeModifier`, `moveModifier`, `setModifierParam`,
     `setModifierMix`, `setModifierEnvelope`, `setModifierBypass`.
   - Controls and mappings: `addControl`, `removeControl`, `setControlSettings`, `addMapping`,
     `setMapping`, `removeMapping`.
   - Target and trigger: `setTarget`; `setTriggerKind(id, kind)`, which moves the cell column;
     `setTriggerSettings`.
   - Cells: `copyCell`, `pasteCell`, `clearCell`.
   - Master chain: `addMasterModifier` and siblings.
   - Audition: `fireEffect(id)`, and `fireEffectAt(index)` (the nth Effect in grid order).
   - Fire flash: `effectFireAt` / `cellFireAt` (replacing `graphFireAt`).
   - Cue MIDI / OSC learn: a new learn-target kind `cue { effectId }` reusing the midi-controller
     and osc-learn machinery and the binding-claims guard.
   - Read models for the UI: `gridRows` (Kit plus drums in kit order), `gridColumns(row)` (zone
     slots from the input map, then always / clock / cue), `cellEffects(cell)`, `cellSummary`.
3. **Runtime and Sim.**
   - `show-builder.ts` uses core `buildRuntimeShow`.
   - The linked path sends `setShow` / `fireEffect` exactly as graphs do today.
   - Offline, the Sim plays the Effect path via core. Prefer delegating to a core
     `createVoiceBusEngine` instance for Effect shows, so parity holds by construction. Justify
     any other choice in the commit body. It must include Always, Clock and the Master chain
     (`applySectionMaster`).
   - Extend runtime-parity to Effect shows.
4. **Files** (`clipdoc.ts`, store file methods, `file-io.ts` reused).
   - New ClipDoc kinds: `effect`, `cell` (a stack) and `device` (generator / modifier / control).
   - Dependencies are remapped for canvas scenes.
   - Store methods: `saveEffectToFile` / `saveCellToFile` / `saveDeviceToFile`, and the load
     equivalents, each with an IO-free `apply*` core for tests.
   - `section` / `song` kinds carry the new section shape.
   - Keep the `graph` / `node` kinds compiling until S08, but they are no longer offered.
5. **Import** (a pure module plus a store method).
   - `detectLegacyLibrary()` finds old data under the old localStorage keys, or the server's v2
     blob delivered in `state`.
   - `importLegacyShows(raw)` makes v3 shows that keep each show's name, songs and sections (ids,
     names, order, bars, bpm), canvasScenes, and bpm / beatsPerBar. Graphs, presets, buses and
     effects are dropped, so sections have empty grids.
   - It runs the existing hoop-id migration if the source is v1. It is idempotent: re-import makes
     no duplicates; keep the source show id where it doesn't collide.
   - Expose `legacyImportAvailable` for the UI (S06c).

## Tests (graph-behaviour tests are replaced here)

This slice deliberately replaces graph persistence, graph show-building and Sim graph resolution.
Tests asserting those behaviours may be rewritten for the Effect path, or deleted when the
behaviour no longer exists. **List every deleted test file or case in the commit body with its
reason.** Graph *editor component* tests stay until S08. If a component no longer compiles
against the store, make the smallest compatibility edit (for example, a stub getter returning
empty graphs), and list it.

## Anchors to verify first

- `TriggerLab` in `store.svelte.ts` (undo: `pushUndoSnapshot`, `batchIntoCurrentUndo`,
  `beginGesture` / `endGesture`; guards; `startAutosave` / `trackDocument`; `syncShowToServer`;
  `followActiveSection`).
- `persistence.ts` (`coerceAuthored`, `loadShowLibrary`, `deserializeShowLibrary`, hoop
  migration).
- `shows-controller.svelte.ts`, `sections-controller.svelte.ts`, `midi-controller.svelte.ts`,
  `osc-learn.svelte.ts`, `show-builder.ts`, `sim.ts` / `sim.*.ts`, `clipdoc.ts`, `file-io.ts`,
  `store/song-library*.ts`.
- `runtime-parity.test.ts`.

## Scope fence

- `apps/web/src/lib/trigger-lab/**` (store, controllers, persistence, sim, show-builder, clipdoc,
  store/*, and their tests)
- New `apps/web/src/lib/trigger-lab/legacy-import.ts`
- Minimal compile-keeping edits elsewhere in `apps/web/src/lib/app/**`, listed in the report

**Non-goals:** any new UI; deleting the graph editor (S08); mappings (S07).

## Acceptance

- Store tests:
  - every API above mutates correctly, one undo step each (a drag folds);
  - viewer guards block edits;
  - `setTriggerKind` moves the cell;
  - copy / paste / clear cells work;
  - `setGenerator` keeps the modifiers.
- Persistence: v3 round-trip; boot with no v3 creates the seed; old keys untouched (asserted).
- Import: a v2 fixture keeps songs / sections / scenes / transport and drops graphs; idempotent
  re-import; a v1 fixture gets the hoop migration.
- Runtime parity: Sim versus engine frames match for an Effect show with zone, Always, Clock and
  master.
- ClipDoc: effect / cell / device round-trip with scene remap; `apply*` loads into a cell.
- Gates: typecheck (whole web app), targeted vitest (trigger-lab), dead-code.

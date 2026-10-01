# Waves 5–6 — fine-grained pieces for S07 (MIDI-map) and S08 (contract removal)

Every rule in `00-overview.md` and the Wave 4 addendum in `W3-W4-pieces.md` applies: push your
branch, use your own dev port, don't commit `Styleguide.svelte`, and report shot presets. The fences
here override the parent slice docs.

## Naming (binding)

`ControlMapping` already exists. It is a Control device's mapping onto a param (S01). A MIDI-map
binding is an **`InputMapping`**: an input source (note / CC / OSC / key) bound to a target
(`fireCell`, `fireEffect`, `recallSection`, `param`, `opacity`, `modifierMix`, `bypass`).

- **Core.** Types and zod live in `packages/core/src/effect-chain/input-mappings.ts`. The
  orchestrator writes the contract.
- **Storage.** Mappings are stored in `AuthoredV3.mappings`, typed `InputMapping[]`. The
  library schema keeps that field lenient (`z.unknown()`): `buildRuntimeShow` validates each
  mapping on its own with `inputMappingSchema` and drops the invalid ones with a diagnostic, the
  way invalid Effects are dropped.
- **Web.** The authoring contract is `apps/web/src/lib/trigger-lab/map-api.ts`
  (`MapModeApi`, written by the orchestrator). **Do not change either contract.** If one is
  missing something, report the gap.
- **Attachment.** `mappable` is exported from `apps/web/src/lib/app/map-mode/mappable.svelte.ts`:
  `mappable(spec: MappableSpec)`, a Svelte attachment. Its types are in `map-api.ts`.

## Wave 5a — core + map-mode shell (parallel, off the wave-4 integration tip)

| Piece | Parent | Build | Fence |
|---|---|---|---|
| `core-mappings` | S07a | Pure matching (`matchInputMapping`) and engine input precedence: global control > mapping > zone. A consumed input doesn't reach zones or cues. Discrete targets fire or recall. Continuous targets (`param`, `opacity`, `modifierMix`) become per-frame modulation on the live voices of the matching Effect, scaled into `[rangeMin, rangeMax]`. Add engine support for opacity / mix modulation if needed, and document how. Runtime Show carries mappings (`buildRuntimeShow`). Server host passes them through; precedence is tested. Sim parity (the Sim delegates to the engine, so this is expected to come free — prove it with a parity test). | `effect-chain/input-mappings.ts` (implementation beside the contract types), `effect-chain/runtime.ts`, `effect-chain/resolver.ts`, `voice/engine.ts`, `apps/server/src/voice-engine-host.ts`, `apps/server/src/handlers/*`, `trigger-lab/sim.ts` (only if parity needs it), `runtime-parity.test.ts`, tests |
| `binding-claims` | S07a | Mappings join the binding-claims guard: a new `mapping` claim kind. A mapping source that collides with a zone note, a global control, the reserved CC or another mapping is rejected, with a structured reason the UI can format. Cue triggers share addresses with zones by design. A mapping colliding with a cue IS rejected, since the mapping would starve the cue. Export `inputMappingConflicts(scope, source, selfTargetId)`. | `voice/binding-claims.ts` + tests (and its core index export if it has none) |
| `map-mode-ui` | S07b | Shell `mapMode` flag. TopBar "MIDI" toggle (icon + tooltip, `--map` orange when on) and shortcut (propose `mod+m`; check `shortcuts.ts`). The `mappable` attachment and a registry. The map-mode overlay: outline and badge per registered control, unmappable UI dimmed, a capture layer so clicks arm instead of act, armed pulse, Delete / Backspace clears, Escape exits, a refused binding shows its reason and stays armed. Key learn: a learn-first branch in `dispatchAppKeyboard` (after the editable-target check, respecting modal ownership). Keyboard mappings fire outside map mode, but yield to editable targets and keyboard owners. `--map` token, passing `pnpm contrast-check`. `SectionMapMode.svelte` covers idle / armed / mapped / conflict against an in-memory `MapModeApi` fixture. Shot-seam op `map-mode[:armed]`. | `app/map-mode/**` (new), `app/shell-store.svelte.ts`, `app/shell-nav.ts`, `app/chrome/TopBar.svelte`, `app/app-keyboard.ts`, `app/shortcuts.ts`, `app/shot-seam.ts`, `app/AuthorShell.svelte` (overlay mount only), `styles/tokens.css`, `styleguide/sections/SectionMapMode.svelte`, tests |

## Wave 5b — store + attachments + first deletions (parallel, off the wave-5a integration tip)

| Piece | Parent | Build | Fence |
|---|---|---|---|
| `store-mappings` | S07a / S07b | `TriggerLab implements MapModeApi`. It covers the mapping CRUD with undo, conflict refusal via `inputMappingConflicts`, the MIDI / OSC learn target `map` (midi-controller / osc-learn), the key-mapping resolution the web performs, and bypass-toggle targets. Bypass toggles are applied by the store when the input echo arrives (linked) or local MIDI fires (offline), as an undo step. | `trigger-lab/store.svelte.ts`, `trigger-lab/midi-controller.svelte.ts`, `trigger-lab/osc-learn.svelte.ts`, `trigger-lab/store/*`, tests |
| `map-mode-apply` | S07b | Apply `mappable` (one attribute each) to grid cells (`fireCell`), Effect / Modifier bypass toggles, Effect opacity and Modifier mix faders, every generator / modifier face param (`param`), section chips (`recallSection`), and the song / section nav arrows and other global-control buttons (`globalControl`, written through the existing `inputMap.globalControls` learn machinery). Capture map mode over the Effects view with ui-shot. | the receiving components under `app/views/effects/**`, `app/chrome/*` (nav arrows / section chips), `app/views/Section*.svelte`, tests |
| `delete-graph-editor` | S08 (web UI) | Delete the graph editor UI:<br>• `TriggerGraphView`, `TriggerGraphsRail`, `TriggerNode`, `GraphCanvas`, `AddNodePopover`, `AddGraphDialog`, `InspectorSlideover`;<br>• the wire / lint / align / flow / drop helpers and their tests;<br>• node inspectors with no Effect-card use, and the orphaned Patch-graph components;<br>• `GraphPickerDrawer` / `LinkPlacementDialog`;<br>• the `node` selection kind and its users;<br>• the unmounted `graph` lazy-view entry;<br>• `SectionGraph` / `GraphDemoNode` and the now-unused NodeCard / lint demos, with the stale "Trigger Graph" / "digits fire graphs" styleguide copy fixed;<br>• the graph shot-seam ops and dead `shots.json` presets (list them; repoint the ones that still make sense);<br>• `@xyflow/svelte`.<br>Do NOT touch the store's graph API (wave 6a). | graph-editor components and helpers under `apps/web/src/lib/app/**`, `apps/web/src/lib/styleguide/**` (except `Styleguide.svelte`: report the registry lines to remove), `scripts/ui-shot/shots.json` (THIS piece owns it this wave), `apps/web/package.json`, `pnpm-lock.yaml` |
| `delete-merged-effects` | S08 (generators) | Delete the merged-away effect implementations (wave-collapse, follow-hoop, deprecated chase / burst / colour-melody), plus strobe / sidechain as generators, wherever no Style references them. Keep effect aliases only where an import path still needs them. Update `coverage.test.ts` `EXCLUDED`. | `packages/core/src/effects/**` for those ids, the effects registry, `effect-chain/generators/coverage.test.ts`, tests |
| `docs-domain` | S08 (docs) | `CONTEXT.md` glossary: add Effect, Generator, Style, Modifier, Control, Target, Cell, Stack, Master chain, MIDI-map mode and InputMapping; retire the graph terms. Update `.mex/context/architecture.md`. Add `.mex/patterns/add-generator-style.md` and `add-modifier.md`. Mark the Gen3 graph PRD docs superseded (a header line; no deletions). | `CONTEXT.md`, `.mex/context/**`, `.mex/patterns/**` (not `ROUTER.md`), `docs/**` PRD headers |

## Wave 6 — contract (serial; each off the previous tip)

| Piece | Parent | Build | Fence |
|---|---|---|---|
| `delete-graph-store` (6a) | S08 (web store) | Delete from the web store:<br>• the graph / node API and graph persistence;<br>• the v1 / v2 read paths, EXCEPT inside `legacy-import.ts`, which must keep importing v1 / v2 (inline or move what it needs);<br>• the `graph` / `node` ClipDoc kinds;<br>• graph fixtures and templates;<br>• graph-only Sim code;<br>• the `// TODO(ec-w4)` graph-era leftovers. | `apps/web/src/lib/trigger-lab/**`, `apps/web/src/lib/app/**` compile-keeping edits (listed) |
| `delete-graph-core` (6b) | S08 (core / server / protocol) | Delete from core:<br>• graph eval, the render plan, graph integrity and lints;<br>• modifier-graph and modulation-graph resolution, the runtime slot grid;<br>• the routing / mix node code;<br>• the graph types and `Show.graphs` / `buses` / `effects` / `presets` / `sections` where no longer needed.<br>Also delete `fireGraph` across the engine, protocol and server, and the server's v2 restore path. **Keep** everything below `PlayAction` and the splice / slice machinery. The legacy Composition engine is out of scope. | `packages/core/**`, `packages/protocol/**`, `apps/server/**`, plus minimal web compile edits (listed) |

## Acceptance (orchestrator, per wave)

- **Every wave:** typecheck, the full serial sweep, `pnpm dead-code:verify` in CI, and ui-shot on
  the affected presets.
- **After 6b:** no `TriggerGraph` / `@xyflow` / `fireGraph` reference remains outside
  `legacy-import.ts` and historical docs, and `ui-shot --all --strict` is clean.

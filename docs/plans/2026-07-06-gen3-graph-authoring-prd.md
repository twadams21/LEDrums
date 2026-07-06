# Gen3 Graph Authoring PRD

## Problem Statement

The Trigger graph has outgrown its current node vocabulary and Add Node flow. “Play” nodes are becoming Effect nodes, old Output nodes now represent scope, and new authored graphs need a required terminal Output anchor so routes only render when intentionally wired to output. At the same time, the graph authoring surface needs to support richer modulation sources, route mixing, scoped LED filtering, precise slider entry, and faster section arrangement.

The current UI also makes node creation too flat: it mixes effects, route logic, modulation, modifiers, and output concepts in one list. Operators need a compact two-stage Add Node panel that shows node options as the same visual objects they will place on the canvas, while preserving the dense, signal-flow-first product feel.

## Solution

Introduce Gen3 Trigger graphs with explicit graph versioning, canonical node names, strict route-to-output rendering, and a richer graph-authoring UI.

Gen3 graphs use Effect, Route, Modulate, and Modify language. Legacy `play` nodes migrate to Effect nodes. Legacy scoped `output` nodes migrate to Scope nodes. Every Gen3 graph has exactly one visible, movable, non-deletable Output anchor. Routes render only when they reach Output. Scope nodes are route filters: they narrow the active pixel set by intersection and never broaden it.

The Add Node panel becomes a two-stage surface: a sticky compact 2x2 category chooser at the top, and a scrollable Stage 2 area below. Stage 2 starts empty until a category is selected, then shows actual node-card previews with hidden handles, title, tight description, and meaningful thumbnails/previews. Users can click or drag these previews to add nodes.

The graph model gains separate CC, Note, and OSC modulation source nodes; Random modulation gains a Distribution dropdown; modifiers gain Slice; routes gain Scope and Mix. Mix blends rendered upstream route buffers with one blend mode and per-input opacity. Scope gets a full inspector with whole-kit toggle, drum/hoop preview, multi-hoop selection within one drum, 1-indexed UI labels, and effective-scope readout.

All app numeric sliders move to editable numeric value inputs via the shared slider primitive. Sections view gains Ctrl/Cmd+D duplication for the selected section plus drag/drop to reorder sections, reorder graphs within a section, and move graphs between sections. Shortcuts must use platform equivalents: Ctrl on Windows/Linux and Cmd on macOS.

## User Stories

1. As a rig builder, I want Play nodes renamed to Effect nodes, so that the graph vocabulary matches what the node creates.
2. As a rig builder, I want old Output nodes migrated to Scope nodes, so that output termination and LED scoping are not conflated.
3. As a rig builder, I want every Gen3 graph to contain one Output anchor, so that rendering has an explicit terminal.
4. As a rig builder, I want routes that do not reach Output to render nothing, so that corrupted or half-authored graphs do not unexpectedly emit light.
5. As a returning user, I want legacy graphs migrated automatically, so that old authored shows remain usable without manual repair.
6. As a returning user, I want legacy unconnected Play nodes automatically connected to Output during migration, so that previous audible/visible behavior is preserved intentionally.
7. As a developer, I want graph versioning to differentiate old `output` from new `output`, so that migrations are deterministic.
8. As a graph author, I want Trigger and Output to be visible anchors, so that I can read the full signal path.
9. As a graph author, I want Trigger and Output anchors to be movable but not deletable, so that I can organize the canvas without breaking required graph structure.
10. As a graph author, I want Scope nodes to filter routes by strict intersection, so that cascaded scopes behave predictably.
11. As a graph author, I want parallel Scope branches for disjoint drum targets, so that I can target snare and kick hoops independently.
12. As a graph author, I want whole-kit Scope to be a no-op filter, so that it communicates intent without resetting earlier scopes.
13. As a graph author, I want Scope inspector to show effective scope, so that I can diagnose why a route is or is not rendering.
14. As a graph author, I want hoop labels to be 1-indexed in the UI, so that drum hoop selection matches human language.
15. As a graph author, I want the Add Node panel split into categories and options, so that node creation is faster and less noisy.
16. As a graph author, I want Stage 1 to be sticky and compact, so that category switching stays available while browsing options.
17. As a graph author, I want Stage 2 to start empty, so that the Add pane does not overwhelm me before I choose a category.
18. As a graph author, I want Stage 2 options shown as real node previews, so that the thing I add matches what appears on the canvas.
19. As a graph author, I want node previews to hide handles in the Add pane, so that palette items do not look wired before placement.
20. As a graph author, I want click-to-add and drag-to-add, so that I can add quickly or place precisely.
21. As a graph author, I want the whole Add/Inspector drawer to be resizable, so that dense node cards and inspector controls can breathe when needed.
22. As a graph author, I want Effect options grouped under Effect, so that content-producing nodes are easy to find.
23. As a graph author, I want Random, Sequence, Switch, Chance, Toggle, Delay, Scope, and Mix under Route, so that signal-flow logic is in one place.
24. As a graph author, I want Envelope, LFO, CC, Note, OSC, and Random under Modulate, so that parameter drivers are in one place.
25. As a graph author, I want modifiers grouped under Modify, so that post-effect transforms remain distinct from effect content.
26. As a graph author, I want Envelope creation presets for Pluck, Stab, Swell, Gate, and Custom, so that common shapes start from useful defaults.
27. As a graph author, I want LFO creation presets for Sine, Triangle, Saw, Square, and Sample & Hold, so that common waves are one click away.
28. As a graph author, I want Envelope and LFO presets to be editable after creation, so that presets are starting points rather than separate node types.
29. As a graph author, I want Modulate nodes to keep visible handles, so that modulation wiring remains possible and legible.
30. As a graph author, I want CC, Note, and OSC as separate modulation source nodes, so that each live control type is explicit.
31. As a graph author, I want Note modulation to output note gate or velocity, so that MIDI notes can drive parameters without being trigger routes.
32. As a graph author, I want Note modulation to support note, channel/omni, mode, and release, so that it can be precise or performance-friendly.
33. As a graph author, I want Random modulation to support distributions, so that random parameter movement can be shaped.
34. As a graph author, I want Linear to be the default Random distribution, so that existing random behavior remains predictable.
35. As a graph author, I want Gaussian, Exponential, Logarithmic, Triangular, Beta, and Stepped distributions, so that common random behaviors are available.
36. As a graph author, I want Stepped random to expose step count, so that quantized modulation can be tuned.
37. As a graph author, I want a Slice modifier, so that LED strips can be chopped into pixel bands and reordered.
38. As a graph author, I want Slice band width in pixels, so that the modifier maps directly to strip LEDs.
39. As a graph author, I want Slice shuffle to be deterministic per voice, so that a route does not flicker unpredictably every frame.
40. As a graph author, I want Mix nodes to blend rendered upstream routes, so that parallel looks can combine before continuing downstream.
41. As a graph author, I want Mix to accept unlimited inputs, so that complex route stacks are not artificially capped.
42. As a graph author, I want one blend mode per Mix node, so that the blend behavior is clear.
43. As a graph author, I want one opacity per incoming Mix wire, so that each route can be weighted independently.
44. As a graph author, I want Mix input rows on the node card, so that incoming layers are visible like parameter rows.
45. As a graph author, I want Mix layer rows ordered by upstream node vertical position, so that canvas layout communicates layer order.
46. As a graph author, I want Mix layer row order to update while dragging nodes, so that the visual order stays live and understandable.
47. As a graph author, I want handle circles centered on node edges, so that wiring looks precise and professional.
48. As a graph author, I want Scope to select whole kit, whole drum, or one/more hoops of one drum, so that common targeting workflows are fast.
49. As a graph author, I want the Scope drum preview to show kick sideways and other drums upright, so that the preview resembles the physical kit.
50. As a graph author, I want to click a hoop to select it and Ctrl/Cmd-click to multi-select, so that selection matches standard desktop behavior.
51. As a graph author, I want a Whole Drum button, so that all hoops of a drum can be selected quickly.
52. As an operator, I want all numeric sliders to include editable text input, so that I can enter precise values.
53. As an operator, I want slider text input to clamp and sanitize values, so that invalid numeric input does not corrupt settings.
54. As an operator, I want slider dragging and typing to stay synchronized, so that the control always reflects the actual value.
55. As a show author, I want Ctrl/Cmd+D to duplicate the selected section, so that arranging repeated song parts is fast.
56. As a show author, I want drag/drop to reorder sections, so that the song arrangement can be edited directly.
57. As a show author, I want drag/drop to reorder graphs within a section, so that section graph order is easy to adjust.
58. As a show author, I want drag/drop to move graphs between sections, so that I can reuse or reorganize graph assignments quickly.
59. As a macOS user, I want Cmd shortcuts wherever Windows uses Ctrl, so that the app behaves like a native Mac tool.
60. As a Windows user, I want Ctrl shortcuts, so that the app behaves like a native Windows tool.

## Implementation Decisions

- Add graph versioning to the Trigger graph data model. Unversioned graphs are treated as legacy Gen2.
- Gen3 graph migration rewrites legacy `play` nodes to canonical `effect` nodes.
- Gen3 graph migration rewrites legacy scoped `output` nodes to `scope` nodes before introducing the new terminal `output` anchor.
- Gen3 graph migration appends exactly one terminal Output anchor and connects existing render leaves to it.
- Gen3 schema enforces at least one Trigger anchor, exactly one Output anchor, no persisted `play` nodes after hydrate, and at most one terminal Output node.
- Stable string discriminants remain the graph kind identity mechanism. Renames use alias/migration maps rather than opaque type ids.
- Trigger and Output are anchor nodes: selectable and movable, but not deletable or duplicable.
- Effect is the canonical content-producing node term. `play` remains only as a legacy serialized alias accepted by migration.
- Scope is a Route node. It is addable from Route, not Output.
- Scope filters are strict pixel-set intersections. Scope never broadens the active route set.
- Whole-kit Scope is a no-op filter, useful for user knowledge but not a reset.
- User-facing hoop labels are 1-indexed. Internal serialized target ids may remain zero-based for compatibility.
- The Add Node panel has a sticky compact 2x2 Stage 1 top section and scrollable Stage 2 bottom section.
- Stage 2 starts empty and resets when Add is switched to Inspector or the user navigates away.
- Stage 2 node options reuse the real node-card visual language in a palette preview mode with handles hidden.
- Stage 2 previews include meaningful thumbnails/previews where available and a stable thumbnail slot where useful.
- Add options support both click-to-add and drag/drop placement.
- The Add/Inspector drawer as a whole is resizable.
- Envelope and LFO Stage 2 options are creation presets on stable node kinds, not distinct node kinds.
- CC, Note, and OSC are separate modulation source node kinds.
- Existing CC nodes configured for OSC migrate to OSC nodes. Existing MIDI CC nodes remain/migrate to CC.
- Note modulation is a modulation source only, not a new Trigger source model.
- Note modulation outputs note gate or velocity with note, channel/omni, mode, and release controls.
- Random modulation distribution options are Linear, Gaussian, Exponential, Logarithmic, Triangular, Beta, and Stepped.
- Random modulation exposes only Distribution plus step count for Stepped in this slice.
- Slice is a modifier, not an effect.
- Slice band width is in pixels, with jitter/spread expressed as a ratio.
- Slice shuffle order is deterministic per voice and stored in modifier state until relevant params/range change.
- Mix is buffer-level route composition, not a selector or downstream action router.
- Mix has unlimited incoming effect-flow wires, one output, one blend mode, and per-input opacity.
- Mix input rows are edge-backed layers stored on incoming edges, sorted visually by source node vertical position.
- Trigger graph node positions update live during drag for Mix layer ordering, while persistence remains debounced/coalesced.
- All numeric slider value labels become editable numeric inputs through the shared slider primitive.
- Slider input commits on Enter/blur, reverts or rejects invalid input, and clamps to min/max.
- Sections view uses list drag/drop, not xyflow, for section and graph-row movement.
- Ctrl/Cmd+D duplicates only the selected section.
- Cross-platform shortcut handling must map primary modifier to Ctrl on Windows/Linux and Cmd on macOS.

## Testing Decisions

- Test at the highest stable seams: graph migration/hydration, pure graph evaluation, compositor/route rendering behavior, store mutators, shared UI primitives, and focused component behavior where required.
- Migration tests should assert Gen2/unversioned graphs become Gen3 with Effect, Scope, one Output anchor, and migrated render-leaf wiring.
- Schema/integrity tests should reject or sanitize duplicate Output anchors, persisted `play` kinds, duplicate ids, dangling edges, and illegal anchor deletion.
- Eval/render tests should assert unconnected Effect nodes do not emit in Gen3, migrated legacy render paths still emit through Output, and Scope intersections produce expected pixel sets including empty intersections.
- Scope tests should cover whole-kit no-op, whole drum, multi-hoop within one drum, disjoint parallel branches, and 1-indexed display helpers.
- Add pane tests should cover reset-on-close/navigation, Stage 1 temporary selection, Stage 2 empty state, click add, and drag add.
- Modulation tests should cover CC/OSC migration, Note source sampling, Random distribution determinism, and Stepped step count.
- Slice tests should cover deterministic band construction, pixel-unit widths, jitter bounds, shuffled order stability across frames, and state rebuild on param/range changes.
- Mix tests should cover unlimited inputs, blend modes, per-edge opacity, edge-backed row identity, y-position ordering, and live drag reorder projection.
- Slider primitive tests should cover typed commit, clamp, invalid input revert, unit display, disabled state, and bind/onChange synchronization.
- Sections tests should cover Ctrl/Cmd+D section duplication, section reorder, graph reorder within a section, graph move between sections, and shortcut primary-modifier behavior.
- UI verification must include `pnpm ui-shot` captures for the affected graph Add pane, Scope inspector, Mix node, slider input, and Sections drag/drop surfaces.
- Because UI is touched, apply the `make-interfaces-feel-better` skill during implementation and regenerate `docs/design-system.html`.

## Out of Scope

- Plugin-style external node registries or opaque node type ids.
- Multiple terminal Output anchors per graph.
- Scope nodes that target hoops across multiple drums in one node.
- Broadening/resetting scope after a narrower upstream Scope.
- Shape controls for non-Stepped Random distributions.
- Xyflow for Sections view list interactions.
- Duplicating selected graph rows with Ctrl/Cmd+D.
- Reworking Trigger source semantics beyond keeping the existing trigger-source editor.
- Hardware output protocol changes.

## Further Notes

- The implementation should land on a new dev branch stacked on `codex/perf-output-node-routing`.
- Suggested phase order:
  1. Gen3 graph migration and schema invariants.
  2. Add pane v2 and drawer resize.
  3. Modulation split and Random distribution.
  4. Scope inspector/preview/effective readout.
  5. Slice modifier.
  6. Mix node buffer composition and live layer ordering.
  7. Shared slider editable numeric input.
  8. Sections Ctrl/Cmd+D and drag/drop arrangement.
  9. Design-system regeneration, UI shots, and GROW docs.

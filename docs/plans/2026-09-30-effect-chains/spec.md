# Spec — Effect chains: grid, device strip and MIDI-map mode

Status: ready-for-agent · Date: 2026-09-30 · Branch: `feat/effect-chains` (off `origin/main` at `07ecb048`)

Source of every decision below: Trent, in the 2026-09-29/30 planning session on Trent's MacBook
Pro, answering a structured Q&A, building on a voice note from Tim that Trent relayed. Items marked
**(agent-chosen)** were decided by the planning agent to fill a gap, not by Trent or Tim, and may be
revisited. The GPU particle prototype (`spike/particle-world`) is a separate experiment and is
**not** part of this work.

## Problem Statement

Building a strong look in LEDrums is hard.

- **Too many near-duplicate effects.** There are 54 effect generators, and many are variations of
  each other: chase / chase-bands / orbit-comet, wave-collapse / radial-wash, whole-kit /
  whole-drum / burst, and so on.
- **Effects are not malleable.** Many have a fixed character. For example, Strobe has no fade, no
  envelope, and can only strobe to black, not between two colours.
- **The canvas graph is a hard way to build a look.** You can wire nodes freely, but "stacking
  things on top of each other" often doesn't combine the way the performer expects.
- **There is no clear split between making light and changing light.** Strobe exists both as an
  effect that makes its own light and as a modifier that chops incoming light.
- **Editing is indirect.** You select a node on a canvas, then edit its params in a slide-over
  inspector somewhere else.
- **No generic way to drive the app from a controller.** Global controls and zones have their own
  Learn buttons, but you cannot map an arbitrary button or knob to a MIDI note, CC, OSC address or
  computer key.

## Solution

Replace the per-section canvas trigger graph with a linear, Ableton-style **Effect chain** model.
This is the only authoring change: the kit, patch and outputs, input map, songs and sections, and
transport carry over unchanged.

- **Effect.** An Effect is a linear chain: **Trigger → Generator (pick one from a short list) →
  Modifiers (ordered) → Target**. Control devices (Envelope, LFO, Velocity, Random, CC) can be
  added to the chain and mapped to any parameter of any device in it. Every Effect has a built-in
  amplitude envelope (ADSR). Every Modifier has a Mix amount and its own envelope.
- **Grid.** Each section is edited as a grid:
  - **Rows:** a **Kit** row plus one row per drum.
  - **Columns:** each drum's input **zones**, then three trigger columns, **Always**, **Clock** and
    **Cue**.
  - **Cells:** each cell holds a **stack** of Effects. The grid replaces the old graph list.
  - **Master:** a **Master** cell in the Kit row holds the section's master modifier chain, which
    is applied to everything the section renders.

  ```
              Zone 1   Zone 2   Zone 3 │ Always  Clock  Cue
    Kit         —        —        —    │   ●       ·     ·      (+ Master)
    Kick        ●        ·        ·    │   ·       ●     ·
    Snare       ●        ●        ·    │   ·       ·     ·
    Tom 1       ●        ·        ·    │   ·       ·     ·
    Tom 2       ●        ·        ·    │   ·       ·     ·
  ```
- **Device strip.** Clicking a cell shows its Effect stack in an Ableton-style **device strip**
  along the bottom of the screen. Each Effect is a left-to-right row of device cards, and **every
  setting is on the card face**. There is no select-then-edit-elsewhere.
- **Generators.** About 54 effects collapse into 9 Generators plus Splice and Slice, each with a
  Style choice and parameters. "Changing light" effects (strobe, sparkle and similar) live only as
  Modifiers.
- **MIDI-map mode.** An Ableton-style mode: toggle it, and every mappable control turns orange.
  Click one, then press a MIDI note or CC, send an OSC address, or press a computer key, and that
  input is learned for the control. This covers buttons, toggles, knobs and sliders.
- **Presets.** Presets are save-your-own only, through Tim's existing save/load-to-file feature. It
  is extended to Effects, cell stacks and single devices.
- **Showfiles.** The new version uses a new showfile format. An **Import** action brings an older
  show's kit, patch, inputs, transport, songs and sections across, with no Effects. Old graphs are
  dropped.

## User Stories

### Grid and navigation

1. As a performer, I want each section shown as a grid of drums (rows) by zones and trigger types
   (columns), so that I can see at a glance what each hit does.
2. As a performer, I want a Kit row, so that I can author kit-wide Effects that aren't tied to one
   drum.
3. As a performer, I want Always / Clock / Cue columns next to the zone columns, so that non-hit
   triggers sit in the same mental model as zones.
4. As a performer, I want a cell's zone columns to come from that drum's configured zones in
   Settings, so that the grid always matches my input map.
5. As a performer, I want cells that don't apply (such as zone columns on the Kit row, or a zone
   slot the drum doesn't have) shown as disabled, so that I don't try to author into them.
6. As a performer, I want to click a cell to select it and see its Effects in the bottom strip, so
   that editing is one click away.
7. As a performer, I want each cell to show whether it has Effects, how many, and a live fire
   flash when it triggers, so that the grid doubles as a monitor.
8. As a performer, I want the grid to follow the active section (sections bar and recall), so that
   what I edit is what plays.
9. As a performer, I want to add an Effect to an empty cell with one click, starting from a
   Generator picker, so that authoring a new hit is fast.
10. As a performer, I want to copy and paste a cell (its whole stack) to another cell or section,
    so that I can reuse looks.
11. As a performer, I want to clear a cell, so that I can remove a hit's look entirely.
12. As a performer, I want keys 1–9 and 0 to audition the section's Effects in grid order, so that
    I can preview without a drum.

### Effect chain and device strip

13. As a performer, I want an Effect laid out left to right as Trigger · Generator · Modifiers… ·
    Controls · Target cards, so that the signal flow reads like an Ableton device chain.
14. As a performer, I want every parameter editable directly on its device card, so that I never
    have to select something and edit it elsewhere.
15. As a performer, I want a cell's stack of Effects shown in the strip (one chain per Effect, in
    stack order), so that I can layer several looks on one hit.
16. As a performer, I want to reorder Effects within a cell's stack, so that I control layering.
17. As a performer, I want per-Effect blend mode and opacity, so that stacked Effects combine the
    way I intend instead of always adding.
18. As a performer, I want per-Effect bypass (mute), so that I can A/B layers.
19. As a performer, I want to add, remove, reorder and bypass Modifiers in the chain, so that I can
    shape the generated light.
20. As a performer, I want to swap an Effect's Generator without losing its Modifiers and Target,
    so that I can try sources quickly.
21. As a performer, I want to rename an Effect, so that my stacks are readable.
22. As a performer, I want a live thumbnail on the Generator card, so that I can see the source
    before it hits the kit.
23. As a performer, I want the device strip to scroll horizontally when a chain is long, and cards
    to stay a readable fixed width, so that long chains stay usable.
24. As a performer, I want undo and redo to cover every grid and strip edit, with a drag counting
    as one step, so that I can experiment safely.

### Triggers

25. As a performer, I want a zone cell's Effect to fire when that drum's zone is hit, so that hits
    map naturally.
26. As a performer, I want an Always Effect to run for as long as its section is active, and fade
    in and out on section change, so that I can author base looks.
27. As a performer, I want a Clock Effect to fire on the transport (every beat, bar, or N beats,
    with an offset), so that I can author tempo-locked accents.
28. As a performer, I want a Cue Effect to fire from a specific MIDI note or CC, or an OSC address
    (for example from Ableton), so that external cues drive looks.
29. As a performer, I want the Trigger card to show and edit that trigger's settings (zone, clock
    division, cue source), so that everything about "when" is in one place.
30. As a performer, I want to change an Effect's trigger type from its Trigger card, which moves
    the Effect to the matching column, so that the grid and the chain never disagree.
31. As a performer, I want a per-Effect retrigger setting (Overlap / Restart / Ignore while
    playing), so that I control what repeated hits do.
32. As a performer, I want hit velocity to shape the Effect's brightness by default, so that
    dynamics read on the kit.

### Generators

33. As a performer, I want a short Generator list (Solid, Gradient, Wave, Noise, Particles,
    Pattern, Meter, Lightning, Scene, plus Splice and Slice), so that choosing a source is quick.
34. As a performer, I want each Generator to have a Style choice (for example Wave: chase / wipe /
    radial / ripple / spiral / helix / tunnel / orbit / sonar / field …), so that one Generator
    covers many old effects.
35. As a performer, I want the Generator card to show only the parameters relevant to the chosen
    Style, so that the card stays uncluttered.
36. As a performer, I want Splice (and its Slice sibling) to keep all of Tim's recent behaviour
    (partition, count, chase, move around, move through, order, wait modes, per-slot colours or
    sources), so that nothing he built is lost.
37. As a performer, I want Splice / Slice slots to hold either a colour or another Generator, so
    that splices still cut several looks together.
38. As a performer, I want the Scene generator to play an authored canvas scene, so that existing
    scene documents stay usable.

### Modifiers

39. As a performer, I want Modifiers to transform the light from earlier in the chain, never make
    their own, so that "make light" and "change light" are clearly separate.
40. As a performer, I want every Modifier to have a Mix (dry/wet) amount, so that I can blend any
    modifier in partially.
41. As a performer, I want every Modifier to have its own optional envelope (attack / decay /
    sustain / release over the Effect's life), so that, for example, a strobe can run for only
    part of a hit.
42. As a performer, I want Strobe to strobe between the incoming light and a second colour, or a
    dimmed version of the input, not just black, so that strobes can be two-tone.
43. As a performer, I want Strobe to have a fade (soft flash edges or per-flash decay), so that
    strobes can be smooth as well as hard.
44. As a performer, I want all existing Modifiers (trail, bloom, sparkle, grain, strobe, echo,
    pixelate, mirror, hue-shift, levels, slide, blur, posterize, feedback, kaleidoscope, freeze,
    flicker, chromatic, slice) available in the chain, so that no capability is lost.
45. As a performer, I want a section Master chain of Modifiers that applies to the whole section's
    rendered output, so that I can strobe, blur or colour everything at once.

### Controls and modulation

46. As a performer, I want every Effect to have a built-in amplitude envelope (attack, decay,
    sustain level, length or hold, release), so that I shape each hit's life without extra
    devices.
47. As a performer, I want to add Envelope, LFO, Velocity, Random and CC control devices to a
    chain, so that parameters can move over time or with input.
48. As a performer, I want to map a control device to any parameter of any device in the same
    Effect, with amount, invert and range, so that modulation is flexible.
49. As a performer, I want one control to drive several parameters, so that one LFO can move many
    things together.
50. As a performer, I want modulated parameters marked on their cards, so that I can see what's
    moving.
51. As a performer, I want LFOs to sync to the transport (beat divisions) or run in Hz, so that
    motion can lock to tempo.
52. As a performer, I want a Velocity control mapping hit velocity to any parameter, so that hard
    hits can look different, not just brighter.

### Target

53. As a performer, I want the Target card to choose where light shows: the whole kit, the drum
    that was hit, or chosen drums and hoops, so that I can aim each Effect.
54. As a performer, I want a new Effect's Target to default from its row (Kit row → whole kit, a
    drum row → that drum), so that the common case needs no setup.

### MIDI-map mode

55. As a performer, I want a MIDI-map toggle in the top bar (and a keyboard shortcut), so that I
    can enter and leave mapping quickly.
56. As a performer, I want every mappable control to turn orange in MIDI-map mode, so that I can
    see what can be mapped.
57. As a performer, I want to click a control, then press a MIDI note, move a CC, send an OSC
    address, or press a computer key, and have it learned, so that mapping is one gesture.
58. As a performer, I want to map buttons and toggles (fire a cell, bypass an Effect or Modifier,
    section chips, next/prev song and section, global controls) to notes, CCs, OSC or keys, so
    that I can perform from a controller or keyboard.
59. As a performer, I want to map knobs and sliders (any device param, Effect opacity, Modifier
    mix) to a CC or OSC value with a min/max range, so that I can play parameters live.
60. As a performer, I want each mapped control to show its mapping while in MIDI-map mode, and to
    clear it with Delete / Backspace, so that mappings are visible and editable.
61. As a performer, I want a mapping that conflicts with a zone or another mapping refused with a
    clear message, so that one input never does two things by accident.
62. As a performer, I want the rest of the app to be inert while mapping (clicks select a control
    to map instead of acting), so that I don't fire things accidentally.

### Presets and files

63. As a performer, I want to save an Effect, a cell's whole stack, or a single device to a file,
    and load it back into any cell, so that I can build my own preset library.
64. As a performer, I want loaded files to bring the scenes they reference, and reuse ones already
    in the show, so that presets are portable between shows.
65. As a performer, I want the file save/load actions on the relevant card or cell menus, so that
    presets are where I'm working.

### Showfiles and import

66. As a performer, I want the new version to start a new showfile format, so that the app isn't
    held back by the old graph model.
67. As a performer, I want to import an old show and keep its kit, patch, outputs, input map,
    transport, songs and sections (with empty grids), so that I don't re-enter my rig.
68. As a performer, I want my old show left untouched on disk and in the server's store when the
    new version starts, so that nothing is destroyed.
69. As a performer, I want the song library and canonical (read-only) library songs to keep
    working with the new sections, so that shared songs still work.

### Engine and output

70. As a performer, I want the server engine and the offline browser preview to render the new
    model identically, so that what I see offline is what the kit does.
71. As a performer, I want section recall, song navigation, blackout, master brightness and output
    to behave exactly as today, so that the show runs the same.
72. As a performer, I want stacked Effects to composite in a defined order with their blend modes,
    so that layering is predictable.

## Implementation Decisions

### Domain model (core, pure)

- **New authored types.** A new core domain module owns these types, their zod schema, and the
  pure resolver:
  - **Effect**, **GeneratorDevice**, **ModifierDevice**, **ControlDevice**, **Target**,
    **TriggerSpec** and **Cell**.
  - Section gains `effects: Effect[]` (the ordered section stack) and `master: ModifierDevice[]`.
- **Effect shape** (decision-level, not final code):
  ```
  Effect {
    id, name, bypass,
    cell: { row: 'kit' | DrumId,
            column: { kind:'zone', slot:number } | { kind:'always' } | { kind:'clock' } | { kind:'cue' } },
    trigger: { kind:'zone' }                                        // drum/slot come from cell
           | { kind:'always' }
           | { kind:'clock', every: BeatDivision, offsetBeats }
           | { kind:'cue', source: { midiNote? , midiCc?, oscAddress? } },
    retrigger: 'overlap' | 'restart' | 'ignore',                    // default 'overlap'
    amp: { attackMs, decayMs, sustainLevel, length: {ms}|{beats}|'hold'|'loop', releaseMs },
    generator: { kind: GeneratorId, style: string, params: Record<string, ParamValue>,
                 slots?: SpliceSlot[] },                             // Splice/Slice only
    modifiers: ModifierDevice[],     // { uid, modifierId, params, mix (0..1), envelope?, bypass }
    controls: ControlDevice[],       // { uid, kind: envelope|lfo|velocity|random|cc (+osc|note|audio),
                                     //   settings, mappings: [{ device: 'generator'|modifierUid|'effect',
                                     //   param, amount, invert, rangeMin, rangeMax }] }
    target: { kind:'kit' } | { kind:'hitDrum' } | { kind:'select', drums: [{ drumId, hoops?: number[] }] },
    blend: BlendMode, opacity: 0..1,
  }
  ```
- **Trigger and cell agree.** The trigger kind is always consistent with `cell.column`. Changing
  the trigger kind moves the cell's column. A zone trigger's drum and slot come from the cell.
- **Composition order.** The section's `effects` array order is the composition order. The grid
  presents it grouped by cell. Reordering happens within a cell's stack, and the relative order of
  Effects in different cells is otherwise stable **(agent-chosen)**.
- **Cell identity.** A cell is identified by (row, column). Zone identity is the numeric slot, as
  today, never the zone name.
- **No linking in v1.** Effects are owned by their section. Linked placements (the same graph in
  several sections) are not carried into this model; copy/paste replaces them **(agent-chosen;
  linking can return later)**.
- **One resolver.** A single pure core resolver turns an authored section plus an input event into
  the Effects that fire, and turns an Effect plus a trigger context into the existing
  **PlayAction** that the voice pool already spawns. This is the **one seam**. The server engine,
  the web offline Sim and show assembly all use it. It replaces the duplicated graph-resolution
  code in the core engine, the web store and the sim.
- **Graph machinery is deleted.** Everything below `PlayAction` is reused unchanged: voice pool,
  envelope tick, effective-param/`Mapping` sampling, generator bridge, modifier chain runner,
  compositor and output. The graph layer above it is deleted once nothing uses it: graph eval,
  render plan, graph integrity/lint, modifier-graph and modulation-graph resolution, runtime slot
  grid, and the routing nodes (random, sequence, switch, chance, toggle, delay, mix). The routing
  nodes are dropped from the product in v1 **(Trent: "cut out some complexity and only add it in
  when we want it")**.

### Engine changes (core voice engine)

- **Show shape.** The runtime Show carries songs → sections → `effects` / `master` instead of
  graphs + slots. Buses and EffectDefs/Presets leave the authored model. A voice's polyphony and
  crossfade come from its Effect's retrigger setting and trigger kind. Bus stats, if still shown,
  are derived internally **(agent-chosen)**.
- **Always.** Always Effects spawn in `loop` mode on section recall and release on leaving the
  section. This generalises today's section "looks" mechanism, which it replaces.
- **Clock.** Clock Effects fire when the transport crosses their beat grid (every/offset), inside
  the engine tick. This is deterministic under the existing event-log ordering.
- **Cue.** Cue Effects match MIDI note / CC / OSC exactly as today's direct trigger sources do.
  Cue sources participate in the binding-claims guard.
- **Retrigger.**
  - `overlap` spawns a new voice.
  - `restart` releases this Effect's live voices, then spawns (reuse supersede).
  - `ignore` skips if a live, non-releasing voice of this Effect exists.
- **Amp envelope.** The Effect's amp envelope maps onto the voice envelope (attack, sustain,
  release) plus a decay/sustain-level gain curve over the voice life. `length` supports ms, beats,
  `hold` (until note-off/release) and `loop` (Always). Velocity scales level by default, as today.
- **Modifier mix and envelope.** The modifier chain runner gains per-link `mix` (dry/wet lerp over
  the link's range) and an optional per-link envelope that multiplies `mix` over the voice's life.
  At `mix` = 1 with no envelope, output must be bit-identical to today.
- **Strobe.** The Strobe modifier gains:
  - an off state: black (default, today's behaviour), a dimmed input, or a second colour;
  - a fade: soft edges and per-flash decay.

  At default settings it must be identical to today.
- **Blend and opacity.** Voices carry `blend` + `opacity` from their Effect. The compositor
  composites voices into the frame in section composition order using the existing blend-mode
  library. The default `add` at opacity 1 must match today's additive result.
- **Master chain.** After all voices are composited, the section's `master` modifiers run over the
  whole frame, using a section-local clock and state that reset on section recall. This happens
  before blackout and master brightness.
- **Velocity control.** A new `velocity` modulation source reads the voice's spawn velocity (0..1).
- **Continuous mappings.** CC/OSC mappings to Effect params are resolved in core as additional
  modulation mappings on matching voices. Mappings to Effect opacity and modifier mix are also
  resolved there, so server and sim agree.

### Generators

- **Nine generators plus Splice and Slice.** They are facades over the existing generator
  implementations. Each has a **Style** enum, and each Style dispatches to one existing
  implementation. The card shows the chosen Style's params. Common params (colour/hue, saturation,
  brightness, speed) are presented consistently where the underlying params allow.
  Param-by-param unification within a generator is incremental and not required for v1
  **(agent-chosen)**. The existing implementations become internal: not listed to users, but kept
  and tested.
- **Style mapping** (every non-deprecated existing effect is reachable):
  - **Solid** — solid-colour, solid-base, whole-drum (Tim's "Simple"), whole-kit, breathing-kit,
    follow-hoop.
  - **Gradient** — rainbow-flow, hue-rotate-kit, temp-sweep.
  - **Wave** — chase-bands, scan-plane, wipe-3d, radial-wash (includes wave-collapse), ripple-3d,
    ripple-pond, drum-sonar, spiral, helix, tunnel, orbit-comet, orbit-rings, comet-trails,
    interference, synced-hoops, spatial-field.
  - **Noise** — plasma, perlin-clouds, lava-lamp, caustics, fire, flame-flicker, velocity-flames.
  - **Particles** — confetti-burst, sparkler, starfield, rain-3d, gravity-drops, gravity-wells,
    collisions, pixel-accum, sacred-hogs.
  - **Pattern** — segments, checker-pulse, grid-glow.
  - **Meter** — meter-eq, swing.
  - **Lightning** — lightning, spark-arc.
  - **Scene** — authored canvas scenes (existing canvas-scene documents and editor), kept because
    the capability exists today **(agent-chosen)**.
  - **Splice** and **Slice** — the existing splice/slice layer producers, with slots holding a
    colour or a nested Generator.
  - **Dropped as generators:**
    - **strobe** — now the Strobe Modifier only.
    - **sidechain** — a future "Duck" modifier; out of scope.
    - **wave-collapse** — merged into radial-wash (Trent approved).
    - **chase, burst, colour-melody** — already deprecated.
- **Merges Trent approved.** wave-collapse becomes a radial-wash mode. follow-hoop's hoop delay
  becomes a param on whole-drum, which the UI labels **Simple**. They are implemented as Styles
  and params within the facades.

### Web authoring (store)

- **Replace the graph API.** The authored store replaces the graph/node API with an
  Effect/cell/device API:
  - Effects: add, remove, reorder within a cell, move between cells, rename, bypass, set blend,
    set opacity, set retrigger.
  - Devices: set generator (kind/style), set a param on any device; add, remove, reorder and
    bypass modifiers; set mix and envelope.
  - Controls and mappings: add a control, map it to a param, edit a mapping.
  - Target and trigger: set the Target; set trigger settings.
  - Cells and the Master chain: copy, paste and clear cells; edit the Master chain.

  All of these go through the existing undo transactions and gesture folding, viewer guards and
  autosave.
- **Show assembly.** Show assembly and the server's cold-start rebuild use the same core show
  builder, which removes today's duplicated logic.
- **Offline Sim.** The Sim uses the core resolver, so parity with the server holds by
  construction.
- **Keyboard.** Keys 1–9 and 0 fire the section's nth Effect in grid order (audition), through the
  existing keyboard-ownership rules.

### Web UI

- **Trigger view.** The Trigger view keeps its place in the shell. The graph rail and canvas are
  replaced by the **Grid**, and the inspector slide-over is replaced by the bottom **Device
  strip**. The visualiser and dock column stay.
- **Grid.**
  - It is keyboard navigable (roving focus).
  - Cells show a stack count, bypass state and a fire flash.
  - Disabled cells are non-interactive.
  - The Kit row carries the Master cell.
- **Device strip.**
  - It is a horizontal scroller of fixed-width device cards: Trigger, Generator, each Modifier,
    each Control, then Target, with per-Effect header controls (name, bypass, blend, opacity,
    retrigger, menu).
  - A stacked cell shows one chain row per Effect.
  - Card params use the existing compact face-param control and param-spec normaliser. Existing
    inspector param composites are reused or reshaped where they fit.
- **Design system.** Every new reusable component (grid cell, device card, device strip, map
  overlay) is added to the styleguide and the design-system file is regenerated in the same
  change. The `/make-interfaces-feel-better` polish pass and PRODUCT.md / DESIGN.md apply. A
  dedicated **map** colour token (orange) is added for MIDI-map mode.
- **Removals.** The graph editor, the orphaned Patch-graph view, the add-node pane, graph lint UI,
  and their styleguide demos, ui-shot ops and shot presets are removed. `@xyflow/svelte` is
  dropped. The Sections view and Objects view are updated to show Effects/cells instead of graphs.

### MIDI-map mode

- **Mappable controls.** A central registry of mappable controls: each control registers a stable
  map-target id and a kind (button / toggle / continuous). A global mode flag lives in the shell.
- **Learning.** While the mode is on:
  - an overlay marks each mappable control;
  - a click arms that control;
  - the next MIDI note or CC, OSC address, or key (through a learn-first branch in the app
    keyboard dispatcher) is bound;
  - Delete / Backspace clears the binding;
  - Escape or the toggle exits the mode.
- **Mapping storage** **(agent-chosen)**:
  - Mappings live with the show, as `show.mappings[]`
    (`{ id, source: { midiNote | midiCc | oscAddress | key }, target, rangeMin?, rangeMax? }`),
    like an Ableton set's mappings.
  - Global-control buttons write the existing input-map global-control bindings, so Settings stays
    their single source of truth.
- **Resolution.**
  - Note, CC and OSC mappings resolve in core, in the host input path and in the Sim, at the same
    precedence as global controls: a mapped input is consumed and does not also fire a zone.
  - Key mappings resolve in the web app and send the resulting action (fire a cell, toggle a
    bypass).
- **Conflicts.** The binding-claims guard extends to mappings, and conflicts are refused with a
  message.
- **Protocol.** New client messages carry "fire cell / fire Effect" and mapping-driven actions.
  They replace `fireGraph`.

### Persistence, files and import

- **Version bump.**
  - Show library and song library envelopes get a new major version.
  - The server's library-version preflight accepts the new version.
  - The browser stores the new library under a new storage key, leaving the old key untouched.
  - The server keeps any old-version blob on disk and boots with an empty show instead of
    refusing.
- **Import.** Offered when an old library is present, and on demand from the setlist menu. It
  reads the old show/song library, keeps songs and sections (ids, names, order, bars, BPM),
  canvas scenes and transport settings, and drops graphs, presets, buses and effect defs. The kit,
  patch, outputs and input map live in the server Project and are unaffected. The old data stays
  in place.
- **Save/load to file.** Save/load-to-file (the ClipDoc format and file IO) gains `effect`, `cell`
  and `device` kinds, with the same dependency remapping for scenes. The `graph` and `node` kinds
  are removed. `section`, `song` and `patch` kinds carry the new section shape.

### Domain language

- Update the glossary. New terms: **Effect** (the chain), **Generator**, **Style**, **Modifier**,
  **Control**, **Target**, **Cell**, **Stack**, **Master chain**, **MIDI-map mode**. Retire
  Effect Node, Scope Node, Output Node, Anchor Node, Mix Node, Add Pane and Creation Preset.

## Testing Decisions

- **What a good test is.** A good test asserts external behaviour at the highest seam: authored
  data plus inputs produce rendered frames or store state. It never asserts internal structure.
  Tests are hermetic, their names match their assertions, and existing assertions are never
  weakened to go green. Workers run typecheck plus targeted vitest only; the orchestrator runs the
  full `pnpm test` serially.
- **Primary seam: the core engine.** `createVoiceBusEngine`: `setModel` → `setShow` (new
  section/effects shape) → `applyInput` → `tick` → `frame`. It covers:
  - trigger matching (zone, always, clock, cue);
  - retrigger modes;
  - the amp envelope;
  - modifier mix/envelope;
  - Strobe off-colour and fade;
  - blend/opacity composition order;
  - the Master chain;
  - the velocity control;
  - continuous and button mappings;
  - section recall of Always Effects.

  Prior art: the voice engine tests, the determinism replay harness, the compositor tests, and
  the modifier two-tier goldens plus end-to-end tests.
- **Parity.** The existing runtime-parity pattern (Sim versus engine, frame for frame) is extended
  to the new show shape.
- **Identity guarantees**, each proven by a golden against the pre-change output:
  - modifier `mix` = 1 with no envelope matches the old chain;
  - Strobe at defaults matches today;
  - `add` blend at opacity 1 matches the old additive composite.
- **Generators.** Each generator facade Style renders identically to the underlying implementation
  at default params (golden). The existing effect batch tests keep covering the implementations.
- **Store.** Effect/cell/device mutations, undo folding and viewer guards follow the existing
  store test pattern. Mapping learn follows the existing MIDI/OSC learn tests.
- **Persistence.** Round-trip of the new library format; import from a fixture old-format library
  keeps songs and sections and drops graphs; the old storage key is untouched. ClipDoc round-trips
  for the effect, cell and device kinds.
- **Server.** The host input path covers mapping precedence versus zones and global controls. The
  cold-start rebuild accepts the new version and survives an old blob.
- **UI.** `pnpm ui-shot` captures for the grid, device strip (single and stacked), each card type,
  MIDI-map mode (overlay, armed, mapped) and the import prompt, with a clean console. Component
  tests cover grid keyboard navigation and card param editing.
- **Seam confirmation.** Trent delegated the plan ("I'm happy that you know what you're doing") and
  was offline when these seams were chosen. They follow the existing engine seam rather than
  adding new ones.

## Out of Scope

- The GPU particle engine and three.js rendering (separate spike branch).
- Routing nodes: random, sequence, switch, chance, toggle, delay and mix-as-a-node. Add them back
  later only when wanted.
- Linked Effects across sections. Copy/paste instead.
- A built-in preset library recreating the old 54 looks. Presets are save-your-own files only.
- A "Duck" (sidechain) modifier.
- Spatial-region targets (3D box, sphere or plane).
- Converting old graphs into Effects.
- Removing the dead legacy Composition engine and its protocol messages (a separate cleanup).
- Changes to kit, patch, outputs, input map, transport, controller or Stage preview.

## Further Notes

- **Delivery.** Delivery is a stack of PRs off `main`, sequenced by seam:
  1. core model, resolver and engine;
  2. generators, modifiers and the Master chain;
  3. web store and persistence;
  4. grid and device strip UI;
  5. MIDI-map mode;
  6. removal of the graph editor.

  Each PR is green at its own HEAD.
- **Release.** Nothing ships to kits without an explicit "publish" from Trent or Tim (AGENTS.md
  release flow).
- **Tim.** Tim will review this work; his strobe ideas (two-colour, fade, ADSR) are built here, not
  by him separately.

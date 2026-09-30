# LEDrums

Domain language for the LEDrums lighting instrument: authored Effect chains on a per-section grid, live trigger input, targeted LED output, and physical kit routing.

The authoring terms below come from the effect-chains spec (`docs/plans/2026-09-30-effect-chains/spec.md`, GH #237). Its decisions are Trent's (2026-09-29/30 planning session on Trent's MacBook Pro), building on Tim's voice note relayed by Trent (two-colour strobe, strobe fade, per-modifier envelopes, Splice behaviour). Code names are given where they differ from the spoken term.

## Language

**Effect**:
One linear chain that makes and shapes light: **Trigger → Generator → Modifiers (ordered) → Target**, with optional Control devices and a built-in amplitude envelope (ADSR). An Effect lives in exactly one Cell of one section and carries its own blend mode, opacity, bypass and retrigger setting (overlap / restart / ignore). Code: `effectChain.Effect` (`packages/core/src/effect-chain/types.ts`).
_Avoid_: graph, look, clip, Effect Node

**Trigger**:
When an Effect fires. One of four kinds, always equal to its Cell's column: **zone** (a drum's input zone is hit), **Always** (runs while its section is active), **Clock** (fires on the transport beat grid) and **Cue** (a specific MIDI note / CC or OSC address). Changing the kind moves the Effect to the matching column.
_Avoid_: trigger node, source node

**Generator**:
The device in an Effect that makes light. There are nine Generators (Solid, Gradient, Wave, Noise, Particles, Pattern, Meter, Lightning, Scene) plus **Splice** and **Slice**, whose slots hold a colour or a nested Generator. Each Generator is a facade over existing effect implementations; those implementations are internal and are not listed to users. Code: `GeneratorDef` (`effect-chain/generators/`).
_Avoid_: effect (for the device), effect generator (in UI copy), play node

**Style**:
The choice inside a Generator that picks one underlying implementation, for example Wave → Chase / Radial / Spiral. The Generator card shows only the chosen Style's params. Each Style hosts exactly one effect implementation (`GeneratorStyle.effectId`).
_Avoid_: mode, variant, preset

**Modifier**:
A device that transforms light from earlier in the chain and never makes its own. Every Modifier has a **Mix** (dry/wet, 0..1) and an optional envelope over the Effect's life. "Changing light" looks (strobe, sparkle and similar) exist only as Modifiers. Code: `ModifierDevice` (authored) over a `ModifierDef` (`packages/core/src/modifiers/`).
_Avoid_: effect, filter, modifier node

**Slice Modifier**:
A Modifier that divides the active pixel range into pixel-count bands and deterministically reorders those bands for a voice. Not the same as the **Slice** Generator.
_Avoid_: Slice effect

**Control**:
A device that produces a value over time or from input (Envelope, LFO, Velocity, Random, CC, plus OSC, Note and Audio) and drives params of devices in the same Effect through **ControlMappings** (amount, invert, range). One Control can drive several params. Code: `ControlDevice`, `ControlMapping`.
_Avoid_: modulation node, modulator, InputMapping

**Target**:
Where an Effect's light shows: the whole kit, the drum that was hit, or chosen drums and hoops (hoops are 1-based). A new Effect's Target defaults from its row: the Kit row gives the whole kit, a drum row gives that drum.
_Avoid_: scope, Scope Node, output

**Cell**:
One position on a section's grid, identified by (row, column). Rows are **Kit** plus one per drum. Columns are the drum's zone slots (by number, never by zone name), then **Always**, **Clock** and **Cue**. Cells that cannot apply (zone columns on the Kit row, zone slots a drum does not have) are disabled. Code: `EffectCell`.
_Avoid_: slot (for the whole cell), pad

**Stack**:
The ordered Effects in one Cell. Stack order is layering order: the section's `effects` array is the composition order, and the grid presents it grouped by Cell.
_Avoid_: layer list, bus

**Master chain**:
A section's own ordered Modifiers, held in the **Master** cell on the Kit row. It runs over the whole composited frame after every Effect, before blackout and master brightness, on a section clock that resets on recall. Code: `section.master`, `applySectionMaster` (`effect-chain/master.ts`).
_Avoid_: master effect, global modifier

**MIDI-map mode**:
An Ableton-style mode, toggled from the top bar or `mod+m`, in which every mappable control is outlined in the map colour (orange, `--map`). Click a control to arm it, then press a MIDI note, move a CC, send an OSC address or press a computer key to bind it. Delete / Backspace clears the binding; Escape exits. While it is on, the rest of the app is inert.
_Avoid_: learn mode (that is the per-field Learn button in Settings)

**InputMapping**:
A binding made in MIDI-map mode: one input source (MIDI note, MIDI CC, OSC address or key) bound to one target (`fireCell`, `fireEffect`, `recallSection`, `param`, `opacity`, `modifierMix`, `bypass`). Stored on the show (`AuthoredV3.mappings`). A matched input is consumed at global-control precedence, so it does not also fire a zone or Cue. Mapping a global-control button writes `inputMap.globalControls` instead, so Settings stays the source of truth for those. Code: `packages/core/src/effect-chain/input-mappings.ts`.
_Avoid_: ControlMapping (that is modulation inside one Effect), binding (on its own), MIDI map

## Retired terms

The per-section canvas trigger graph is being replaced by Effect chains (spec "Removals"; the code is deleted in effect-chains S08 / wave 6). Do not use these terms for new work. They remain only in historical docs and in graph code that has not yet been deleted.

| Retired term | What replaces it |
|---|---|
| Effect Node (and its legacy alias `play`) | the **Generator** of an **Effect** |
| Scope Node | the **Target** |
| Output Node | nothing: every Effect renders to its Target, so no terminal node is needed |
| Anchor Node | nothing: an Effect chain has no graph endpoints |
| Mix Node | **Stack** order plus each Effect's blend mode and opacity |
| Add Pane | the device strip's add slot and the Generator picker |
| Creation Preset | nothing: Control devices are added by kind; presets are save-your-own files |
| Trigger graph / graph rail | the **Cell** grid and its **Stacks** |

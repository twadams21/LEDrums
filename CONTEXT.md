# LEDrums

Domain language for the LEDrums lighting instrument: authored signal-flow graphs, live trigger input, scoped LED output, and physical kit routing.

## Language

**Scope Node**:
A graph node that narrows the set of LEDs a route may affect. Multiple Scope Nodes on a route compose as cascading filters; the rendered scope is the intersection that survives before the route reaches Output.
_Avoid_: Output node, target dropdown

**Output Node**:
The required terminal graph node that permits a route to render. A route that does not reach Output does not emit light in Gen3 graphs.
_Avoid_: Scope node, Art-Net output

**Effect Node**:
A graph node that creates lighting content from an effect generator, canvas scene, or equivalent authored source. `play` is a legacy alias that migrates to Effect.
_Avoid_: Play node

**Anchor Node**:
A required graph endpoint that remains visible and movable but cannot be deleted or duplicated. Trigger and Output are anchor nodes in Gen3 graphs.
_Avoid_: Root node

**Add Pane**:
The two-stage node creation surface. Stage 1 chooses a category; Stage 2 shows addable node options as node previews.
_Avoid_: Palette

**Creation Preset**:
An option that seeds a node's initial fields while preserving the canonical node kind. Envelope and LFO Stage 2 options are creation presets.
_Avoid_: Separate node type

**Mix Node**:
An effect-flow node that blends multiple incoming rendered routes into one downstream route. Each incoming wire is a visible mix layer with its own opacity, and layer order follows the upstream nodes' vertical order.
_Avoid_: Route selector

**Slice Modifier**:
A modifier that divides the active pixel range into pixel-count bands and deterministically reorders those bands for a voice.
_Avoid_: Slice effect

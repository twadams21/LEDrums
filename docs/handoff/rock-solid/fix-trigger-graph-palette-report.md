# Report: Trigger-graph palette → one bar + modals (+ OSC modulation)

Branch `fix/trigger-graph-node-palette`. All four asks landed + Trent's mid-flight "one palette" tweak. Gates green: typecheck 0 errors; tests core 542 / io 13 / protocol 1 / server 190 / web 1017 (no skips). Live smoke-load done (below).

## What now works (demoable)
- **Canvas is no longer blocked beside the palette.** The empty canvas next to / below / around the add bar pans, clicks and accepts wire-drops again — only the actual buttons capture events.
- **One add palette.** The node kinds plus **Modifier** and **Modulation** buttons live in a single top-left bar (Trent's ask). Modifier/Modulation open a **modal picker** (shared `Dialog`): Modifier is category-grouped with a filter (registry-driven `listModifiersByCategory()`); Modulation lists Envelope / LFO / CC. Selecting adds the node at the visible canvas centre and closes. The always-expanded palettes that covered the canvas are gone (`ModifierPalette.svelte` retired).
- **OSC modulation.** A controller (`cc`) source node now has a **MIDI CC / OSC** toggle; in OSC mode an address field replaces the controller/channel controls and the node reads a live 0..1 value at that OSC address — full parity with MIDI CC.

## OSC design
Modelled on `sampleCc`: pure core `{ kind:'osc'; address }` ModSource + `OscTable`/`oscValue01`/`sampleOsc` + `ctx.osc` threaded through `applyModulations`/`sampleSource`; `nodeModSource` maps an OSC-mode `cc` node to it. The engine holds an `oscTable` fed from queued OSC events (an OSC event both fires trigger graphs AND feeds the table), cleared on `setShow`, threaded into `applyEffectiveParams` + the compositor frame — deterministic, `core` stays pure. Web mirror: `sim.oscTable`/`setOsc` fed from the store's OSC input path; `ccNodeLiveValue` + the param-row preview read it. **Interpretation note:** the task's "expose OSC in the CC source inspector" + "the node's signal preview" read as folding OSC into the existing `cc` node (a source toggle), not a new node kind — the smallest change that satisfies both. Flag if you wanted a separate `osc` kind.

## Files
core: `voice/modulation.ts`, `modulation-graph.ts`, `types.ts`, `compositor.ts`, `engine.ts` (+ `modulation-osc.test.ts`). web: `GraphAddMenu.svelte` (new), `GraphPalette.svelte` (trailing slot + pointer-events), `GraphCanvas.svelte`, `TriggerGraphView.svelte`, `CcNodeInspector.svelte`, `trigger-node-meta.ts`, `sim.ts`, `render.ts`, `signal-preview.ts`, `store.svelte.ts`, styleguide `SectionGraph.svelte` + regenerated `docs/design-system.html`. Retired `ModifierPalette.svelte`. Tests: `store.cc.test.ts` (OSC seam).

## Acceptance evidence (headless Chrome via CDP, SwiftShader)
- (a) **No console errors** — 0 uncaught exceptions across every run; no `effect_update_depth_exceeded`, no rAF throws. (Only a benign 404.) I proactively refactored the one self-referential `$effect` the autofixer flagged (the modal's category filter) into a `$derived` per the AGENTS no-self-ref-effect rule.
- (b) **Canvas beside the palette** — `elementFromPoint` at empty canvas below/right of the bar resolves to `.svelte-flow__pane … draggable`, not the panel; the bar container is `pointer-events:none`, buttons `auto`.
- (c) **Modals add nodes** — on a fresh graph: Play 1→2, Modifier modal (18 picks) →3, Modulation modal (Envelope/LFO/CC) → CC →4. (On the server-contended demo graph a co-running sibling dev server reverts *all* adds incl. built-in kinds — environmental, not code.)
- (d) **OSC** — the CC inspector shows the MIDI CC / OSC toggle; OSC mode reveals the address field; a `CC · OSC` node persisted through a reload. Live sampling of a real OSC value needs an OSC sender (not wired in this env); the pure sampling + store/sim seam are unit-tested.

## Commits
`826e9bf` pointer-events fix · `eab24d6` Add Modifier/Modulation modals · `4455e30` OSC modulation · `76e12af` one palette + finish pointer-events.

## Deviations / cuts
None to scope. OSC folded into the `cc` node (see note). No half-wired paths.

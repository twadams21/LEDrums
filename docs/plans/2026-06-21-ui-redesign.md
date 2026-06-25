# LEDrums — full UI redesign

Status: **in progress** · Started 2026-06-21 · Driver: Impeccable `/craft`
Design context: [PRODUCT.md](../../PRODUCT.md) (register/users/principles), this doc (brief + decisions + slices).

## Goal
Ground-up redesign of the control app: new token system, new brand, new shell — a beautiful modern instrument that stays legible in a dark booth, organised around the signal path. Tool-first, but craft is part of the spec.

## Locked decisions

| Area | Decision |
|---|---|
| Register | `product` (tool serves the work; beauty still required) |
| Shell | **Mode-split**: Perform HUD (visualizer + 2D layer grid + big triggers, minimal chrome) ⇄ Authoring Workbench (header · view rail · workspace · inspector · layers/timeline). Keyed off `store.mode`. Fast (~200ms) crossfade between them. |
| Views | **Perform · Arrange · Settings**. Settings has sub-tabs **Patch** (node canvas, today's Routing) · **Output** (device/IP) · **Kit** (geometry, today's Map). Consolidates 4 views → 3. |
| Color | Mono-chrome graphite + functional role colour. The LED output is the only free-saturated colour. Role colours carry the signal path, always with icon + label. |
| Accent | **Phosphor lime** `oklch(0.845 0.190 128)`. |
| Taxonomy | **Content → Effects → Clip → Layer**. Content = generator/media. Effect = modifier altering content. Clip = an instance (Content + effect chain + params + mods), saveable as a **Preset**, fully instanced. **Blend mode** stays on the Layer. Signal-flow stages: Input → Content → Effect → Layer → Output. |
| Type | Geist Variable (UI) + Geist Mono Variable (numeric/technical), self-hosted. |
| Responsive | Desktop/laptop-first; tablet a viable Perform surface; not phone. |
| Stack | Svelte 5 runes + Threlte + @xyflow/svelte + Vite. `packages/core` stays pure. |

## Non-negotiables (from CLAUDE.md)
- `packages/core` pure: no Node/DOM/IO. All IO behind `packages/io` interfaces.
- Deterministic render loop; effects pure fns of `RenderContext`.
- Cross-platform, no native addons. Never block the render loop with sync IO.
- Reduced-motion alternative for every animation; WCAG AA contrast.

## Slices

1. **Foundation — DONE.** `apps/web/src/styles/tokens.css` (OKLCH, AA-verified by `apps/web/scripts/contrast-check.mjs`), `app.css` base controls, Geist fonts, back-compat aliases, styleguide at `/?style`, accent locked.
2. **Mode-split shells — DONE.** `apps/web/src/lib/shell/`: `PerformShell` (live bar · **adjustable 50/50 3D|2D split**, Layers removed), `AuthorShell` (header · Arrange/Settings rail · workspace · right column = 3D docked top + Inspector · bottom Layers), `SettingsView` (Patch/Output/Kit), shared `Icon` / `LivePill` / `StatusCluster`. `App.svelte` = mode switch + reduced-motion-aware crossfade; `?mode=` deep-link. `Pixels2D` renders the live per-drum pixel map (real composite; per-layer split pending engine frames). **Cards squared** via `--radius-card: 0`. Shell chrome squared; re-homed view internals get squared on migration.
3. **Core model refactor.** Split Content vs Effect; add per-instance Clip presets. Zod-validated, unit-tested. Prerequisite for the Arrange/Perform internals.
4. **View rebuilds.**
   - **Arrange — full rethink (Ableton/Resolume session view as the north star).** Not the current setlist/song/matrix panels. Target:
     - **Swimlanes / kanban**: one lane per **Layer**; each lane has **slots** where **Clips** are placed; the layer carries its **blend mode** + opacity on the lane header.
     - **Clip-settings drawer**: selecting a clip opens a drawer (bottom or side) showing that clip's full settings (Content + effect chain + params). Editing one instance never touches others (presets/instancing from slice 3).
     - **Setlist = document-level**, moved to the **header**: open / save / close / new setlist (not an always-editable panel — shouldn't be that easy to change).
     - **Songs**: easier to reach than setlist — candidate for the **left rail** (stack Songs there; the rail may widen / be repurposed for Layers if they need room). Keep Settings in the rail for now.
   - **Perform**: wire the 2D pane to real **per-layer** frames (engine protocol addition) so each layer renders individually for diagnosis; keep the adjustable 50/50.
   - **Settings**: square + restyle Patch/Output/Kit internals.
5. **Polish + drop legacy aliases.**

## Trigger-model pivot (active — 2026-06-21)

The flat per-section binding matrix (`(drum,slot)→clip`) is being replaced by a richer model, being decided via a throwaway probe before slice 3:

- **Trigger behavior tree** per `(drum,zone)`: leaf **Play** (one-shot / loop / hold) + containers **All / Random / Sequence / Switch** + modifiers **Chance / Toggle**, nesting arbitrarily (Wwise/FMOD-container lineage). Resolves "one zone → multiple effects", round-robin fills, velocity layers, latched loops.
- **Voice buses**: layers become buses with a polyphony rule — `mono` (new voice steals + morphs the old over a crossfade) vs `poly` (voices stack + decay). Loops → mono looks; one-shots → poly transients. Reuses the compositor.
- **Section morph/blend**: sections are snapshots; transition = `cut` / timed `morph` (rides voice-stealing) / live `blend` (two-deck crossfader).
- **Effect scope**: each effect is `drum`-scoped (renders on the triggering drum only) or `kit`-scoped (a 3D wash spilling over the whole kit). A Play block picks scope, which filters the effect palette to that scope's effects. (Maps to today's whole-drum vs whole-kit effects + the spatial effects in `packages/core`.)
- **Effects → presets → instances**: an effect (e.g. Swirl) has typed **parameters** (hue, speed, bands, angle, tempo-sync…) and named **presets**. A placed clip is an **instance** of effect+preset — single-instance by default (private param copy), with an opt-in **Link** so edits write to the shared preset and sync across every song/section that uses it. (This is the slice-3 "per-instance Clip presets" decision, now concrete.)
- **Parameter envelopes**: any numeric param can be driven by an **envelope** that sweeps it over the voice's life (e.g. a one-shot Swirl whose angle sweeps as it decays; also shapes the decay). Prototype ships 4 predefined shapes (Decay/Rise/Pluck/Pulse); a full envelope editor is future work.

Probe: `apps/web/src/lib/trigger-lab/` (`?proto=trigger`, `NOTES.md`). Three branches under decision: **voice model · block set · section blend**. Decisions feed the slice-3 core model refactor and reshape the slice-4 Arrange build (block-tree editor — graph-native, aligns with the Patch node canvas — + a scene/morph surface, not a spreadsheet).
- *Open from the probe:* a one-shot landing on a `mono` look bus steals the loop — likely wrong; transient one-shots probably need a poly path even when the look bus is mono.

## Component foundation (active — 2026-06-24)

The trigger-lab prototype is being promoted toward the real UI, so form primitives move onto a headless library instead of bare HTML controls.

- **Bits UI** (`bits-ui`, Svelte 5-native) is the chosen foundation for solved, accessibility-heavy primitives. Bespoke domain pieces (TreeCanvas, EffectThumb, Scene) stay hand-rolled.
- Wrappers live in `apps/web/src/lib/ui/` — thin, project-token-styled components over Bits parts. The whole trigger-lab prototype now runs on them:
  - `Slider.svelte` (`Root`/`Range`/`Thumb`) — filled `Range` + `Thumb` share one value, fixing the "de-linked handle vs value" native-range problem. `value`+`onChange` or `bind:value`; `showValue`/`format` for the inline readout.
  - `Select.svelte` (`Root`/`Trigger`/`Portal`/`Content`/`Item`) — `value`+`options`+`onChange`. Dropdown portals to body at `z-index 90` (above dialogs).
  - `SegmentedControl.svelte` (ToggleGroup single) — radio-style; mirrors `value` and refuses Bits' re-click-to-deselect so exactly one stays selected.
  - `Toggle.svelte` (on/off) and `Dialog.svelte` (portaled, focus-trapped, `layer` prop for z-index tiers).
- **Why dialogs moved to Bits too:** a native `showModal()` dialog renders in the top layer *above* body-portaled popovers, so a Bits Select dropdown inside a native dialog would render behind it. Bits Dialog + Bits Select share the same dismiss/focus layer system and compose correctly. Nested popups stack via `layer` (settings = 1, gallery/envelope = 2).
- **Scoping rule learned:** a class passed to a Bits component lands on the *child's* root, which lacks the parent's scope attribute — style it via `:global(...)` (anchored under a parent-owned scoped element where possible). Size a Bits-rooted child by wrapping it in a parent-owned element and setting width there. Portaled content (Select/Dialog) must use uniquely-prefixed top-level `:global` classes.
- Verified via Playwright: dropdown-over-dialog layering, nested dialog stacking, and a Select opened inside the transformed pan/zoom canvas (portaled popover positions correctly, unscaled).
- **Icons:** `@lucide/svelte` (v1, Svelte 5-native, `currentColor`) replaces every emoji glyph — X (close/remove), Replace (swap), Spline (envelope), ChevronDown/Check (select), Zap/Repeat/Hand (play modes), Plus/Minus/Maximize2 (canvas zoom). `SegmentedControl` options take an optional `icon?: Component` rendered via `{@const}`. Per-icon imports (`@lucide/svelte/icons/x`) for tree-shaking.
- **Polish pass** (make-interfaces-feel-better): global `button:active` → `scale: 0.96` (was translateY); `tabular-nums` on all live readouts (clock/bpm/vel/blend/xfade/zoom); `-webkit-font-smoothing` on the lab root; caret rotates on select open; dropdown + dialog enter animations (`-global-` keyframes, `prefers-reduced-motion` guard); 34px close-button hit areas; concentric radius + white edge-outline on gallery thumbnails.
- **Component library expansion + feature tools (2026-06-25):** `lib/ui/` now also has `IconButton`, `Field`, `TextField`, `SearchField`, `Switch` (Bits, sliding), `Tabs` (Bits, underline), `Separator` (Bits), `Eyebrow` — design cues borrowed from `../twa-v3.1-examples` (eyebrow labels, dashed add-tiles, auto-fill card grids, pill search, staggered entrance, border-driven focus) but kept on our oklch/green tokens. Three feature surfaces built on them (parallel svelte-file-editor agents, integrated + verified here):
  - **EnvelopeEditor** (replaces EnvelopePopup): a bespoke SVG curve editor — preset shapes seed editable breakpoints, drag handles to reshape (auto-marks `custom`), `amount` = sweep depth. Backed by a model extension: `Envelope { kind, amount, points: EnvPoint[] }` (was a bare `EnvKind`), `sampleEnvelope` piecewise-linear, render applies `base + (target-base)*amount`.
  - **EffectCreator**: author an effect at runtime (name / pattern-tile picker / scope / bus / attack-sustain-release / includable params) with a live `EffectThumb` preview. `store.createEffect()` appends to a now-reactive `effects = $state([...EFFECTS])` and registers into the sim (`sim.registerEffect`/`registerPreset` + seeded Default preset). End-to-end verified (created effect shows up in the gallery and is selectable).
  - **Gallery revamp**: search, scope tabs, bigger animated cards, dashed "New effect" tile that hands off to the creator (`closeGallery(); openCreator();`).
- **Node-based trigger editor (2026-06-25):** the nested-card tree (`TreeCanvas`+`BlockCard`, both deleted) is replaced by `NodeCanvas.svelte` — a left→right node graph: a synthetic **Trigger Input** node, utility nodes (containers/modifiers) and effect (play) nodes, auto-wired with SVG bezier edges between input/output ports, on the reused pan/zoom canvas. Auto-layout (`x=depth`, tidy post-order `y`); add-node via a `+` on container output ports; per-node kind `Select`, remove, and the same per-kind controls as before. The Block tree model + evaluation are unchanged — it's a rendering/UX redesign. *Open question:* it's auto-wired (a behaviour tree is a tree); freeform DAG hand-wiring would be a deeper model change if wanted.
- **More primitives (2026-06-25):** `Tooltip` (Bits, `child`-snippet so it wraps buttons without nesting — now used by `IconButton`, replacing native `title`), plus layout components `Card`, `Rail`, `Sidebar` (collapsible), `Drawer` (slide-in on Bits Dialog). Gallery fixes: single New-Effect button, single search focus ring (suppressed the global `:focus-visible` box-shadow on the inner input), `EffectThumb` constrained via `max-width:100%` + `aspect-ratio` (was an inline pixel width).
- **Freeform graph model (2026-06-25):** the trigger tree became a real **node graph** (DAG). `sim.ts` gains `GraphNode`/`GraphEdge`/`TriggerGraph` (nodes carry every kind's fields + x/y; only the kind's fields matter), `treeToGraph` (converts the authored fixtures trees → positioned graphs on store init), and `evalGraph`/`evalNode` (traverses from the `trigger` node, orders children by visual y, cycle-guarded). The store holds `graphs` keyed by padKey; `hit()` fires `sim.triggerGraph`. All dialog-facing methods + targets are now `GraphNode`-typed (a play node is structurally what the dialogs need, so ClipSettings/EffectGallery/EnvelopeEditor were untouched). New graph ops: `addNode/moveNode/removeNode/connect/disconnect/changeKind` (connect rejects dup/cycle/wrong-direction; play is a sink, trigger a source). `NodeCanvas.svelte` rewritten as a freeform editor: **drag nodes to rearrange**, **pan only when the empty canvas is grabbed** (node/port pointerdowns stopPropagation), **drag output→input ports to wire** (live bezier; click an edge to delete; fan-in/out unrestricted), plus an add-node palette. Verified: node drag (+60,+90), wiring (edge created trigger→new node), palette add, firing through the graph. The old `Block` tree + `BlockCard`/`TreeCanvas` are retired (fixtures still author as trees → converted).
- **ADSR envelope editor (2026-06-25):** EnvelopeEditor rebuilt as a Vital/Serum-style ADSR — three draggable stage handles (Attack/Decay·Sustain/Release) over a filled curve, Pluck/Stab/Swell/Gate presets, a Curve (tension) slider, Amount (depth), and A/D/S/R readouts. Model: `Envelope.adsr?: AdsrShape` + `adsrToPoints` (sim) regenerates the persisted `points` the renderer already samples; `store.setEnvAdsr` is the single write path.
- *Remaining native controls* (older shell, not the prototype): `lib/panels/EffectParams.svelte`, `lib/panels/LayerStack.svelte`, `lib/styleguide/Styleguide.svelte` — convert when those panels are next touched.

## Trigger-lab → app promotion (active — 2026-06-25)

Decision: **trigger-lab is promoted from probe to the real control surface** — it's the better-looking UI, so we grow it into the app rather than migrating its internals back into the old `PerformShell`/`AuthorShell`. Anything ported in must use the `lib/ui/` design system + oklch/green tokens (no bare HTML controls).

- **Section model locked to timed morph only.** `cut` and live two-deck `blend` dropped. `TransitionMode`, `setDeckBlend`, `pushBlend`, deck A/B + crossfader UI removed; `recallSection(section)` always morphs (releases old look loops, spawns new, rides the bus crossfade). Files: `sim.ts`, `store.svelte.ts`, `TriggerLab.svelte`.
- **Transport ported** (slice 1 of the promotion, server-free): play/stop gates the sim clock (`store.playing`), `beatsPerBar` drives the bar.beat readout + a `Select`, tap-tempo on the bpm, and a beat-pulse dot. Built on `IconButton` + `Select` (DS).
- **Local FPS readout** added (composite rate over a 500ms window) — placeholder until the engine link supplies real output FPS.

**Open — IO architecture fork (blocks real input/output):** trigger-lab's `sim.ts` is the brain (computes voices + composites frames in-browser); the server engine doesn't yet understand the trigger-graph/voice-bus model. So "real LED output" needs one of:
  1. **Frames-over-WS**: browser streams the locally-composited frameBuf to the server, which emits Art-Net/sACN (keeps the local sim as the brain; fastest path to real LEDs).
  2. **Port the model into `packages/core`** (the redesign's slice 3) so the server engine runs it and streams frames back (the long-term-correct path; much larger).
Real MIDI input (WebMIDI) is client-side and can wire to `hit()` independent of this fork; OSC input + Art-Net/sACN output both need the server.

## Core model port — compositing engine (active — 2026-06-25, codebase-design)

Decision: **port the trigger-graph/voice-bus model from `trigger-lab/sim.ts` into `packages/core`** as the production brain, behind a clean seam so the compositing engine can be ripped out / perf-tuned. Headline goal: **120fps continuous**. Designed with the deep-module vocabulary (interface = leverage; seam = where behaviour can be swapped).

**What already exists in core (reuse, don't rebuild):** `Framebuffer` (flat Float32 RGBA, stride 4, zero-alloc `set/add/max/clear`), `composite(layers,dst)` + `BlendMode`, `PixelModel` geometry (world/tangent/normal/segmentLengthMm + bounds), `RenderContext`/`TransportState`/`Trigger`. The server `EngineHost` already runs a fixed-timestep accumulator loop with independent transmit (Art-Net/sACN, fire-and-forget) and preview (WS) throttles. The current `Engine` runs the *old* layer/clip/binding model — it becomes the second seam adapter during migration, then retires.

**Two seams (each justified by a real second adapter / a stated need to swap):**

1. **Outer — `RenderEngine`** (host ↔ brain). Small host-facing interface; behind it: graph eval + voice pool + per-voice render + compositing.
   ```ts
   interface RenderEngine {
     setModel(model: PixelModel): void;            // kit geometry changed → rebuild buffers (cold)
     setShow(show: Show): void;                     // authored content: buses, per-pad graphs, sections, effect/preset registry (cold)
     applyInput(ev: InputEvent): void;              // noteOn/noteOff/osc/key — queued, drained at tick
     tick(now: number, dt: number, t: TransportState): void;  // advance voices + render (hot, pure)
     frame(): Readonly<Float32Array>;               // composited RGBA, no copy (host quantizes for Art-Net/WS)
     stats(): EngineStats;                          // voiceCount, busLevels, beat… (warm)
   }
   ```
   Adapters: `VoiceBusEngine` (production) + a test fake (`NullEngine`) — the fake makes the seam real and keeps the host testable. Leverage: the host (transmit + preview + stats + latency) is identical regardless of brain.

2. **Inner — `Compositor`** (voices → pixels), the perf hotspot the user wants to tweak/rip out.
   ```ts
   interface Compositor { render(voices: readonly Voice[], model: PixelModel, attrs: PixelAttrs, timeMs: number, dst: Framebuffer): void }
   ```
   Start with one straightforward adapter; swap freely for SIMD-ish / batched / WASM variants without touching voices or host.

**Behind the seam (internal modules, ported from sim.ts — pure):** graph eval (`evalGraph` verbatim), voice pool (spawn/release/tick, mono/poly + crossfade, **object-pooled, voice-capped**), envelope sampling (`sampleEnvelope`/`adsrToPoints`), and the pattern renderer (port `render.ts` `sample()` patterns to write Float32 RGBA per-bus buffers, then `composite`).

**120fps tactics:** zero allocation on the hot path (pre-sized voice pool + per-bus buffers + scratch vectors); drum-scoped voices touch only their pixel range; per-pixel attrs (angle01/norm01/nx/ny/nz) precomputed once at model build as SoA Float32Arrays; host `TICK_MS = 1000/120` (seam is rate-agnostic; transmit/preview stay independently throttled).

**Determinism (non-negotiable):** `tick` is a pure fn of (state, time, inputs). `sim.ts` uses `Math.random` in random/chance/sparkle → replace with a **seeded PRNG** (mulberry32, seeded from trigger seq + time) carried in engine state. Same behaviour, reproducible sequence.

**Decisions taken (flag if wrong):** (A) a new `Show` aggregate replaces the old `Composition{layers,clips}`/bindings as the authored model; old `Engine` kept only as a migration adapter. (B) seeded PRNG (forced by determinism). (C) two seams as above (outer now; inner because perf-tuning the compositor is an explicit goal).

**Slices:** 1) seam + ported types + test fake in core · 2) graph eval + voice pool + envelopes (unit-tested vs sim parity) · 3) pattern renderer + compositor (zero-alloc) · 4) wire `VoiceBusEngine` into the host @120 tick, extend WS protocol for `Show` + voice/bus stats · 5) point web trigger-lab at the server engine over WS (keys → `key` input, latency accepted); local sim becomes offline fallback.

**Status (2026-06-25):** Slices 1–3 DONE — `packages/core/src/voice/` (`engine.ts`/`types.ts`/`compositor.ts`/`prng.ts`/`envelope.ts`, 127 tests, byte-identical determinism). Slice 4 DONE — `apps/server/src/voice-engine-host.ts` (`VoiceEngineHost`, 120-tick, additive; select via `LEDRUMS_ENGINE=voice`), `setShow`/`key` client messages + `voice` stats added (server + web protocol-types), 34 server tests. StatusCluster ported to the lab — `apps/web/src/lib/trigger-lab/StatusBar.svelte` (engine link/pixels/fps/latency) + store `link`/`latencyMs`. Slice 5 DONE — `show-builder.ts` (`buildShow(store): voice.Show`, structural pass-through, 3 tests), store opens a `WSClient`, sends `setShow` + `setTransport` (on-change only) + `key` on hit, shows server frames when `link==='open'` (else local sim). Full repo green (typecheck 0 errors, **203 tests**). **End-to-end pipeline complete**: lab → WS (`/ws`, Vite-proxied) → `VoiceEngineHost` (`LEDRUMS_ENGINE=voice`) → preview frames back + Art-Net when output armed.

Known limits / follow-ups: (a) voice host snapshots model at construction (no live kit reload). (b) section morph not auto-driven. (c) MIDI/OSC zone convention: server maps slot→label (`SLOT_LABELS`) but lab graphs are keyed by numeric `pad.zone` — the `key` path is self-consistent, but real MIDI input won't resolve until the zone convention is reconciled. (d) voice lanes/bus levels still local-sim (server `voice` stats are dropped by the shared `WSClient`); switch to server-truth = forward `msg.voice` + stop `snapshot()` clobbering when connected. (e) no OutputConfig/LivePill UI in the lab yet → arming Art-Net is server-side only.

**Input model:** MIDI/OSC ingest server-side (same machine). Browser keypresses forward as `{kind:'key', drumId, zone, velocity}` over WS — kept as a convenience, latency accepted.

## Open / parked
- **Reactive surface (option 3):** `--reactive-tint` / `--reactive-amount` hooks exist in tokens. Prototype as an opt-in mode the user evaluates before promoting. Not default.
- **Per-layer 2D preview** needs the server to emit per-layer framebuffers (today only the composited frame streams). Decide protocol addition in slice 4.

## Verification
- `node apps/web/scripts/contrast-check.mjs` (AA gate).
- `pnpm --filter @ledrums/web dev` + Playwright 1.60.0 screenshots (`PLAYWRIGHT_BROWSERS_PATH=~/Library/Caches/ms-playwright`).
- `pnpm typecheck`, `pnpm test`.

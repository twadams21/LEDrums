# 06 — Effect time base (restart-on-trigger), thumbnails, and effect modifiers

> Part of the 2026-07-02 "rock solid" initiative. See [INDEX.md](INDEX.md).

Three topics, one shared mechanism: what time an effect animates against.

## A. Restart-on-trigger (effects "run on a loop")

### Problem

Chase (and friends) spin continuously; a trigger just unmasks the animation mid-cycle, so the hit
might land at the "front" or "back" of the drum, and a fast retrigger appears to do nothing.
Desired: a trigger **starts** the effect from its start position; a retrigger restarts it. Some
effects (3D radial wash) already feel right.

### Current state — root cause

- Voices already track birth: `voice.bornAtMs` set on spawn
  (`packages/core/src/voice/voice-pool.ts:81-127`, :119). The generator bridge
  (`packages/core/src/voice/generator-bridge.ts:41-117`) gives generators **two clocks**
  (:96-98): `trig.ageMs = timeMs - bornAtMs` (hit-relative — resets on retrigger) and
  `ctx.timeMs` (absolute engine time — free-running).
- Effects that feel right use `trig.ageMs`: radial-wash (`impl/radial-wash.ts:54-56`), whole-kit,
  whole-drum, follow-hoop, burst, lightning, confetti.
- Effects that feel wrong use `ctx.timeMs` or `ctx.transport.beat`: chase (`impl/chase.ts:21`,
  beat-indexed), synced-hoops (:27), starfield (:70), collisions (:91), sacred-hogs (:53),
  gravity-wells (:73), breathing-kit (:28), plus comet-trails/orbit-rings/hue-rotate-kit/
  temp-sweep and several textures (~15 total). Retriggering spawns a new voice, but these render
  the same absolute-time frame regardless.

### Design

1. **Give effects a declared timebase.** Add `timebase: 'voice' | 'absolute'` to the
   `EffectGenerator` registry metadata (`packages/core/src/effects/types.ts:32-40`). `'voice'` =
   animate from `trig.ageMs`/a bridge-provided `ctx.localTimeMs`; `'absolute'` = free-running
   (correct for base/ambient loops: breathing-kit, hue-rotate-kit, solid-base noise, plasma-family
   textures when used as looks). The flag is interface, not convention — thumbnails (below) and
   the bridge both read it.
2. **Bridge provides local time**: in `generator-bridge.ts` (:87-98), for `timebase:'voice'`
   generators set `genCtx.timeMs = trig.ageMs` (and derive a voice-local `transport.beat` from
   age×bpm for beat-indexed effects like chase, so "chase starts at hoop 0 on the hit"). Zero
   signature change for generators; conversion is then per-effect: swap `ctx.timeMs` reads to the
   (now voice-local) clock and audit stateful ones (comet-trails uses `ctx.dt` accumulation —
   state must reset per voice: `genState` is per-voice already, verify seeding).
3. **Retrigger semantics** ride the existing voice model: play-mode + bus polyphony already decide
   mono-restart vs poly-layering; with voice timebase, a retrigger = new voice = animation from 0.
   The "does nothing on fast retrigger" case is mono voice reuse — ensure mono steal resets
   `bornAtMs` (check `voice-pool.ts` steal path).
4. **Web parity**: mirror the bridge change in `apps/web/src/lib/trigger-lab/render.ts:177-234`.

## B. Broken thumbnails

### Current state

Pipeline: `effect-thumb-render.ts:39-99` renders the real generator onto a 26×13 synthetic drum
(`kit.ts:123-193` `buildThumbPixelModel`, 338 px, drumId 'thumb'), one shared rAF ticker
(`effect-thumb-ticker.ts`), IntersectionObserver pause, static frame under reduced-motion
(`EffectThumb.svelte:144-188`).

### Why some look broken

- The synthetic trigger has **`ageMs=0` forever** (`effect-thumb-render.ts:24,84,96`) → every
  hit-relative effect (whole-kit, whole-drum, burst…) renders a frozen full-brightness frame that
  never decays. These are precisely "thumbnails that don't work".
- Beat-indexed effects (chase) render off a synthetic 120bpm transport against a 13-hoop drum —
  works but may look unrepresentative vs the real kit's hoop counts.
- Stateful particle effects create state lazily on first draw; paused/offscreen thumbs can show a
  degenerate first frame.

### Design

Drive the synthetic trigger with a **looping age** (e.g. `ageMs = (now % 1600)`) and advance the
synthetic transport beat from the same clock, so hit-relative effects visibly fire-decay-repeat
and voice-timebase effects (post-fix A) show their real onset. Respect `timebase`: absolute
effects keep wall-clock. Static reduced-motion frame: sample at a representative age (~400ms
already used, keep). Audit the 41 thumbs after A lands — most fix themselves.

## C. Effect modifiers (Grain / Bloom / Trail… — Resolume "media effects" analog)

### Where they hook (found seam)

Generator voices already render into a scratch framebuffer before compositing:
`generator-bridge.ts:106-114` — `genScratch.clear(); gen.render(...); loop → dst.add(...)`.
A modifier chain slots **between render and blend**: each modifier transforms `genScratch` in
place over the voice's pixel range. Pattern-path voices (`compositor.ts:171`,
`pattern-renderer.ts`) currently composite per-pixel directly into dst — give modified pattern
voices the same scratch route (only when the voice has modifiers, preserving the zero-alloc hot
path otherwise). Compositor stages: `packages/core/src/voice/compositor.ts:95-175`.

### Model (LOCKED 2026-07-02: modifiers are GRAPH NODES, not a per-node stack)

Trent's call: *"modifiers should be a separate node on the graph that you connect to a distinct
input handle on a play node — this way one modifier can be linked to many effects."* This is the
graph-reuse idiom he prefers everywhere (cf. doc 07 removing `linked`): sharing is explicit
wiring, not a hidden mode.

- **Registry**: new `packages/core/src/modifiers/` mirroring the effects registry:
  `ModifierDef { id, name, category, paramSpec, apply(ctx, params, fb, range, state) }` — a deep
  module per modifier; the chain runner is the only interface the compositor sees.
- **Graph model**: new `GraphNode` kind `'modifier'` (`modifierId`, `params`, `env` — params
  envelope-able via the existing compositor sweep). Modifier nodes take **no part in trigger-flow
  evaluation** (`evalNode` skips them; they never fire children).
- **Wiring**: Play nodes gain a second, visually distinct input handle (`mod`). `GraphEdge` gains
  `toPort?: 'in'|'mod'` (mirror of the existing `fromPort` from band switches; store
  connect/reconnect carry it through like `fromPort`). **This `toPort` + source-kind hit-test
  infrastructure is shared with [doc 10](10-modulation-system.md)**, which extends `toPort` with
  `param:<key>` — and modifier params are themselves modulation targets via doc 10's mappable
  param rows (envelope → Bloom radius, CC → Trail decay). Build this wiring infra once, here,
  with doc 10's extension in mind. One modifier node may wire to many play
  nodes (shared params, per-voice state). Modifier nodes also have their own `mod` input so
  chains are explicit: `Grain → Bloom → Play` applies Grain then Bloom. When several modifiers
  wire in parallel to one play node, chain order = node **y-position** (the Patch graph's
  transmit-order precedent).
  - Drop-anywhere-on-node UX (memory `graph-interaction-prefs`): route by source kind — a wire
    dragged from a modifier node drops onto a node body as its `mod` input; trigger-flow wires
    keep landing on `in`. Extend the DOM hit-test accordingly.
- **Voice resolution**: at spawn, graph compilation resolves the play node's modifier closure
  (walk `mod` edges, order, flatten) into `voice.modifiers: {id, params, env}[]`
  (`voice-pool.ts:81-127`, `eval-graph.ts`). The engine/compositor never see graph topology —
  the resolved chain is the interface. Per-voice modifier state (ring buffers etc.) lives on the
  voice like `genState`; at 548 kit pixels this is trivially small.
- **Scope**: build the full set below AND extend it — Trent: "build all of the modifiers and as
  many more as possible. Full creative expression." Each modifier is an isolated pure module, so
  the set can grow slice by slice behind the same registry interface.

### Full set (Resolume-inspired, adapted to LED strings on 3D geometry — build all, then extend)

| Modifier | Type | Params (sketch) |
|---|---|---|
| Trail / Decay | temporal | decayMs, mode(add/max) — motion smear |
| Echo | temporal | delayMs, repeats, falloff — repeated ghosts |
| Bloom / Glow | spatial | radiusPx (along strip) or radiusMm (3D), strength |
| Grain / Noise | texture | amount, scale, animate(bool) |
| Strobe / Shutter | temporal | rateHz, duty — chops any effect |
| Sparkle | texture | density, decayMs — random pixel glints |
| Pixelate / Quantize | spatial | blockSize — chunky look |
| Mirror | spatial | axis(enum), per-drum/kit — symmetry |
| Hue Shift / Colorize | color | shiftDeg or lock color |
| Saturation / Levels | color | satAmount, gain, gamma, invert(bool) |

Second wave (same registry interface, add as capacity allows): Slide/Offset (shift pixels along
the hoop), Blur (1D along strip), Posterize/Threshold, Feedback (self-echo with transform),
Kaleidoscope (repeat a segment around the hoop), Freeze (hold frame on trigger), Flicker/Glitch,
Chromatic offset (per-channel pixel shift).

(Spatial ones need pixel adjacency — 1D along each hoop is cheap via pixel index; true-3D radius
uses the model's XYZ like radial-wash does. Start 1D.)

### UI

Modifier nodes in the trigger graph: added from the graph palette (`GraphPalette` /
`NODE_KINDS`), rendered with `NodeCard` (icon chip per category, sub-line = modifier name), edited
entirely in the Inspector like every other node kind (new `ModifierNodeInspector` — param editors
identical to effect params, bypass toggle, per-param envelopes). Play nodes render the distinct
`mod` input handle; wires from modifiers styled differently from trigger-flow wires (role colour)
so the two flows read at a glance. Node face shows a bypass state; the play node shows a small
badge with its resolved chain count.

## Touch list

- `packages/core/src/effects/types.ts` (+timebase), `generator-bridge.ts`, ~15 effect impls,
  `voice-pool.ts` (mono-steal bornAtMs check), new `packages/core/src/modifiers/*`,
  `compositor.ts`, `eval-graph.ts`, `voice/types.ts`
- graph layer: `GraphNode`/`GraphEdge` (`toPort`) in core voice types + web sim, `eval-graph.ts`
  (skip modifier kind in fire flow; resolve chains), store connect/reconnect (`toPort` carry),
  `graph-to-flow.ts` + `TriggerNode`/`NodeCard` (mod handle, wire styling, DOM hit-test routing),
  `GraphPalette`/`NODE_KINDS`, new `ModifierNodeInspector`
- `apps/web/src/lib/trigger-lab/render.ts` (parity), `effect-thumb-render.ts`,
  `EffectThumb.svelte`, `persistence.ts` coercion (modifier nodes + toPort)

## Tests

- Timebase: golden frames — voice-timebase effect at age 0/200/800 identical across separate runs
  and across retriggers; chase starts at hoop 0 on fire; mono restart resets age.
- Thumbnails: pure render at looping ages produces non-static output for hit-relative effects.
- Modifiers: pure `apply` goldens per modifier (input fb → output fb); chain resolution from graph
  topology (explicit chain via mod→mod wiring; parallel mods ordered by y; shared modifier node →
  N play nodes = independent per-voice state, shared params); chain order matters test; temporal
  state across ticks; determinism (seeded noise); bypass = identity; modifier nodes inert in
  trigger-flow eval; compositor integration (modified voice vs unmodified baseline);
  `toPort` persistence round-trip.

## Decisions (LOCKED 2026-07-02) / ordering

- **Modifiers are graph nodes** wired to a distinct `mod` input handle on play nodes; one modifier
  feeds many play nodes; chains via mod→mod wiring; parallel order by y-position (Trent's call —
  the earlier per-node-stack proposal is dead).
- **Build the full modifier set** (both tables) and keep extending — "full creative expression".
- A before B (thumbnails inherit the fix). C shares the param work from doc 05 (enum params for
  modifiers) — land 05's ParamValues widening first.
- Per-effect timebase audit list is an implementation deliverable (table in the slice brief).

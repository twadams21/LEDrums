# 05 — Effect property overhaul (full color, enums) + Resolume-style envelopes

> Part of the 2026-07-02 "rock solid" initiative. See [INDEX.md](INDEX.md).

## Problem

Effect controls are missing essentials — most effects expose only hue, so white/pastels are
impossible. Trent wants a professional-lighting-grade property pass over every effect. Separately,
the envelope editor "sucks": the attack handle is stuck at the top and all curves are linked; he
wants Resolume-Arena-like per-segment easings.

## Current state (verified 2026-07-02)

### Color: the engine is NOT the limit

- Framebuffer is full RGBA float already (`packages/core/src/engine/framebuffer.ts:7-46`);
  `hsvToRgb`/`rgbToHsv` exist (`packages/core/src/color/color.ts:17-51`); thumbnails paint true
  generator RGB (`apps/web/src/lib/trigger-lab/effect-thumb-render.ts:35,91`).
- The limits are authoring-level:
  1. **~38 of 41 effects hardcode saturation** — e.g. chase (`packages/core/src/effects/impl/chase.ts:22`)
     calls `hsvToRgb(hue, 1, bri)`. Only `solid-base`, `strobe`, `breathing-kit` expose a
     `saturation` param.
  2. **`mapParamSpec` silently drops `color` and `enum` params** — verified at
     `apps/web/src/lib/trigger-lab/fixtures.ts:97-123`: number/bool map (numbers become
     `envable:true`); the function returns `null` for color/enum with comment "not voice-editable
     yet; generator uses its own default". So radial-wash `mode` (out/in/bounce,
     `impl/radial-wash.ts:33-41`) and wipe-3d `axis`/`mode` (`impl/wipe-3d.ts:16-23`) are stuck.
- Core param model: `ParamType = 'number'|'color'|'enum'|'bool'`
  (`packages/core/src/effects/types.ts:5`, `ParamSpec` :8-20). The web/voice `ParamValues` is
  `number|bool` only — that type is the actual bottleneck (extends into core voice types and the
  WS `setShow` payload).
- Registry of all 41 effects: `packages/core/src/effects/registry.ts:47-89` (solidBase, chase,
  wholeDrum, wholeKit, followHoop, radialWash, wipe3d, meterEq, pixelAccum, colourMelody, strobe,
  syncedHoops, burst, swing, sidechain, sacredHogs, collisions, plasma, fire, ripplePond,
  rainbowFlow, tunnel, checkerPulse, perlinClouds, lavaLamp, interference, caustics, spiral,
  gridGlow, starfield, cometTrails, lightning, confettiBurst, helix, orbitRings, gravityWells,
  breathingKit, tempSweep, velocityFlames, hueRotateKit, waveCollapse).
- Param edit UI: `PlayNodeInspector.svelte:99-127` (sliders/toggles from mapped specs).

### Envelopes

- Shape: `AdsrShape { attack, decay, sustain, release, curve }` —
  `packages/core/src/voice/types.ts:58-65`. **One `curve` (-1..1) drives all three segments**
  through `easeCurve(t, curve)` (a single power law) — core
  `packages/core/src/voice/envelope.ts:59-63` duplicated in web
  `apps/web/src/lib/trigger-lab/sim.envelopes.ts:108-112`.
- Editor: `apps/web/src/lib/trigger-lab/EnvelopeEditor.svelte` — verified the attack handle is
  hardcoded to `cy={yOf(1)}` (:221-223, "A stuck at the top") and there is exactly one Curve
  slider (:265) bound to `adsr.curve`.
- Sampling: `adsrToPoints()` renders the shape to 48 breakpoints (core `envelope.ts:66-89`, web
  mirror `sim.envelopes.ts:115-138`) — the downstream sampler
  (`packages/core/src/voice/compositor.ts:58-77` sweeps envable params between spec min/max by
  `env.amount`) is shape-agnostic, so richer shapes need **no compositor change**.
- Named preset shapes: decay/rise/pluck/pulse (`envelope.ts:54-63`). No general easing library
  exists anywhere in the repo. The voice-level amplitude envelope
  (`packages/core/src/voice/envelope-tick.ts:12-31`) is separate (linear attack ramp) and out of
  scope here.

## Proposed design

### A. Param system: widen the value type, stop dropping specs

1. **`ParamValues` gains string values** (enum) and a color representation. Recommend
   `type ParamValue = number | boolean | string` where color is stored as `'#rrggbb'` string (or
   `{h,s,v}` — decide once; hex keeps the WS payload/JSON trivially serializable and the UI maps
   to a color input). Touches core voice types, web sim types (they're already re-converged —
   change in core, web imports), and zod schemas on the `setShow` path.
2. **`mapParamSpec` maps all four types**: enum → select control; color → color control
   (`envable:false` for both). Delete the `return null` branch (fixtures.ts:122).
3. **Registry-wide property pass** (the "professional show" contract). Define a standard param
   contract and audit every effect against it:
   - Color: every color-producing effect exposes `hue` + `saturation` + `brightness` (or a single
     `color` param where a picker is more natural). White = saturation 0. Multi-color effects
     (rainbowFlow, colourMelody, hueRotateKit…) expose range/offset instead.
   - Motion: `speed`/`rate` with real units; `direction`/`mode` enums exposed (no more hidden
     defaults); `width`/`reach` in mm where spatial.
   - Dynamics: `decayMs` where hit-relative; `intensity` distinct from `brightness` where both
     exist (fire).
   - Deliverable: a table (effect × params before/after) produced during implementation, kept as
     an appendix in the PRD slice brief. Most effects change by ~2-4 lines
     (`hsvToRgb(hue, 1, v)` → `hsvToRgb(hue, sat, v)` + a ParamSpec entry) — wide but shallow.
4. Presets/persistence: existing presets carry `params: ParamValues` — widened type is
   backward-compatible (old numeric params still valid). Defensive coercion in
   `persistence.ts` `coerceAuthored` for the new value kinds.

### B. Envelopes: per-segment easing, movable attack level (Resolume-like)

> **PLACEMENT SUPERSEDED by [doc 10](10-modulation-system.md) (LOCKED 2026-07-02):** envelopes
> become graph **nodes** in the modulation system — one envelope maps to many params via wires to
> per-param rows on target nodes; the inline per-node `env: EnvMap` is migrated away. Everything
> in this section about the **shape model, easings, sampling, and editor features** still applies
> verbatim; the editor UI just lives in the `EnvelopeNodeInspector` instead of the play-node
> inspector, and "envable" params become "mappable" params (doc 10's exposure list).

1. **New shape** (additive, back-compat):
   ```ts
   interface AdsrShape {
     attack: number; decay: number; sustain: number; release: number;
     attackLevel?: number;            // 0..1 peak the attack rises to (default 1)
     curve?: number;                  // legacy single tension — kept for migration
     attackEase?: EaseSpec; decayEase?: EaseSpec; releaseEase?: EaseSpec;
   }
   type EaseSpec = { fn: 'linear'|'quad'|'cubic'|'quart'|'expo'|'sine'|'circ'|'back'|'bounce'|'elastic';
                     dir: 'in'|'out'|'inOut' }   // Resolume-style set
   ```
   Migration: absent `*Ease` + present `curve` → derive the equivalent power ease for all three
   (behavior-preserving, idempotent — follow the `foldVelocitySwitch` migrator pattern).
2. **Single source**: move the envelope shape + easing functions to core
   (`packages/core/src/voice/envelope.ts`) and have the web **import** them, deleting the
   `sim.envelopes.ts` duplicates — the delay-node precedent (`computeDelayMs`: "web imports it —
   single source, no drift") is the pattern. `adsrToPoints` consumes per-segment eases;
   `attackLevel` scales the attack segment target and the decay segment start.
3. **Editor** (`EnvelopeEditor.svelte`): attack handle draggable in Y (`attackLevel`); per-segment
   ease selection — click a segment to select, then ease fn/dir controls (or drag the segment body
   vertically to bend, mapping to the nearest ease, Resolume-style); remove the single Curve
   slider. Reduced-motion + keyboard accessible like existing controls.

## Touch list

- `packages/core/src/effects/types.ts`, `registry.ts`, ~38 files in
  `packages/core/src/effects/impl/*` (param pass)
- `packages/core/src/voice/types.ts` (ParamValues, AdsrShape), `envelope.ts` (eases, adsrToPoints)
- `apps/web/src/lib/trigger-lab/fixtures.ts` (`mapParamSpec`), `sim.envelopes.ts` (delete dupes →
  import core), `EnvelopeEditor.svelte`, `PlayNodeInspector.svelte` (enum/color controls),
  `persistence.ts` (coercion + envelope migrator)
- new `lib/ui` controls if missing: `Select` exists (node-options); add `ColorControl`

## Tests

- Param mapping: all four ParamTypes map; enum/color round-trip through persistence + setShow.
- Per-effect golden render tests for the param pass on a few representatives (chase, radialWash,
  wipe3d): saturation=0 produces white output on lit pixels; enum change alters output.
- Envelope: sampling goldens per ease fn/dir; `attackLevel` respected; legacy-`curve` migrator
  parity test (old shape vs migrated shape sample-identical); idempotency.
- Editor: pure geometry helpers (handle↔shape mapping) unit-tested; component tests via the P1
  jsdom infra.

## Decisions (LOCKED 2026-07-02)

- **Both: picker + envable sliders** (Trent's call). The numeric `hue`/`saturation`/`brightness`
  params are canonical (each individually envelope-able); the inspector additionally renders a
  colour **swatch/picker that writes through to those three params** (pure `hsv↔hex` mapping —
  `color.ts` already has both directions). The swatch reflects the current base values; when a
  param has an envelope, the swatch shows the base and indicates modulation (small env badge)
  rather than trying to animate. Consequence: no separate stored `color` value for these effects —
  the picker is UI-only, so persistence/protocol carry only numbers (the ParamValues widening in
  §A.1 is then needed only for enum strings + the few true static-color params).
- Easing set: ship the full list above (Resolume-familiar); UI groups by family to keep the
  selector compact.

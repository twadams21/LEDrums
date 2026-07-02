# Effect × params audit — the professional-show property pass

> Implementation appendix for doc [05](../../plans/2026-07-02-rock-solid/05-effects-color-params-envelopes.md)
> (Group F). **Started by S19 (colour batch 1)**; extended by S20 (batch 2), S21 (batch 3
> textures), S22 (batch 4 particles). S22 must leave every one of the 41 registry effects
> accounted for.

## The contract (from doc 05 §A.3)

- **Colour**: every colour-producing effect exposes `hue` + `saturation` + `brightness`
  (white = saturation 0), OR a range/offset scheme for intrinsically multi-colour effects
  (rainbow-flow, hue-rotate-kit, colour-melody…). An effect that exposes `hue`+`saturation`
  +`brightness` numeric params automatically gets the write-through **ColorSwatch** in the
  play-node inspector (`PlayNodeInspector.svelte` → `lib/ui/ColorSwatch.svelte`, keyed on
  those three param keys) — no per-effect UI wiring.
- **Motion / Dynamics**: real-unit speed/rate, exposed direction/mode enums (S18), decayMs
  where hit-relative, intensity distinct from brightness. (Batches 2–4 detail these.)

Legend — **Swatch**: ✓ = the generic hue/sat/bri swatch applies · *multi* = range/offset
scheme instead · *n/a* = not colour-producing / no single base hue.

## Batch 1 — S19 (hit/trigger effects) ✅ DONE

Change was uniformly shallow: add a `saturation` ParamSpec after `hue` (default 1) and thread
it into `hsvToRgb(hue, sat, …)`, replacing the hardcoded `hsvToRgb(hue, 1, …)`. All eight
already carried `brightness`, so no brightness additions were needed. `colour-melody` already
had `saturation`+`brightness`.

| Effect | id | Cat | Params before | Params after | Swatch |
|---|---|---|---|---|---|
| Chase | `chase` | trigger | hue, brightness, subdivision | **hue, saturation, brightness**, subdivision | ✓ |
| Whole Drum | `whole-drum` | trigger | hue, brightness, decayMs | **hue, saturation, brightness**, decayMs | ✓ |
| Whole Kit | `whole-kit` | trigger | hue, brightness, decayMs | **hue, saturation, brightness**, decayMs | ✓ |
| Follow Hoop | `follow-hoop` | trigger | hue, brightness, delayMs, decayMs | **hue, saturation, brightness**, delayMs, decayMs | ✓ |
| Burst | `burst` | trigger | hue, brightness, baseDecayMs | **hue, saturation, brightness**, baseDecayMs | ✓ |
| Pixel Accum | `pixel-accum` | trigger | hue, brightness, addPerHit, decayMs | **hue, saturation, brightness**, addPerHit, decayMs | ✓ |
| Synced Hoops | `synced-hoops` | base | hue, hueSpread, brightness, speed | **hue, saturation**, hueSpread, brightness, speed | ✓ |
| Swing | `swing` | trigger | hue, brightness, gain, decayMs | **hue, saturation, brightness**, gain, decayMs | ✓ |
| Colour Melody | `colour-melody` | trigger | saturation, brightness | *(unchanged)* | *n/a* — hue is per-note (0..127→0..360); sat+bri sliders only |

Evidence: `effects.test.ts › S19 colour batch 1 — saturation 0 ⇒ white on lit pixels` (one
golden per effect: lit>0 AND every lit pixel achromatic) plus a knob-is-real check
(hue 120 / sat 1 → not white). Swatch reflect + write-through: `ColorSwatch.test.ts`.

## Batch 2 — S20 (wash / base / utility / meter) ✅ DONE

Same shallow pass as batch 1: add a `saturation` ParamSpec after `hue` (default 1) and thread
it into `hsvToRgb(hue, sat, …)`. `radial-wash`, `wipe-3d` and `meter-eq` gained it (meter-eq
keeps its base `hue` + `hueSpread`, so like `synced-hoops` it still gets the swatch).
`solid-base`, `breathing-kit`, `strobe`, `hue-rotate-kit` and `sidechain` already exposed +
threaded `saturation` — no code change, just confirmed the contract and the swatch. Two effects
are intrinsically multi-colour and stay swatch-less: `hue-rotate-kit` (base hue + vertical
spread) and `temp-sweep` (now exposes its warm/cool hue **endpoints** as a range + a shared
saturation, replacing the hardcoded amber/blue consts).

| Effect | id | Cat | Params before | Params after | Swatch |
|---|---|---|---|---|---|
| 3D Radial Wash | `radial-wash` | wash | hue, brightness, mode, speed, width, reach, decayMs | hue, **saturation**, brightness, mode, speed, width, reach, decayMs | ✓ |
| 3D Wipe | `wipe-3d` | wash | axis, mode, hue, brightness, speed, width | axis, mode, hue, **saturation**, brightness, speed, width | ✓ |
| Meter (EQ) | `meter-eq` | meter | hue, brightness, level, hueSpread | hue, **saturation**, brightness, level, hueSpread | ✓ |
| Temperature Sweep | `temp-sweep` | wash | kz, speed, brightness | **warmHue, coolHue, saturation**, kz, speed, brightness | *multi* — warm/cool hue endpoints (range), no single hue |
| Solid Base (Swirl) | `solid-base` | base | hue, saturation, brightness, speed, noise | *(unchanged — already compliant)* | ✓ |
| Breathing Kit | `breathing-kit` | base | hue, rate, depth, brightness, saturation | *(unchanged)* | ✓ |
| Hue Rotate Kit | `hue-rotate-kit` | base | baseHue, speed, ky, brightness, saturation | *(unchanged)* | *multi* — base hue + vertical spread (`ky`), no single hue |
| Strobe | `strobe` | utility | hue, saturation, brightness, rate | *(unchanged)* | ✓ |
| Sidechain Pump | `sidechain` | utility | hue, saturation, brightness, duckDepth, recoverMs | *(unchanged)* | ✓ |

Evidence: `effects.test.ts › S20 colour batch 2 — saturation 0 ⇒ white on lit pixels` (one
golden per effect: lit>0 AND every lit pixel achromatic) + a knob-is-real negative check +
a byte-identical defaults-parity check (saturation default 1 == the old hardcoded look).

## Batch 3 — S21 (textures) ✅ DONE

Same shallow change: a `saturation` param (default 1) multiplied into each effect's existing
S-slot — whether a literal (`1`, `0.95`, `0.9`) or a computed sat (fire/perlin/lava/caustics'
heat- or density-driven wash) — so defaults reproduce the old look and `saturation` 0 washes
every lit pixel to white. `lava-lamp` and `caustics` hardcoded their palette hue, so each also
gained a base `hue` param; with `hue`+`saturation`+`brightness` present, all eleven single-hue
textures light up the write-through **ColorSwatch** automatically (no per-effect UI).

**Multi-colour (*multi*): `tunnel` and `rainbow-flow` only.** Both sweep a *full* hue wheel
across space (tunnel's angle → ±180°, rainbow-flow's `(u+v)` → 360°), so a single-colour picker
would be actively misleading. They use an offset/range scheme instead and deliberately carry no
bare `hue` param → no swatch. Everything else that merely *spreads* hue around a base (plasma
`hueSpread` 120, ripple-pond `hueSpread` 80, spiral/interference ≤ ~88°) is treated as
single-hue **with a swatch on the base** — matching the S19 precedent for `synced-hoops`
(hue + hueSpread → swatch ✓). "Spreads hue" ≠ "*multi*"; only a full-wheel sweep is.

| Effect | id | Cat | Params before | Params after | Swatch |
|---|---|---|---|---|---|
| Plasma | `plasma` | texture | brightness, speed, scale, hue, hueSpread | brightness, speed, scale, hue, **saturation**, hueSpread | ✓ |
| Fire | `fire` | texture | brightness, speed, scale, hue, intensity | brightness, speed, scale, hue, **saturation**, intensity | ✓ |
| Ripple Pond | `ripple-pond` | texture | brightness, freq, speed, hue, hueSpread | brightness, freq, speed, hue, **saturation**, hueSpread | ✓ |
| Rainbow Flow | `rainbow-flow` | texture | brightness, saturation, bands, speed | brightness, saturation, **hueOffset**, bands, speed | *multi* — full-wheel rainbow; offset rotates it, sat → greyscale |
| Tunnel | `tunnel` | texture | brightness, rings, speed, hue | brightness, **saturation**, rings, speed, **hueOffset** (was hue), **hueRange** | *multi* — angle sweeps full wheel; offset+range control it |
| Checker Pulse | `checker-pulse` | texture | brightness, cols, rows, speed, hue | brightness, cols, rows, speed, hue, **saturation** | ✓ |
| Perlin Clouds | `perlin-clouds` | texture | scale, speed, hue, brightness | scale, speed, hue, **saturation**, brightness | ✓ |
| Lava Lamp | `lava-lamp` | texture | blobs, speed, brightness | blobs, speed, **hue**, **saturation**, brightness | ✓ — base hue added (was hardcoded 8°) |
| Interference | `interference` | texture | freq, speed, hue, brightness | freq, speed, hue, **saturation**, brightness | ✓ |
| Caustics | `caustics` | texture | scale, speed, brightness | scale, speed, **hue**, **saturation**, brightness | ✓ — base hue added (was hardcoded 200°) |
| Spiral | `spiral` | texture | arms, twist, speed, hue, brightness | arms, twist, speed, hue, **saturation**, brightness | ✓ |
| Grid Glow | `grid-glow` | texture | cols, rows, speed, hue, brightness | cols, rows, speed, hue, **saturation**, brightness | ✓ |
| Wave Collapse | `wave-collapse` | wash | hue, brightness, speed, width, reach, decayMs | hue, **saturation**, brightness, speed, width, reach, decayMs | ✓ |

Evidence: `effects.test.ts › S21 colour batch 3 — saturation 0 ⇒ white on lit pixels (textures)`
(one golden per effect: lit>0 AND every lit pixel achromatic) + a knob-is-real check
(plasma hue 120 / sat 1 → not white). Default parity: the pre-existing `all effects`,
`batch-b`, and `batch-c` finite/in-range goldens still pass unchanged.

## Batch 4 — S22 (particles) ✅ DONE — closes the audit (all 41 accounted for)

Same shallow pass: add a `saturation` ParamSpec after `hue` (default matching the old
hardcoded S-slot) and thread it into every `hsvToRgb(hue, sat, …)`. Six effects carry a real
base `hue` and so get the generic swatch — `starfield` (default saturation **0.15**, its old
near-white tint), `comet-trails` (base hue + per-comet ±30° offset, like `synced-hoops`),
`lightning` (default saturation **0.35**, its old blue-white core), `helix` and `orbit-rings`
(base hue + spatial spread), and `collisions` (base node `hue` drives the swatch; `flashHue`
stays a separate accent, both desaturated by the shared saturation). Four are intrinsically
multi-colour and stay swatch-less, taking a range/offset scheme + shared saturation (the
`temp-sweep` precedent): `confetti-burst` and `gravity-wells` remap their random full-spectrum
hues to `baseHue`+`hueSpan` (defaults 0/360 reproduce the old `rng()*360` draw byte-for-byte),
`velocity-flames` exposes its yellow→red palette as `baseHue`/`tipHue` endpoints with saturation
scaling the intrinsic whiter-base/redder-tip ramp, and `sacred-hogs` already had `hogHue`+`haloHue`
and just gains the shared saturation.

| Effect | id | Cat | Params before | Params after | Swatch |
|---|---|---|---|---|---|
| Starfield | `starfield` | particle | count, rate, hue, brightness | count, rate, hue, **saturation**, brightness | ✓ — default sat 0.15 (near-white tint) |
| Comet Trails | `comet-trails` | particle | comets, speed, tail, hue, brightness | comets, speed, tail, hue, **saturation**, brightness | ✓ |
| Lightning | `lightning` | particle | hue, boltWidth, decayMs, brightness | hue, **saturation**, boltWidth, decayMs, brightness | ✓ — default sat 0.35 (blue-white core) |
| Confetti Burst | `confetti-burst` | particle | count, spread, gravity, life, brightness | count, spread, gravity, life, **baseHue, hueSpan, saturation**, brightness | *multi* — random per-particle hue over a range, no single hue |
| Helix | `helix` | wash | kz, ka, speed, hue, brightness | kz, ka, speed, hue, **saturation**, brightness | ✓ — base hue + phase-spread ribbon |
| Orbit Rings | `orbit-rings` | wash | amp, speed, width, hue, brightness | amp, speed, width, hue, **saturation**, brightness | ✓ — base hue + angular spread |
| Gravity Wells | `gravity-wells` | wash | wells, speed, reach, brightness | wells, speed, reach, **baseHue, hueSpan, saturation**, brightness | *multi* — per-well seeded hues over a range, no single hue |
| Collisions | `collisions` | wash | hue, flashHue, brightness, nodesPerHoop, speed, flashWidthDeg | hue, **saturation**, flashHue, brightness, nodesPerHoop, speed, flashWidthDeg | ✓ — node hue + separate flashHue accent |
| Sacred HOGs | `sacred-hogs` | wash | hogHue, haloHue, brightness, hogsPerHoop, speed, hogWidthDeg | hogHue, haloHue, **saturation**, brightness, hogsPerHoop, speed, hogWidthDeg | *multi* — hog + halo hues, no single hue |
| Velocity Flames | `velocity-flames` | trigger | decayMs, flicker, brightness | decayMs, flicker, **baseHue, tipHue, saturation**, brightness | *multi* — body→crest hue gradient endpoints |

Evidence: `effects.test.ts › S22 colour batch 4 — saturation 0 ⇒ white on lit pixels` (one
golden per effect: lit>0 AND every lit pixel achromatic) + a knob-is-real negative check
(orbit-rings hue 120 / sat 1 ≠ white) + a byte-identical defaults-parity check over the effects
whose colour maths were restructured (starfield 0.15, lightning 0.35, confetti-burst + gravity-wells
range remap, velocity-flames gradient endpoints).

---

**Tally:** 41 registry effects total (`registry.ts`), all accounted for across the four batches.
Batch 1 = 9 ✅ · batch 2 = 9 ✅ · batch 3 = 13 (S21, in flight) · batch 4 = 10 ✅ → 41.

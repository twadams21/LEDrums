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

## Batch 2 — S20 (wash / base / utility / meter) ⬜ PENDING

`radial-wash`, `wipe-3d`, `solid-base`*, `breathing-kit`*, `hue-rotate-kit` (*multi*),
`strobe`*, `temp-sweep`, `meter-eq`, `sidechain`.
(*`solid-base`, `breathing-kit`, `strobe` already expose `saturation` — finish their contract
and confirm the swatch applies.)

## Batch 3 — S21 (textures) ⬜ PENDING

`plasma`, `fire`, `ripple-pond`, `rainbow-flow` (*multi*), `tunnel`, `checker-pulse`,
`perlin-clouds`, `lava-lamp`, `interference`, `caustics`, `spiral`, `grid-glow`,
`wave-collapse`. Multi-colour ones expose range/offset where a single hue is wrong.

## Batch 4 — S22 (particles) ⬜ PENDING — closes the audit (all 41 accounted for)

`starfield`, `comet-trails`, `lightning`, `confetti-burst`, `helix`, `orbit-rings`,
`gravity-wells`, `collisions`, `sacred-hogs`, `velocity-flames`.

---

**Tally:** 41 registry effects total (`registry.ts`). Batch 1 = 9 done · batch 2 = 9 ·
batch 3 = 13 · batch 4 = 10 → 41.

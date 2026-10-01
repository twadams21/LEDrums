# S03 — Generators: 9 facades + Splice / Slice, with Styles

Read first: `00-overview.md`, then the spec section "Generators" (the full Style mapping) and user
stories 33–38.

Builds on S01, which created `packages/core/src/effect-chain/generators.ts` with a minimal table
and `resolveGenerator(device)`. This slice owns and completes that file.

## Build

1. **Complete the generator registry** (data-driven), in `effect-chain/generators.ts` or split
   under `effect-chain/generators/`.
   - The kinds are solid, gradient, wave, noise, particles, pattern, meter, lightning, scene,
     splice and slice. Each has a label, a short description, an icon hint (a lucide name the UI
     can use) and a default Style.
   - **Styles** exactly per the spec mapping. Each Style points at one existing generator
     implementation (`effectId`), with a display label. It optionally carries a param overlay:
     renames, hidden params, and default overrides for merged presets.
2. **Merges** (Trent approved).
   - **wave-collapse → radial-wash.** radial-wash gains a `collapse` mode that reproduces
     wave-collapse's radius motion. The Wave style list has no separate wave-collapse. Prove it
     with a golden of radial-wash `collapse` versus wave-collapse at matched params, or document
     the exact delta if the deltas cannot be matched.
   - **follow-hoop → whole-drum.** whole-drum gains `hoopDelayMs` (default 0, which is today's
     output exactly). The whole-drum Style is labelled **Simple**. follow-hoop is reachable as
     Simple with `hoopDelayMs` > 0; there is no separate style. Golden: Simple with the delay
     versus follow-hoop at matched params, same caveat as above.
   - The merged-away implementations stay in the registry (internal) until S08. Do not delete
     them.
3. **Param specs for the UI.** `generatorParamSpec(kind, style) → ParamSpec[]`, the params the
   Generator card shows for that Style. It comes from the underlying paramSpec plus the overlay.
   Include a `listGenerators()` API. Common params (hue / saturation / brightness / speed) use
   consistent labels where they exist.
4. **Splice and Slice as generators.**
   - The device shape is `GeneratorDevice.kind: 'splice' | 'slice'`, with the existing splice or
     slice settings as params (partition, count, jitter, seed, chase, rate mode / division / ms,
     order, drum order, colour order, bleed, motion mode, wait mode, tint, …: verify the real
     field list). It has `slots: [{ color?: hex, generator?: GeneratorDevice, blank?: boolean }]`,
     where a slot is a colour or a nested non-splice Generator.
   - Resolve with the EXISTING splice / slice machinery: build `splice: SpliceConfig` via the
     existing resolver (`resolveSpliceConfig` or equivalent), and `spliceInputs` drafts per
     non-blank slot, from nested generators.
   - Put this in `effect-chain/resolve-splice.ts`, called from `resolveGenerator` / the S01
     resolver hook. If S01's resolver needs a one-line hook to call it, make that minimal edit and
     report it.
   - Tim's recent behaviour (move around, move through, order, cascade, material regeneration)
     must work unchanged. Reuse the existing splice / slice render tests as the oracle.
5. **Scene.** Style = a scene picker (a param holding a canvas-scene id) that resolves to
   `canvas:<sceneId>`.

## Anchors to verify first

- The S01 generators table and `resolveGenerator` contract.
- `effects/registry.ts` (`getEffect` / `tryGetEffect`, the canvas fallback) and `effects/types.ts`
  `ParamSpec`.
- `effects/impl/radial-wash.ts`, `wave-collapse.ts`, `whole-drum.ts`, `follow-hoop.ts`.
- `voice/splice.ts` / `voice/slice.ts`: `resolveSpliceConfig` and how `eval-graph` builds
  `splice` / `spliceInputs` from a splice node and its slots (`SpliceDef`). Mirror that from device
  data.
- The existing splice / slice tests (`splice.render.test.ts`, `slice.test.ts`) as oracles.

## Scope fence

- `packages/core/src/effect-chain/generators*.ts` / `effect-chain/generators/**`,
  `effect-chain/resolve-splice.ts`
- `effect-chain/resolver.ts`: a minimal hook only
- `packages/core/src/effects/impl/radial-wash.ts`, `effects/impl/whole-drum.ts`,
  `effects/metadata.ts` (descriptions)
- New tests

**Do NOT edit:** `voice/compositor.ts`, `voice/engine.ts`, `modifiers/**` (S02 owns them in this
wave), or `index.ts` (report exports).

## Acceptance

- Every non-deprecated existing effect id appears as exactly one Style, except wave-collapse and
  follow-hoop (merged) and strobe and sidechain (dropped). Add a test that asserts coverage
  against the registry, with an explicit exclusion list.
- For each Style at default params, rendering through `resolveGenerator` is identical to rendering
  the underlying implementation directly (table-driven golden).
- radial-wash / whole-drum defaults are bit-identical to before. The collapse and hoop-delay
  goldens are as above.
- A Splice Effect with 2 colour slots and 1 nested Wave slot renders identically to the equivalent
  graph splice node (a graph-path oracle built in the test), including one move-around case and
  one move-through case.
- An unknown kind or style resolves to null without throwing.
- Gates: typecheck, targeted vitest (effects, effect-chain, splice / slice), dead-code.

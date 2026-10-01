# S01 — Core Effect model, resolver, and engine path (pioneer / tracer)

Read first: `00-overview.md` (dispatch rules) and the spec sections "Domain model",
"Engine changes" (Always / Clock / Cue / Retrigger / Amp envelope / Velocity control) and
"Target".

## Goal

A pure core module defines the authored **Effect** model. The voice engine plays it end to end:
an authored Show whose sections carry `effects` fires the right Effects for:

- zone hits;
- Always (on section recall);
- Clock (transport beat grid);
- Cue (MIDI note / CC / OSC).

Each fire is a normal `PlayAction`, so the voice pool, envelopes, generator bridge, modifier chain
and compositor work unchanged. The graph path keeps working for sections without `effects`
(expand-contract).

## Build

1. **New core module `packages/core/src/effect-chain/`**, pure (no Node, DOM or IO).
   - **Types + zod schema:** `Effect`, `EffectCell`, `EffectTrigger`, `Retrigger`, `AmpEnvelope`,
     `GeneratorDevice`, `ModifierDevice` (`uid`, `modifierId`, `params`, `mix` default 1,
     `envelope?` (ADSR over voice life), `bypass`), `ControlDevice` (`uid`, `kind`:
     envelope | lfo | velocity | random | cc | osc | note | audio, `settings`,
     `mappings[{ device: 'generator' | <modifierUid>, param, amount, invert, rangeMin?, rangeMax? }]`),
     `EffectTarget` (`kit` | `hitDrum` | `select { drums: [{ drumId, hoops?: number[] }] }`),
     `BlendMode` (reuse the existing blend-mode union) and `opacity`.
   - Use the shape in the spec. Defaults are applied by the schema so a minimal Effect parses.
     The trigger kind must agree with `cell.column`; the schema refines this.
   - **`generators.ts`:** the generator registry interface. `GeneratorKind` ids are solid,
     gradient, wave, noise, particles, pattern, meter, lightning, scene, splice, slice. A
     `GeneratorDef` has an id, a label, and `styles[{ id, label, effectId, params? }]`. Provide
     `resolveGenerator(device) → { effectId, params, canvasScene? }`.
     - Ship ONLY a minimal table so the tracer works: solid/solid → solid-colour,
       solid/simple → whole-drum, wave/radial → radial-wash, wave/chase → chase-bands.
     - **S03 owns and completes this file**, so keep it data-driven.
     - An unknown kind or style resolves to `null`, and the Effect is skipped with a diagnostic,
       never a throw.
   - **`resolver.ts`, the ONE seam:**
     - `matchSectionEffects(section, event) → Effect[]`: zone and cue matching, section order,
       bypassed Effects excluded.
     - `effectPlayAction(effect, ctx) → PlayAction`: the generator via `resolveGenerator`; the
       modifier chain; mappings from controls; the amp envelope; the target; blend, opacity and
       layer order.
       - Modifiers become `ResolvedModifier[]`, carrying the new `mix` / `envelope` fields
         (typed, passed through; S02 implements their render semantics). Bypass is preserved.
       - Controls become `Mapping[]` on the generator params, and per-modifier `modulations` on
         the owning modifier. Ranges default to the param spec range, as
         `resolveNodeModulations` does today.
       - The amp envelope maps to the action's `attackMs` / `sustainMs` / `releaseMs`
         (`length` ms or beats → sustain; `hold` → hold mode; `loop` → loop mode). Decay and
         sustain level are expressed as a gain curve, reusing the `lifeEnvelope` curve
         mechanism where possible.
       - The target maps to scope / targetId, plus a new multi-target list (below).
     - `alwaysEffects(section)` and `clockEffectsCrossed(section, prevBeat, beat) → Effect[]`.
2. **`voice/types.ts`.**
   - `SongSection` gains optional `effects?: Effect[]` and `master?: ModifierDevice[]`.
   - `PlayAction` / `Voice` gain `chainEffectId?`, `blend?`, `opacity?`, `layerOrder?` and
     `targets?: string[]` (a union of drum / hoop target ids).
   - `ResolvedModifier` gains `mix?` / `envelope?`.
   - All additive; absent fields mean today's behaviour exactly.
3. **`voice/engine.ts`.** When the active section has `effects` defined, even as an empty array,
   the section runs on the Effect path; otherwise it keeps the graph path, unchanged.
   - Input events use `matchSectionEffects`.
   - Section recall spawns Always Effects in loop mode, replacing that section's looks on the
     Effect path.
   - `tick` fires Clock Effects on beat-grid crossings. It must stay deterministic in event-log
     order; add a test.
   - A new input kind `fireEffect { effectId }` auditions one Effect of the active section (a
     manual fire, for keyboard audition and later MIDI-map). Route it like `fireGraph`, but do
     not remove `fireGraph`.
   - **Retrigger:**
     - `overlap` spawns a new voice.
     - `restart` releases the live voices with the same `chainEffectId`, then spawns.
     - `ignore` skips if a live, non-releasing voice with that `chainEffectId` exists.
   - Velocity scales level exactly as today's hit path does.
   - **Buses:** the Effect path must work with a Show whose `buses` / `effects` / `presets` are
     empty. Choose the internal bus handling (see anchors) and document it in the commit body.
4. **`voice/modulation.ts`.** Add a `velocity` `ModSource` (reads the host voice's spawn velocity,
   0..1).
5. **`voice/compositor.ts`.** Change ONLY `pixelRangesFor`: when `targets` is present, use the
   union of those targets' ranges (each target is a drum id or a `drum#h1,h2` hoop id, as
   today). Otherwise behaviour is unchanged.

## Anchors to verify first

- `SongSection` / `Show` / `Voice` live in `voice/types.ts`; `PlayAction` and `makePlayDraft` in
  `voice/eval-graph.ts`.
- Engine resolution and section looks: `engine.ts` `resolveGraphsForEvent` / `resolveHitGraphs` /
  `resolveDirectGraphs` / `processFireGraph` / `fireGraph` / `applyActions` / `spawnSectionLooks` /
  `recallTo` / `tick`.
- `ModSource` / `Mapping` / `applyModulations` are in `voice/modulation.ts`; `Mapping` sampling is
  in `compositor.ts` `applyEffectiveParams`.
- `VoicePool.spawn(action, sourceDrumId, velocity, deps)` in `voice/voice-pool.ts`. Check what it
  needs from `deps` (bus / effect lookups) and how `PlayAction.effectId` becomes a generator
  (`gen:<id>` vs bare id; `canvas:<sceneId>`). **This decides how the Effect path spawns without
  `EffectDef`s** — your key premise.
- Blend-mode union in `color/blend.ts`.
- Test harnesses: `voice/engine.test.ts`, `voice/determinism.test.ts`,
  `voice/runtime-test-fixtures.ts`.

## Scope fence (may mutate)

- `packages/core/src/effect-chain/**` (new)
- `packages/core/src/voice/types.ts`, `engine.ts`, `voice-pool.ts` (retrigger / spawn plumbing
  only), `modulation.ts` (velocity source), `compositor.ts` (`pixelRangesFor` only)
- `packages/core/src/index.ts` (exports)
- New tests under `packages/core/src/effect-chain/` and `packages/core/src/voice/`

**Non-goals:**

- compositor blend / opacity / master / modifier mix semantics (S02);
- the full generator table and Splice / Slice (S03);
- protocol, server and web (S04+);
- deleting anything.

## Acceptance (tests at the engine seam: `setModel` → `setShow` → `applyInput` → `tick` → `frame`)

- A zone Effect on the (kick, slot 0) cell lights kick pixels on a kick zone-0 hit, and nothing on
  a snare hit.
- A Cue Effect fires from its MIDI note, CC and OSC address. A Cue source that is also a zone note
  follows the existing precedence (document which).
- An Always Effect renders after section recall and releases on recall of another section.
- A Clock Effect `every: 1 beat` fires exactly once per beat crossing over N beats (determinism
  replay test).
- Retrigger: `overlap` gives 2 voices; `restart` gives 1 live voice plus 1 releasing; `ignore`
  gives 1 voice.
- The amp envelope shapes level over time: attack ramp, decay to sustain level, release.
- The velocity control maps velocity to a param; different velocities give different frames.
- Target `select` of two drums lights exactly those drums' pixels; `hitDrum` lights the struck
  drum.
- A section without `effects` still runs the graph path: the existing engine tests pass
  untouched.
- `fireEffect` auditions an Effect.
- Gates: typecheck, targeted vitest over `packages/core` (touched areas), dead-code.

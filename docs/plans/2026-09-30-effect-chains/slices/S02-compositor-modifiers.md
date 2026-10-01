# S02 — Compositor blend/opacity, section Master chain, modifier Mix + envelope, Strobe upgrade

Read first: `00-overview.md`, then the spec sections "Engine changes" (Modifier mix and envelope,
Strobe, Blend and opacity, Master chain) and "Modifiers" user stories 39–45 and 72.

Builds on S01, which already carries these fields end to end, typed but inert:

- `Voice` / `PlayAction`: `blend`, `opacity`, `layerOrder`, `chainEffectId`;
- `ResolvedModifier`: `mix`, `envelope`;
- `SongSection`: `master`.

This slice gives them render semantics.

## Build

1. **Modifier chain runner** (`modifiers/chain.ts`, `modifiers/types.ts`).
   - **Per-link mix.** When `mix < 1`, or an `envelope` is present, snapshot the link's range
     before `apply`, run `apply`, then lerp: `out = dry + (wet − dry) × mixEff`.
     - `mixEff = clamp01(mix) × envGain(ageMs)`.
     - `envGain` is an ms-based ADSR over the host voice's age: attack ramp, decay to sustain
       level, optional length (hold), then release to 0.
     - Use `ctx.timeMs`, the voice-local age, already on the modifier context. Add fields to the
       context only if needed; document them.
   - **Performance.** Snapshots use preallocated scratch, not per-frame allocation. With
     `mix == 1` and no envelope, the runner takes today's exact path.
   - **Where it applies.** Both `applyModifierChain` and `applyScopedModifierChain` (`full-output`
     and `range-local`) honour mix.
2. **Strobe** (`modifiers/impl/strobe.ts`).
   - **Off state:** `offMode: black | dim | colour` (default black, today's behaviour),
     `offLevel` 0..1 for dim, and `offColor` hex for colour, which strobes between the input and
     that colour.
   - **Fade** 0..1: 0 is today's hard gate; higher values give soft edges and a per-flash decay,
     as a smooth window over the phase.
   - It stays deterministic from the voice clock. It must be bit-identical to today at defaults.
3. **Compositor blend / opacity / order** (`voice/compositor.ts`, `voice/generator-bridge.ts` if
   needed).
   - Voices with `layerOrder` defined (the Effect path) composite in ascending `layerOrder`,
     stable by spawn order. Voices without it keep today's order.
   - A voice with `blend` ≠ `add`, or `opacity` ≠ 1, renders into scratch, then composites into
     the destination with `compositeInto` (existing `color/blend.ts`) at `opacity × level`.
   - Otherwise it takes today's exact additive fast path.
   - Splice and slice voices honour blend and opacity at their final landing.
4. **Section Master chain.**
   - **Core function.** A pure core function, `applySectionMaster(frameFb, master, state, ctx)`,
     in `packages/core/src/effect-chain/master.ts`.
     - It runs the section's `master` modifiers (ModifierDevices resolved like voice modifiers,
       including mix and envelope, where the envelope clock is the time since section recall)
       over the whole composited frame as `full-output`.
     - State lives in an opaque object the caller owns.
   - **Engine.** The engine calls it after `compositor.render` and before blackout / master
     brightness in `frame()`. It resets that state on section recall and when the model changes.
   - **Sim.** Export it for the web Sim (wired in S05).

## Anchors to verify first

- `runChain`, `applyModifierChain` and `applyScopedModifierChain` in `modifiers/chain.ts`, and
  `ModifierDef` / `ModifierContext` in `modifiers/types.ts`.
- `strobe.ts` params and logic.
- `createDefaultCompositor().render` in `voice/compositor.ts`; the `renderVoice` additive `dst.add`
  path in `voice/generator-bridge.ts`; Mix-voice `compositeInto` usage (a model for the
  scratch-and-blend path).
- `frame()`, `tick` and `recallTo` in `voice/engine.ts`, to place the master stage.
- How S01 populated `mix` / `envelope` / `layerOrder` / `blend` / `opacity`. Read its tests.

## Scope fence

- `packages/core/src/modifiers/chain.ts`, `modifiers/types.ts`, `modifiers/impl/strobe.ts`
- `packages/core/src/voice/compositor.ts`, `voice/generator-bridge.ts`
- `packages/core/src/voice/engine.ts` (master stage + state only)
- `packages/core/src/effect-chain/master.ts` (new) and new tests beside the files above

**Do NOT edit:**

- `effect-chain/resolver.ts` and `effect-chain/generators.ts` (S03 owns them in this wave);
- `packages/core/src/index.ts` (report new exports instead).

## Acceptance

- **Goldens against pre-change output:**
  - a chain with mix 1 and no envelope is bit-identical;
  - Strobe at defaults is bit-identical;
  - `add` at opacity 1 is bit-identical, including the existing compositor and modifier suites
    untouched.
- Mix 0.5 on a levels / hue-shift modifier gives the midpoint of dry and wet.
- A modifier envelope with a 0 sustain level and attack/decay gives full effect early in the life
  and none after the decay.
- Strobe `offMode: colour` alternates between the input and `offColor`; `dim` gives input ×
  `offLevel`; `fade` > 0 gives intermediate values at the edges.
- Two stacked Effects with `normal` blend at opacity 0.5 give the documented composite.
  `layerOrder` controls which is on top (engine seam test).
- The master chain (for example levels at brightness 0.5) halves the whole frame and resets on
  section recall (engine seam test). Blackout and brightness are still applied after it.
- Gates: typecheck, targeted vitest (modifiers, voice), dead-code.

---
name: add-modifier
description: Add a pure framebuffer Modifier that Effect chains and the section Master chain can use (registry, mix / envelope contract, card, tests).
triggers:
  - "modifier"
  - "add a modifier"
  - "master chain modifier"
  - "changing light"
edges:
  - target: context/conventions.md
    condition: before writing modifier code
  - target: context/architecture.md
    condition: to see where the modifier chain runs in the Effect-chain pipeline
  - target: patterns/add-generator-style.md
    condition: when the look MAKES light instead of changing it (that is a Generator Style)
last_updated: 2026-09-30
---

# Add a Modifier

## Context

Source of the model: `docs/plans/2026-09-30-effect-chains/spec.md` ("Modifiers", "Engine changes"),
whose decisions are Trent's, building on Tim's voice note relayed by Trent (two-colour strobe,
strobe fade, per-modifier envelopes). Terms: `CONTEXT.md` (Modifier, Master chain).

- A **Modifier** transforms light from earlier in the chain and never makes its own. If the look
  generates light, it is a Generator Style, not a Modifier.
- Definitions live in `packages/core/src/modifiers/impl/<id>.ts` as a `ModifierDef` and are
  registered in `packages/core/src/modifiers/registry.ts`. Everything else derives from the
  registry:
  - the device strip's add slot (`app/views/effects/strip/AddDeviceSlot.svelte`) groups
    `listModifiersByCategory()` (`modifiers/palette.ts`);
  - the Modifier card (`strip/cards/card-model.ts`) renders the def's `paramSpec` and picks its
    icon from the `category` (`strip/cards/device-icons.ts`);
  - the store only adds a modifier id that `tryGetModifier` knows (`trigger-lab/effects-doc.ts`).

  A registered modifier appears in Effect chains and in the Master chain with no UI code.
- One runner applies every chain: `applyModifierChain` / `applyScopedModifierChain`
  (`modifiers/chain.ts`). It is used for an Effect's modifiers (per voice, on the voice clock)
  and for the section Master chain (`effect-chain/master.ts`, whole frame, on the section clock).
- **Mix and envelope are the runner's job, not yours.** Every authored `ModifierDevice` has a
  `mix` (dry/wet) and an optional envelope. The runner snapshots the range and lerps
  `dry + (wet − dry) × mix × envGain(timeMs)`. Your `apply` always renders fully wet.
- Control devices and MIDI-map `param` targets can drive any **numeric** param in `paramSpec`
  (non-number params are skipped by the resolver's mapping step).

## Steps
1. Create `packages/core/src/modifiers/impl/<id>.ts` exporting `export const <camelId>: ModifierDef<State?>`.
2. Declare `id` (kebab-case, stored in authored shows, never rename it once shipped), `name`,
   `category` (`temporal` | `spatial` | `texture` | `color`), `scopePolicy` and `paramSpec`.
   - `scopePolicy: 'full-output'` for temporal / noise fields whose clock or state must advance
     once per frame over the whole output. `'range-local'` for strip transforms that operate on
     each selected run independently.
   - Give every param a `default` that makes the modifier do something visible. A newly added
     device stores empty `params` (`effects-doc.ts` `addModifier`), so it renders the defaults.
     Use pixel units explicitly for strip / pixel controls.
3. Implement `apply(ctx, params, fb, range, state)` as a pure in-place transform over `range`.
   `ctx.timeMs` is the host clock (voice age, or section age on the Master chain). `ctx.dt` is the
   frame delta.
4. If it needs buffers, shuffled maps or accumulators, add `createState(model, range)`. For a
   `full-output` modifier with state, consider `createCheckpoint` (see `ModifierCheckpoint` in
   `modifiers/types.ts`). Without it the runtime falls back to a full-state copy.
5. Register it in `modifiers/registry.ts` (import + add to `ALL`, keeping the batch comments).
6. Test at the chain runner seam (`applyModifierChain`), following `modifiers.s3x.test.ts`,
   `strobe.test.ts` and `trail.test.ts`: the transform's math, its state across frames, and its
   defaults. The registry-wide suites pick it up automatically: bypass identity and palette
   grouping (`modifiers.s32.test.ts`), and scoped state across dirty presentations
   (`voice/runtime-checkpoint.test.ts`).

## Task: Extend an existing Modifier

Add new params with defaults that reproduce today's output exactly, and prove it with a golden
against the old behaviour. Strobe is the worked example: `offMode` (black / dim / colour),
`offLevel`, `offColor` and `fade` were added so that at `offMode: black, fade: 0` the output is
bit-identical to the original hard gate (`modifiers/impl/strobe.ts`, `strobe.test.ts`; the spec's
identity guarantee). Shipped shows depend on that.

## Gotchas
- **Do not implement mix or envelopes inside the modifier.** The runner does it. A modifier that
  blends with its own input double-applies `mix`. At `mix` = 1 with no envelope the runner takes
  the exact pre-mix path, and `chain-mix.test.ts` guards that identity.
- `createState` runs lazily per voice (or per Master chain) and is not recreated when params
  change. Rebuild derived state inside `apply` when a param or the range changes materially.
- On the Master chain, state resets on section recall and when the chain or pixel count changes.
  Do not cache anything across that boundary.
- Snapshot the range before in-place spatial remaps, otherwise earlier writes corrupt later reads.
- Randomness must be deterministic: use the seeded helpers in `packages/core/src/math.ts`, never
  `Math.random` or wall-clock time.
- `packages/core` stays pure: no Node, DOM, IO or browser imports.
- The add slot and cards are UI. If a new category or icon would be needed, that is a UI change:
  apply the design-system and ui-shot rules in `AGENTS.md`.
- Until effect-chains S08 lands, the legacy graph palette (`trigger-lab/store/graphs.ts`) also
  lists modifiers from the registry. Do not add graph-specific code for a new modifier.

## Verify
- [ ] `pnpm --filter @ledrums/core exec vitest run src/modifiers src/voice/runtime-checkpoint.test.ts` passes.
- [ ] `pnpm --filter @ledrums/core exec vitest run src/effect-chain/master.test.ts` passes if the modifier is meant for the Master chain.
- [ ] `pnpm typecheck` passes.
- [ ] Workers do not run the full `pnpm test`; the orchestrator runs the serial sweep.
- [ ] If the add slot or card changed visibly: `pnpm ui-shot` against your own dev port (see
      `ui-shot-sweep.md`), never port 5173.

## Debug
- **Not in the add slot:** not in `ALL` in `registry.ts`, or a duplicate id threw at module load.
- **Modifier does nothing:** the link is bypassed, `mix` is 0, the envelope gain is 0 at this
  `timeMs`, or the id is unknown (the runner skips unknown ids and does not throw).
- **Flicker between hoops / runs:** wrong `scopePolicy`. A temporal field declared `range-local`
  advances once per selected run.

## Update Scaffold
- [ ] Update `.mex/ROUTER.md` "Current Project State" if the modifier is part of a tracked slice (orchestrator-owned during effect-chains waves).
- [ ] Bump `last_updated` on changed scaffold files.

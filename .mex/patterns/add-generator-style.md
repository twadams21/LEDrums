---
name: add-generator-style
description: Add a Style to an Effect-chain Generator (hosting an existing or new effect implementation), or change which implementation a Style hosts.
triggers:
  - "add a style"
  - "generator style"
  - "new generator"
  - "add an effect to the generator picker"
edges:
  - target: patterns/add-an-effect.md
    condition: when the Style needs a new underlying effect implementation first
  - target: context/architecture.md
    condition: to see where Generators sit in the Effect-chain pipeline
  - target: context/conventions.md
    condition: before writing core code
last_updated: 2026-09-30
---

# Add a Generator Style

## Context

Source of the model: `docs/plans/2026-09-30-effect-chains/spec.md` ("Generators"), whose decisions
are Trent's, building on Tim's voice note relayed by Trent. Terms: `CONTEXT.md` (Generator, Style).

- A **Generator** (`GeneratorDef`) is a facade: its **Styles** each name ONE existing effect
  implementation by id (`GeneratorStyle.effectId`), in `packages/core/src/effects/registry.ts`.
  The implementation renders unchanged; the Generator adds no rendering code of its own.
- Each Generator kind lives in its own file under `packages/core/src/effect-chain/generators/`
  (`solid.ts`, `wave.ts`, …). `generators/index.ts` only aggregates them. You should not need
  to edit it to add a Style.
- Resolution: `resolveGenerator(device)` layers params as the Style's fixed `params`, then the
  device's own. An empty `device.style` picks the Generator's **first** Style. The resolver
  (`effect-chain/resolver.ts` `effectPlayAction`) fills the hosted effect's defaults underneath.
- The card: `generatorParamSpec(kind, style)` is the hosted effect's `paramSpec` minus the Style's
  fixed `params` and `hiddenParams`, with `paramLabels` applied. The web Generator card
  (`app/views/effects/strip/cards/card-model.ts`) renders that list, so a new Style needs no UI
  code.
- Splice / Slice / Scene have a custom `resolve` instead of Style lookup. Do not add Styles to them.
- Coverage: `generators/coverage.test.ts` requires every registered effect id to be reachable
  through exactly one Style, unless it is in `EXCLUDED` (the ids the spec drops or merges).

## Task: Add a Style over an existing implementation

### Steps
1. Pick the Generator whose description fits the look (the spec's "Style mapping" table is the
   reference). An effect id may appear in only one Style across all Generators.
2. Add an entry to that Generator's `styles` array: `{ id, label, effectId }`.
   - `id` is a short kebab-case word, unique within the Generator. It is stored in authored
     shows (`GeneratorDevice.style`), so never rename or remove one once shipped.
   - Add `params` only when the Style is "the implementation with a setting fixed" (for example
     Wave / Radial uses radial-wash's own `mode`). Fixed params disappear from the card.
   - Use `hiddenParams` for params the card must not show but the Style does not fix.
   - Use `paramLabels` to present common params consistently ("Speed", "Hue") when the
     implementation labels them differently.
3. Keep Style order deliberate. The first Style is the default for a new device of that kind,
   and existing tests pin some defaults (for example Solid first, Simple = whole-drum).
4. If the effect id was in `coverage.test.ts` `EXCLUDED`, remove it from there. Otherwise the
   coverage test fails in the other direction.
5. Add a golden to the Generator's test (`wave.test.ts`, `simple-kinds.test.ts`,
   `field.test.ts`, …): at default params the Style must render byte-identically to the hosted
   implementation, through `effectPlayAction`, the same resolution the engine uses. Follow the
   existing `[styleId, implementation]` table idiom in those files.

### Gotchas
- **Do not change an implementation to suit a Style.** The implementation is also reached by the
  legacy paths until S08, and the golden compares against it.
- **Merged looks are params, not Styles.** wave-collapse is radial-wash `mode: 'collapse'`;
  follow-hoop is whole-drum's `hoopDelayMs`. Both stay in `EXCLUDED` (spec "Merges Trent approved").
- **Changing-light looks are not Styles.** Strobe, sparkle and similar belong to Modifiers
  (`add-modifier.md`). Strobe and sidechain are deliberately excluded as generators.
- **A new Generator kind is a contract change.** `GENERATOR_KINDS` in `effect-chain/types.ts` is
  part of the authored schema, and the web keys icons by kind (`GENERATOR_ICONS` in
  `app/views/effects/grid/generator-icons.ts`, plus `strip/cards/device-icons.ts`), so the
  compiler will demand an icon. Treat it as a design decision: ask Trent or Tim first (assumed:
  the spec fixes the list at nine plus Splice / Slice).
- Core stays pure: no Node, DOM or IO imports in generator files.

### Verify
- [ ] `pnpm --filter @ledrums/core exec vitest run src/effect-chain/generators` passes (coverage + goldens).
- [ ] `pnpm typecheck` passes.
- [ ] If the Generator card or picker changed visibly: `pnpm ui-shot` against your own dev port
      (see `ui-shot-sweep.md`), never port 5173.

## Task: Add a Style that needs a new implementation

### Steps
1. Build and register the implementation first, following `add-an-effect.md` (pure
   `EffectGenerator`, registered in `effects/registry.ts`, covered by the effects sweep).
2. Then add its Style as above. Registering the effect alone fails `coverage.test.ts` until a
   Style reaches it (or it is added to `EXCLUDED` with a reason).

## Debug
- **Card shows no params:** the Style's `effectId` is not registered (`tryGetEffect` returns
  undefined), or every param is fixed / hidden.
- **Effect does not fire:** `resolveGenerator` returned `null` (unknown kind or style id). The
  engine skips the Effect with a diagnostic instead of throwing.
- **Golden differs:** a Style `params` value differs from the implementation default, or a
  `paramLabels` key does not exist in the implementation's spec.

## Update Scaffold
- [ ] Update `.mex/ROUTER.md` "Current Project State" if the Style is part of a tracked slice (orchestrator-owned during effect-chains waves).
- [ ] Update `.mex/context/architecture.md` if Generator resolution changed.
- [ ] Bump `last_updated` on changed scaffold files.

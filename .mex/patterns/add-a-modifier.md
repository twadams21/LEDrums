---
name: add-a-modifier
description: Add a pure framebuffer modifier to the Gen3 trigger graph Modify flow.
triggers:
  - "modifier"
  - "Modify add flow"
  - "add a modifier"
edges:
  - target: ../context/conventions.md
    condition: before writing modifier code
last_updated: 2026-07-07
---

# Add a Modifier

## Context
Modifiers live in `packages/core/src/modifiers/impl/` and are pure framebuffer transforms applied by `applyModifierChain`. The web Add pane derives Modify options from the core modifier registry through `listModifiersByCategory`, so a registered modifier appears without bespoke UI unless it needs a custom inspector.

## Steps
1. Create `packages/core/src/modifiers/impl/<id>.ts` exporting `export const <camelId>: ModifierDef<State?>`.
2. Declare `id`, `name`, `category`, and `paramSpec`. Use pixel units explicitly for strip/pixel controls.
3. Implement `apply(ctx, params, fb, range, state)` as a pure transform over `range`.
4. If the modifier needs buffers, shuffled maps, or temporal accumulators, add `createState(model, range)` and keep any self-invalidating signature in state when params or range can change during a voice.
5. Register it in `packages/core/src/modifiers/registry.ts`.
6. Add focused core tests for the modifier math and state behavior. Add a web taxonomy/palette test when discoverability is part of acceptance.

## Gotchas
- `createState` runs lazily per voice and is not automatically recreated when params or scope changes; rebuild internal derived state in `apply` when relevant params/range materially change.
- Snapshot the range before in-place spatial remaps, otherwise earlier writes can corrupt later reads.
- Modifier randomness must be deterministic. Use seeded helpers from `packages/core/src/math.ts`; never use `Math.random`.
- `packages/core` must stay pure: no Node, DOM, IO, or browser imports.
- Registry metadata is UI-visible. If a modifier changes the Add pane or styleguide output, regenerate `docs/design-system.html` and run the relevant `pnpm ui-shot` target.

## Verify
- [ ] Focused core modifier tests pass.
- [ ] Relevant web palette/add-flow tests pass if discoverability changed.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm test` passes.
- [ ] UI artifact/screenshot checks run when registry changes affect visible UI.

## Update Scaffold
- [ ] Update `.mex/ROUTER.md` "Current Project State" if the modifier is part of a tracked slice.
- [ ] Bump `last_updated` on changed scaffold files.

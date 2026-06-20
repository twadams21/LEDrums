# Pattern: Add a lighting effect

Effects are the main extension point. Each is a pure `EffectGenerator` registered in one place; the UI picks it up automatically (effect specs flow to the client over WS at runtime — only a **server restart** is needed, no web rebuild).

## Steps

1. **Create** `packages/core/src/effects/impl/<id>.ts` exporting `export const <camelId>: EffectGenerator = { id, name, category, paramSpec, render }`.
   - `id` is kebab-case and doubles as the registry key + a clip's `effectId`.
   - `category` ∈ `base | trigger | wash | meter | utility | texture | particle`.
   - `paramSpec` declares each param (`type: number|color|enum|bool`, `default` within `min/max`, `options` for enums) so the UI renders controls generically.
2. **Implement `render(ctx, params, fb, state)`** — read params with `pnum/pstr/pbool`; write via `fb.set/add/max`.
   - **2D / texture:** use `renderUvField(ctx, fb, mode, (u,v,tSec) => [r,g,b] | null)` (`mode`: `cylindrical` wraps each drum, `planar-*` spans the kit).
   - **Trigger-reactive:** read `ctx.triggers` (`{seq, drumId, velocity, ageMs}`); use `model.drumById.get(id)` and `effectOriginWorld` for spatial origin.
   - **Stateful:** add `createState(model)`; process new hits via `trig.seq > state.lastSeq`; decay by `ctx.dt`. The engine owns/resets state on clip change.
3. **Register** in `packages/core/src/effects/registry.ts` (import + add to `ALL`).
4. **Test** — add a case (finite & in-range channels; lights >0 pixels under the right conditions). The `effects.test.ts` NaN/range sweep covers every registered effect automatically.
5. **Verify** `pnpm --filter @ledrums/core test` + `typecheck`. Restart the server to see it in the UI.

## Non-negotiables (from `context/conventions.md`)
- Pure function of `RenderContext` — **no** `Math.random`/`Date.now`/wall-clock/node/DOM. Randomness only via a seeded `mulberry32` in engine-owned state (or `mulberry32(trig.seq)` for per-hit determinism).
- All channel outputs finite and clamped to `[0,1]`.
- If `registry.test.ts` asserts an effect count/category set, update it.

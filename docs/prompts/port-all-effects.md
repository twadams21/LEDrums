# Bring across ALL effects from the original engine (bridge, don't re-implement)

Implementer agent (opus, xhigh). Apply **/codebase-design**. Branch **`feat/unified-shell`** (checked
out). Report to your parent orchestrator (`--session parent`). No push/PR/merge. Commit milestones.

## The gap
The trigger-lab voice model currently has only ~10 hand-rolled patterns (`apps/web/src/lib/trigger-lab/
fixtures.ts` EFFECTS + the `Pattern` union sampled in `packages/core/src/voice/compositor.ts` and the
web mirror `apps/web/src/lib/trigger-lab/render.ts`). The ORIGINAL engine has **41 effects** in
`packages/core/src/effects/impl/` (plasma, fire, caustics, perlin-clouds, lightning, starfield, helix,
spiral, tunnel, interference, comet-trails, gravity-wells, lava-lamp, …). Bring them ALL across so they
are selectable and render on real output.

## Design — BRIDGE, do not re-implement
The legacy effects implement `EffectGenerator` (`packages/core/src/effects/types.ts`):
`render(ctx: RenderContext, params: ResolvedParams, fb: Framebuffer, state): void` with optional
`createState(model)` — whole-frame, stateful. The voice path is per-pixel + stateless. Re-writing 41
effects as voice `sample()` patterns would be lossy and huge. Instead, **let a voice host a legacy
EffectGenerator and have the voice render path delegate to it**, scaled by the voice's level and masked
to its scope. Use /codebase-design to place the seam cleanly (likely: the voice carries an
`effectGeneratorId`; the engine/compositor keeps a per-voice `state` from `createState`, builds a
`RenderContext` from engine transport/time, renders the generator into a per-voice scratch
`Framebuffer`, then composites it into `dst` scaled by `voice.level*deckGain` and masked to the drum
range when `scope==='drum'`). Reuse the legacy `registry.ts` (`getEffect`/list) — the single source of
the 41. Keep the existing lightweight `sample()` patterns working (fast path) OR migrate them; your call,
documented.

## Scope + requirements
- All 41 legacy effects become available in the trigger-lab effect registry (`fixtures.ts` EFFECTS /
  the store's `effects`), with their real param specs surfaced (map legacy `ParamSpec` → the lab's
  `ParamSpec` shape; both have key/label/min/max/step/default — reconcile `type`↔`kind`, color/enum).
  Group by the legacy `category` (base/trigger/wash/meter/texture/particle/utility) so the gallery can
  filter; map category→scope sensibly (drum vs kit).
- Determinism preserved (no `Math.random`/`Date.now` on the hot path — legacy effects already avoid
  them; verify; carry any RNG via the engine seed).
- **Real LED output (server voice path) is the priority.** For the web OFFLINE preview (`render.ts`),
  either delegate to the SAME core bridge (preferred — import the core path) or flag clearly that
  offline parity is deferred while the connected/server preview is correct. Don't silently diverge.
- Perf: per-voice full-frame render is heavier than per-pixel sampling. Don't block on optimization —
  make it correct, then FLAG the perf characteristics + a tuning path (cache state, skip when level≈0,
  only render generator voices that are live). 120fps target is aspirational here.
- FLAG honestly any legacy effect that needs inputs the voice path can't supply yet (e.g. live audio /
  trigger history / multi-pass) rather than faking it.

## File boundaries (siblings are editing concurrently)
YOU OWN: `packages/core/src/effects/**` (read-only ideally — reuse the registry), `packages/core/src/
voice/compositor.ts` (+ `voice/types.ts` if the voice/effect type needs a generator ref — coordinate,
it's shared core), `apps/web/src/lib/trigger-lab/fixtures.ts`, `apps/web/src/lib/trigger-lab/render.ts`,
`apps/web/src/lib/trigger-lab/sim.ts` (Pattern/effect plumbing only).
DO NOT TOUCH: `packages/core/src/voice/engine.ts` UNLESS the bridge requires the engine to pass
state/RenderContext (if so, keep it minimal + note it — a sibling recently edited it, it's now
committed at c311e81). DO NOT TOUCH `apps/web/src/lib/trigger-lab/store.svelte.ts`,
`apps/web/src/lib/app/**`, `apps/web/src/lib/visualizer/Scene.svelte` (siblings own those).

## Gate + report
Package-scoped gates while working; full `pnpm typecheck` + `pnpm test` before reporting (paste output).
Add/extend core tests (effects render finite [0,1], determinism). Sanity-check a few new effects on the
running :4321/:5173 stack if feasible. Then:
```
twux send-message --session parent --slice-status "<short>" --body "<the bridge design + seam, how many of the 41 are live, param/category mapping, offline-preview decision, perf flags, any effects deferred + why, pasted typecheck+test output>"
```
If you hit the usage limit mid-edit, commit WIP and stop.

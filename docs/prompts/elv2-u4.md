# U4 — Canvas engine (core, one continuous build) — Effects Library v2

You are the **implementer for Unit U4**. Model: Fable, effort: low.

**Single source of truth:** `docs/plans/2026-07-05-effects-library-v2.md` (passed as extra
reading — read it FULLY first, especially **D3** (typed play nodes), **D4** (canvas engine),
**D5** (lenses), and the "Current state" section). All decisions are **LOCKED**:
decision 6 (typed play nodes, engine uniform underneath) and decision 7 (upgrade `field.ts`
into the canvas module — API seams may change, existing textures re-anchored; NO compositor
fork). Never re-ask.

**This is the marquee unit and the biggest one.** It is a *core* build (packages/core). The
UI for it is U5 — you build the ENGINE + model + tests, not the authoring UI.

## State you build on (the plan's anchors predate U1/U3)
- **U1** (landed): the `PlayType` taxonomy + controlled tag vocabulary already exist in core
  (`packages/core/src/effects/vocabulary.ts`) — `PlayType = 'hits'|'waves'|'particles'|
  'textures'|'ambient'|'meters'|'canvas'`, first-tag-match derivation. **CONSUME this; do
  not duplicate it.** Metadata (`description`/`tags`) lives in `metadata.ts`.
- **U3** (landed): the legacy pattern path is **DELETED**. The voice compositor now has
  **ONE render path** — the generator bridge (`generator-bridge.ts`,
  `compositor.ts`). **You MUST NOT add a second or third dispatch path.**

## The single most important constraint (locked decision 7 / D4)
The canvas scene engine **presents as an `EffectGenerator` adapter** —
`render(ctx, params, fb, state)` — and flows through the **EXISTING generator bridge and
compositor UNTOUCHED**. `playType:'canvas'` resolves a scene document where a hosted effect
resolves a registered generator id. **No compositor fork. No third dispatch path.** If you
find yourself editing the compositor's dispatch, stop — you're doing it wrong.

## Build sequence (ordered — commit + update tracker `notes` at each milestone so the unit
is resumable mid-way; send a progress ping after each)

1. **Typed-play-node seam (D3):** add `GraphNode.playType: PlayType` and
   `canvasScene?: string` (canvas only). **Hydrate migration:** persisted play nodes without
   `playType` infer it from `effectId` (total mapping via U1's first-tag derivation).
   Carry `playType`/`canvasScene` through `PlayAction`/`Voice` (`eval-graph.ts`). NO
   compositor fork — see above.
2. **Refactor `field.ts` INTO the canvas module (D4, locked dec 7):** `UvMode`
   (cylindrical/planar-*) becomes the **sampler** set; `renderUvField` callers (the 12 Gen-2
   UV textures) are updated **in the same commit** (API seams may change — that's allowed).
   The 12 textures keep working through the refactored module (re-expressing them as scene
   presets is U6 stretch, NOT here).
3. **Scene model (`packages/core/src/canvas/types.ts`):** `CanvasScene` (id, name,
   description?, tags?, `elements: CanvasElement[]` painter's order, `sampler: SamplerConfig`,
   `lenses?: Lens[]`). `CanvasElement` additive union: `stripes`/`circle`/`gradient`/
   `polygon`/`checker`/`noise` (fields per D4).
4. **Element renderers:** one tiny **pure** fn per element `(u, v, t, el) → colour` —
   `stripes`, `circle`, `gradient`, `polygon`, `checker`, `noise`.
5. **All four samplers** (how drum geometry lands on the canvas): `hoop` (each hoop a circle;
   pixel samples at its angle), `strip` (pixel chain unwound to a line via
   `indexInHoop`/`hoopIndex` arclength), `cylinder` (existing `Pixel.uv` → canvas region),
   `footprint` (kit-wide planar projection). Use the existing `Pixel` fields (`uv`,
   `angleDeg`, `hoopIndex`, `indexInHoop`, `world`, …) + `getHoopPixelRange` — **no new
   geometry**.
6. **Scene-level params via the standard `paramSpec`** (so Inspector/envelopes/LFO/CC drive
   them with ZERO new UI): `canvasRotDeg`, `canvasOffsetX/Y`, `canvasScale`, `samplerRotDeg`,
   `speed`, `brightness`, `hue`. **Test that the modulation sweep drives them** — an LFO on
   `canvasRotDeg` must animate (uses the Rock Solid modulation infra live on main).
7. **Full lens chain (D5)** — pure `(u,v,t)→(u,v)` warps, chainable/ordered: `polar`,
   `unpolar`, `log-polar`, `kaleido`, `mobius`, `tile`, `swirl`, `hyper4d`. `hyper4d` lifts
   the pixel's WORLD position to 4D `(x,y,z,w=f(t))`, rotates XW/YW/ZW, projects back, samples
   at the projected position → defined for `cylinder`/`footprint` (world-space) samplers
   first.

## Tests + gates (non-negotiable — determinism & perf are core invariants)
- **Byte-determinism at the compositor seam per playType** — a canvas voice renders
  identically across runs given (time, inputs, model); same seam guarantee the hosted path has.
- **Sampler unit tests** (each of the 4).
- **Golden: `stripes` + `polar` lens == rings** (the D5 payoff, provable).
- **Lens chain composition** test (ordered application).
- **Perf: under the 5ms effect budget on the 548px kit** — bench it the way the 2026-07-05
  confetti bench does (reference that bench's structure). Report the measured ms.
- `pnpm typecheck` clean; `pnpm --filter '!@ledrums/desktop' -r test` green (desktop splash
  failure pre-existing, excluded by the filter).
- **`packages/core` STAYS PURE** — no Node/DOM/IO imports; effects/lenses/samplers are pure
  fns of their inputs, no hidden global state, no hot-path allocation.
- **Update the plan tracker** (row `U4 canvas engine`) as you go: `notes` after each
  milestone commit (e.g. "seam+field-refactor done; scene model+renderers next"), status →
  `done` only when the whole sequence + gates are green.

## Repo state to respect (do NOT touch)
- `apps/web/src/lib/app/views/TriggerNode.svelte` (Trent's WIP — leave strictly alone; this
  is a core unit, you shouldn't need web view files at all),
  `apps/desktop/src-tauri/permissions/`, `docs/plans/2026-07-05-app-fixes-plan.md`. Never
  commit/revert them.
- Do NOT implement `docs/plans/perf-sla-telemetry.md` (canvas renders inside the same
  per-effect profiling unit — but that's a separate initiative; just keep your render inside
  the existing per-effect budget).

## If you run low on context before finishing
This unit is large. Commit each milestone, keep the tracker `notes` precise about exactly
where you stopped (which samplers/lenses are done), and report `--status progress` with the
resumable state — do NOT rush or skip tests to "finish". A clean half is resumable; a
gate-red whole is not.

## Report back
Progress pings after each milestone: `twux send-message --session parent --status progress
--body "<milestone + commit>"`. Final: `twux send-message --session parent --status done
--body "<all commits + gate results + measured perf ms + confirmation NO compositor fork
(scene engine is an EffectGenerator adapter) + determinism approach>"`. Blocked on genuine
ambiguity (not a locked decision)? `--status blocked` with the specific question.

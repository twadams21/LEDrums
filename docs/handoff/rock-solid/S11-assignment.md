# S11 assignment — Kit mirror X/Y (Group D, issue #49)

- **Slice:** S11 in `docs/plans/2026-07-02-rock-solid/slices/D-layout-geometry.md` (your `--read`).
- **Worktree (your cwd):** `/Users/trent/Documents/dev/ledrums-wt/wt-2`
- **Base branch:** `group/D` (has S10's flip plumbing) · **Your branch:** `slice/S11`
- **Start:** `git fetch --all && git switch -c slice/S11 group/D` (inside the worktree)
- **Commits:** incremental, subject `S11: <intent>`.

## The invariant (state in a code comment AND enforce in tests) — same as S10
Mirror is a **geometry-only** transform: world coordinates reflect, but pixel index order and the DMX
byte stream (`dmxMap` `perPixel` + `universes`) are **byte-identical** regardless of mirror. It never
re-patches hardware.

## What to build
1. **Core geometry** (`packages/core` — stays PURE):
   - `geometry/kit-schema.ts` `kitGlobalSchema` (~:82-88): add `mirror?: 'none'|'x'|'y'`.
   - `geometry/pixel-model.ts` `buildPixelModel`: apply mirror as a **FINAL world-space reflection**
     AFTER `localToWorld` — negate world `x` (mirror `x`) or world `y` (mirror `y`) for every pixel, and
     **negate the matching component of any tangent/normal vectors** so they stay consistent. Gated on
     `kit.global.mirror`. Composes cleanly on top of S10's flip (flip is already baked into `local`→`world`).
     Drums keep their identities (kick stays kick) — only coordinates reflect.
2. **Plumbing** — mirror is **KIT-GLOBAL, not per-drum**, so do NOT put it on `setKitTransform`/`drumSchema`
   (that's the per-drum carrier). Copy S10's plumbing *pattern* for a kit-global field: add a `kit.global`
   `mirror` field + its own WS message/mutator (e.g. `setKitGlobal`) that reaches `reloadKit()` on BOTH
   hosts (rebuild the model, not just dmxMap).
3. **UI** (`ui-light`): a mirror control (none/x/y) on the **Patch view toolbar** (no kit-level inspector
   exists — toolbar is least invasive). Applies live + persists with the project. `/make-interfaces-feel-better`;
   compose from the design system (segmented control / existing primitives).

## Context pack from S10 (the flip tracer — your plumbing template)
- **Per-drum transform shape** (the PATTERN to copy, NOT your carrier): `DrumTransformPartial`
  (`apps/web/.../store/trigger-routing.ts`) + protocol `setKitTransform` (`packages/protocol/src/index.ts`).
- **Forwarding points** S10 wired for flip/pixelsPerHoop — your kit-global message needs the analogous
  reach: legacy `apps/server/src/input-router.ts` `setKitTransform` case + `packages/core/.../engine.ts`
  `setKitTransform` `Pick`; voice `apps/server/src/handlers/voice-input.ts` `propagateToVoiceHost` +
  `apps/server/src/voice-engine-host.ts` `setKitTransform` `Pick`. Both hosts must `reloadKit()`.
- **Where in `buildPixelModel`:** S10's flip mutates `local` INSIDE the per-drum loop (localZ + sweep sign);
  your mirror is the FINAL world-space reflection on `world` (+ tangent/normal), gated on `kit.global.mirror`.
- **Golden to mirror:** copy `packages/core/src/geometry/flip.test.ts` — the `perPixel`/`universes` `toEqual`
  dmxMap-invariance check + an involution case (double-mirror = identity). ADD a **`mirror ∘ flip` compose**
  case (apply both; assert world coords + both goldens agree).

## Scope fence
Kit mirror only. Reuse S10's flip plumbing; don't modify flip behavior. Note anything outside doc 08 §B's
touch list under Deviations.

## Gates
No Rust. `pnpm typecheck` (0) + `pnpm test` (no skips), all packages green before the report commit.
`packages/core` stays pure.

## Report — `docs/handoff/rock-solid/S11.md`, committed on `slice/S11` as your FINAL commit, ≤30 lines
Summary · Acceptance (each checkbox, one line evidence) · Gates · Deviations · Context pack (group D is
nearly closed — note only anything a later group/lane truly needs; likely minimal). No commit/file lists.

## When done
`twux send-message --session parent --status ready --body "S11 done: slice/S11 @ <sha>, report docs/handoff/rock-solid/S11.md, sweep green"`

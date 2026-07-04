# S10 assignment — Per-drum flip (+ pixelsPerHoop forwarding fix) (Group D, issue #49)

- **Slice:** S10 in `docs/plans/2026-07-02-rock-solid/slices/D-layout-geometry.md` (your `--read`).
- **Worktree (your cwd):** `/Users/trent/Documents/dev/ledrums-wt/wt-1`
- **Base branch:** `group/D` · **Your branch:** `slice/S10`
- **Start:** `git fetch --all && git switch -c slice/S10 group/D` (inside the worktree)
- **Commits:** incremental, subject `S10: <intent>`. **You are the TRACER for S11** (kit mirror reuses your
  flip plumbing) — your report's context pack matters.

## The invariant (state it in a code comment AND enforce in tests)
Flip is a **geometry-only** transform: it changes pixel XYZ (what effects + the visualiser see), NOT
pixel index order. The Art-Net output stream and `dmxMap` are **byte-identical** with flip on/off — a
flip never re-patches hardware.

## What to build (doc 08 §B has exact file:line pointers — I distill them here)
1. **Core geometry** (`packages/core` — stays PURE, no IO/DOM/Node):
   - `geometry/kit-schema.ts` (~:10-30 `drumSchema`): add `flip?: boolean`.
   - `geometry/pixel-model.ts` (`buildPixelModel` ~:83-155): when `flip`, mirror the drum along its local
     Z (**negate `localZ`** so top/bottom skins swap) AND **negate the angular direction** (`angle → -angle`
     BEFORE the start/spin offsets) so a physically-flipped drum's chase/wind direction reads correctly.
     Hoop indices + pixel order unchanged.
2. **Plumbing (end-to-end)**:
   - `apps/web` `store/trigger-routing.ts` (~:11-19 `DrumTransformPartial`) + WS `setKitTransform`: add `flip`.
   - `apps/server/src/input-router.ts` (~:171-179): forward `flip` → voice host `reloadKit()`.
     **FIX THE LATENT BUG HERE TOO:** `pixelsPerHoop` is in the protocol (`protocol:52`) but the legacy-engine
     path drops it — input-router doesn't forward it and `engine.ts` (~:298-303) `Pick` type excludes it
     (voice host already handles it; dev runs voice mode, so impact is legacy-mode only). Forward
     `pixelsPerHoop` on BOTH engine paths and widen the `Pick`.
   - `apps/server/src/voice-engine-host.ts` `reloadKit` picks up `flip`.
3. **UI** (`ui-light`): `docks/inspectors/PatchDrumInspector.svelte` gets a "Flip drum" toggle →
   `store.setDrumTransform` (store.svelte.ts ~:1263-1266). Applies `/make-interfaces-feel-better`; use the
   design system (compose from existing toggle/primitive — likely nothing new-reusable here).

## Tests (core, golden-style like the existing byte-exact suites)
- Flip twice = identity (positions byte-equal); flip preserves pixel count + index order **and dmxMap bytes
  exactly**; skins swap (z of hoop 0 ↔ hoop N-1); angular direction reversed.
- `input-router` forwards `flip` **and `pixelsPerHoop`** (regression test for the latent bug) on both paths.
- Toggle in the drum inspector takes effect live (web store test).

## Scope fence
Flip only. Do NOT build the kit-global mirror (`mirror: none|x|y`) — that is S11 (it will reuse your
plumbing). Note anything outside doc 08 §B's touch list under Deviations.

## Disk / gates
No Rust here (all TS/core). `pnpm typecheck` (0) + `pnpm test` (no skips), all packages green before the
report commit. `packages/core` must remain pure (its own tests + no IO/DOM imports).

## Report — `docs/handoff/rock-solid/S10.md`, committed on `slice/S10` as your FINAL commit, ≤30 lines
Summary · Acceptance (each checkbox, one line evidence) · Gates (typecheck 0; test counts) · Deviations ·
**Context pack for S11** (kit mirror): the exact plumbing seams it reuses — `DrumTransformPartial`/
`setKitTransform` shape, where in `buildPixelModel` a world-space transform should slot (S11 mirrors world
x/y as a FINAL reflection), the `input-router`/`Pick`/`reloadKit` forwarding points, and the
geometry-only/dmxMap-untouched invariant + which golden test to mirror. No commit/file lists.

## When done
`twux send-message --session parent --status ready --body "S10 done: slice/S10 @ <sha>, report docs/handoff/rock-solid/S10.md, sweep green"`

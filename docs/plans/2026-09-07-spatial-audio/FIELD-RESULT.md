# F1 — Spatial Field: completion report

**Status: done.** Branch `feat/spatial-field`, worktree `ledrums-wt/spatial-field`, base `origin/main` 5c4d63bb (#214 spec on top of fec83bee).

- Implementation commit: `da00f30e` — `feat(effects): add Spatial Field world-space texture with hit-centred waves (#214)`
- This report: the commit following it on the same branch.
- Not pushed, no PR, no dev server, no full sweep (per brief). Parent integrates.

## Files

| File | Change |
|---|---|
| `packages/core/src/effects/impl/spatial-field.ts` | new — the generator |
| `packages/core/src/effects/spatial-field.test.ts` | new — 16 tests |
| `packages/core/src/effects/registry.ts` | import + `ALL` entry |
| `packages/core/src/effects/metadata.ts` | description + tags for `spatial-field` |
| `packages/core/src/effects/registry.test.ts` | count 53→54, id added to catalog list |
| `apps/web/src/lib/trigger-lab/generator-bridge.test.ts` | count 53→54 (one literal; no other web change) |

No audio/modulation/protocol/transport files touched. No dependency changes. No `.mex` edits.

## What shipped

`EffectGenerator` id `spatial-field`, name `Spatial Field`, category `texture`, `timebase: 'absolute'`, `voiceLife: { key: 'lifeMs', unit: 'ms' }`. Gallery collection derives to **Textures** (tags: `texture, 3d, kit-wide, airspace, hit, emission, ambient`). Generic palette entry; no custom editor or render path.

**Base field.** Every pixel's world XYZ is normalised about `bounds.center` by half of `bounds.size` (guarded to 1 mm for a degenerate kit), XY is rotated about Z by `twist × normalisedZ`, then a bounded sum of three sine/cosine harmonics (|f| ≤ 2) at spatial frequency `scale × π` drifts on `2π × speed × t`. Luminance is squared into bands with a 6% floor so sparse hoops always read; hue varies with luminance by `hueSpread`. Same world position → same value regardless of drum identity. O(pixels × 3 harmonics).

**Hit perturbation.** Uses the shared `emitter` (spawn-once by seq, aged by `ctx.dt`, capped at 64). Each emission whose drum resolves launches a spherical shell of radius `waveSpeed × age` and width `waveWidth` from `effectOriginWorld`; inside the shell a `(1−x²)²` profile times `velocity × disturbance × lifeFade(1 − age/lifeMs)` (a) adds to the twist angle, (b) pushes the field phase by up to π, (c) adds a luminous ridge and a small hue shift. So the ripple bends the pattern, not just brightness. Unknown drum id → no wave, base field intact. Hard cutoff at `lifeMs`, hence `voiceLife`.

**Params (11):** hue 205°, saturation 0.85, brightness 1, hueSpread 70°, scale 1.4 ×kit, twist 2.2 rad/kit, speed 0.22 cyc/s, disturbance 0.85, waveSpeed 1100 mm/s, waveWidth 240 mm, lifeMs 1500 ms. All defaults inside min/max, all reads via `pnum` with clamps, so NaN/∞/out-of-range params render finite [0,1].

## Voice semantics (as the brief asked)

Unchanged. Under the voice engine the bridge feeds one synthetic trigger (the voice's own hit), so a looped Spatial Field voice gives continuous field motion plus its own single origin wave; each one-shot voice layers its own wave. Loops do **not** receive later drum hits — the current architecture does not supply a live trigger stream to generator voices, and this effect does not claim otherwise. Under hosts with a trigger stream (thumbnail, web sim) all hits render. The thumbnail's synthetic drum id `thumb` matches its one-drum model, so the wave shows in the gallery thumb.

## Tests (all green, `--maxWorkers=2`)

- `packages/core`: `spatial-field.test.ts` (16), `registry.test.ts` (7), `effects.test.ts` NaN/range sweep (66), `batch-e.test.ts` (15), `voice/compositor.test.ts` (70) → 174 passed.
- `apps/web`: `trigger-lab/generator-bridge.test.ts` (11, includes render-every-generator parity), `EffectThumb.test.ts` (22) → 33 passed.
- `packages/core` `tsc --noEmit` → exit 0.

Coverage in `spatial-field.test.ts`: registration/tags/collection/spec validity; default visible on four sparse hoops on every drum at t = 0/700/3000 ms; exact repeatability; time moves the image and speed 0 freezes it; wave changes image and is strongest near source; translated source gives a spatially different perturbation; wave expands to reach the next drum; velocity 0 vs 0.5 vs 1 ordering; disturbance 0 is a no-op; wave expires at lifeMs; authoredDecay suppresses only the wave fade; `resolveVoiceSustainMs` honours lifeMs; unknown source no-throw + base retained; parameter extremes (incl. NaN/∞/negative) finite; one-hoop kit and model replacement safe; 500-trigger stream capped at 64.

## Not done / limitations

- **Not run:** full `pnpm test`, workspace `pnpm typecheck`, `pnpm build`, `ui-shot`, `pnpm design-system` — parent's integrated pass per brief. The web `svelte-check` was not run; only one numeric literal changed there.
- No engine-level scope/one-shot-life test added: `compositor.test.ts` already exercises the bridge seam generically and passes; `voiceLife` resolution is covered by the direct `resolveVoiceSustainMs` assertion.
- Default look validated numerically (lit fraction > 50% of pixels, every drum lit), not visually. Parent's ui-shot is the visual check; tuning `scale`/`hueSpread` defaults is a one-line change if the thumb reads too busy.
- Param count is 11 (brief said ~10 max): `hueSpread` kept because a single-hue banded field read flat; drop it if the palette should stay single-hue.

## Deviation from plan

None structural. Effect-origin geometry, emitter, life-fade and voiceLife seams reused as-is.

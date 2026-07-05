# U2 — Isometric fake-drum thumbnails (Effects Library v2)

You are the **implementer for Unit U2**. Model: Fable, effort: low.

**Single source of truth:** `docs/plans/2026-07-05-effects-library-v2.md` (passed as extra
reading — read it FULLY first, especially **D7** (fake-drum thumbnails) and the "Gallery /
thumbnails" part of the "Current state" section). All decisions are **LOCKED** — decision 5
(isometric drum camera) is locked. Never re-ask.

**This is a taste unit** — the thumbnail look is the point. Every effect's card is judged by
this thumbnail, so it must read cleanly and consistently across the whole library.

## Post-U1/U3 state you build on (IMPORTANT — the plan's anchors predate these)
- **U1** (landed): gallery redesign, metadata (`description`/`tags`/`playType` collections),
  `EffectThumb` already used in the new cards.
- **U3** (landed): the **legacy pattern render path is DELETED**. `EffectThumb` is now
  **GENERATOR-ONLY** — no `pattern` branch, no `sampleWith`. `kit.ts`'s SoA `attrs` +
  `hueToRgb` were removed. Every effect is generator-backed through one render path.
- **`EffectThumb`'s current public prop API** (from the call sites): `generatorId`,
  `labModel`, `params`, `w`, `h`. **PRESERVE THIS PROP API.** Do NOT rename/remove props.
  If you genuinely must change it, **flag the orchestrator — do NOT edit
  `apps/web/src/lib/app/views/TriggerNode.svelte`** (it holds Trent's uncommitted WIP;
  leave it strictly alone).

## Scope (plan §D7 / §U2)
1. **Replace the raw 26×13 `fillRect` grid** in `EffectThumb` with a **pseudo-3D drum
   painting** of the SAME `buildThumbPixelModel` output: project each thumb-pixel's
   cylindrical position to 2D with a **fixed ¾-angle isometric-ish camera** (hoops as
   stacked ellipses, slight vertical perspective), paint a **soft glowing dot per pixel**
   (radius ~2px, additive glow). Canvas 2D only (no WebGL). **Precompute the projected
   `(x, y, r)` table once** (the ~338 thumb pixels) — per frame just recolour, so cost is
   comparable to today.
2. **Same camera, same drum, same hit-cadence for EVERY effect** — variance in thumbnails
   must then mean variance in the EFFECT, not the rendering. Keep the existing ~1600ms loop
   + the seq-bump already fixed.
3. **Background mini-drum** for effects tagged `kit-wide` (use the tag from U1's metadata):
   a second, smaller drum behind the main one so cross-drum travel reads (e.g. `ripple-3d`,
   `spark-arc`).
4. **Reduced-motion:** pick each effect's **"representative age" = 35% of its dominant life
   param** (instead of the fixed 400ms static frame) so the static frame shows the effect
   at a characteristic moment.
5. Works across all thumb sizes: gallery 170×92, inspector 72×40, clip-settings 84×46.

## Key anchors (verify by symbol — lines drift, and U1/U3 moved things)
- `EffectThumb.svelte` (generator frame render — the pattern path is gone; find the current
  frame-generation + the `fillRect` painter you're replacing).
- Thumb model: `apps/web/src/lib/trigger-lab/kit.ts` (`buildThumbPixelModel`, `THUMB_COLS`
  26 / `ROWS` 13 / `RADIUS` 100mm / `SPACING` 12mm, cylindrical world coords, single drum
  `'thumb'`) — re-read it; U3 removed the SoA `attrs` + `hueToRgb`.
- Tags for `kit-wide`: U1's `metadata.ts` / `vocabulary.ts` in core, surfaced on `EffectDef`.

## Non-negotiables (UI unit)
- Use/extend the **design system** (`docs/design-system.html`) — compose from primitives;
  anything new + reusable → `apps/web/src/lib/styleguide/` + regenerate `pnpm design-system`
  IN THIS CHANGE.
- Apply **`/make-interfaces-feel-better`** (this is a taste/polish unit — glow, dot
  softness, optical spacing of the stacked ellipses all matter) with `PRODUCT.md`/`DESIGN.md`.
- **`pnpm ui-shot`** against the dev server on **:4321 / :5173**: capture gallery,
  inspector, and clip-settings thumbnails; the tool also surfaces console errors.
- `packages/core` stays pure (this unit is web-only; no core changes expected).

## Acceptance (gates green — required before you report done)
- `pnpm typecheck` clean.
- `pnpm --filter '!@ledrums/desktop' -r test` green (desktop splash failure is pre-existing,
  excluded by the filter).
- **QA inline (mandatory):** audit **ALL** library entries at **multiple loop phases** —
  confirm **none render black, none frozen** across the whole gallery. State in your report
  how you checked (e.g. ui-shot montage at N phases) and that every card animates.
- ui-shot: gallery grid, inspector thumb, clip-settings thumb — all showing the isometric
  drum; kit-wide effects show the background mini-drum.
- **Update the plan tracker** (row `U2 isometric thumbs`) to `done` with commit hash(es), in
  the same commit(s). Keep `notes` current for multi-commit progress.

## Repo state to respect (do NOT touch)
- `apps/web/src/lib/app/views/TriggerNode.svelte` (Trent's WIP — U3 already had to touch it;
  do NOT touch it again — preserve EffectThumb's prop API so you never need to),
  `apps/desktop/src-tauri/permissions/`, `docs/plans/2026-07-05-app-fixes-plan.md` — all
  Trent's. Never commit/revert them.
- Do NOT implement `docs/plans/perf-sla-telemetry.md`.

## Report back
`twux send-message --session parent --status done --body "<commits + gate results + how you
QA'd every library entry at multiple phases (none black/frozen) + confirmation EffectThumb's
prop API is unchanged + ui-shot notes>"`. Blocked on something genuinely ambiguous (not a
locked decision)? Report `--status blocked` with the specific question.

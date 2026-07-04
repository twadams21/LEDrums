# U3 — Library rehab, merges, retirement (Effects Library v2)

You are the **implementer for Unit U3**. Model: Opus, effort: low.

**Single source of truth:** `docs/plans/2026-07-05-effects-library-v2.md` (passed as extra
reading — read it FULLY first, especially **D2** (disposition table), **D1** (alias +
deprecated mechanism), and the "Current state (verified anchors)" section). All decisions
are **LOCKED** — never re-ask. Decision 2 (retire + DELETE `pattern-renderer.ts`) and the
D2 merge list are locked; the U3 audit may adjust *details* of the disposition table
without re-asking, but not the merge list.

**U1 is already landed** (commits `2093a77`, `8dce68b`, `d998e54`, `8f60453`): the metadata
seam (`description`/`tags`/`deprecated` on `EffectGenerator`), the controlled tag
vocabulary + `PlayType` collections (`packages/core/src/effects/vocabulary.ts`), all 45
generators described+tagged (`metadata.ts`), and the **alias mechanism**
(`packages/core/src/effects/aliases.ts` — currently an EMPTY map) wired at both hydration
seams (`normalizeGraphs` + `buildShow`). **You POPULATE that alias map and set `deprecated`
flags; you do NOT rebuild the mechanism.** The gallery already hides `deprecated` effects
and filters by collection/tags.

---

## Scope (plan §U3)

1. **Audit the D2 disposition table against source** — adjust details inline (merge list
   locked, no re-asking). The table is the default, not gospel.
2. **Emission-lift the hit-driven Gen-0/1 effects** (D2 "Lift" row: `follow-hoop`,
   `wipe-3d`, `pixel-accum`, `swing`, `sidechain`, `sacred-hogs`, `collisions`,
   `velocity-flames`, `wave-collapse`): add per-hit emissions via the emission contract
   (`effects/emitter.ts`, reference implementation `chase-bands`), descriptions + tags,
   and **audit kit-fraction reaches → drum-relative** (spark-arc lesson: drum-relative
   distances derive from `drum.radiusMm`; `getHoopPixelRange` resolves hoop ranges).
3. **Implement merges (D2 "Merge" row, LOCKED):** `burst` + `radial-wash` → one
   `radial-wash` (emission-lifted; burst's per-hit pop = short-life preset) · `colour-melody`
   folds into `whole-drum` as a `noteHue` bool param. Merge = keep the better id, alias the
   other, **union the params, preserve presets**.
4. **Populate `aliases.ts`** (`Record<oldId, newId>`) for every Retire→alias + Merge entry
   in D2, and **mark the retired generators `deprecated: { replacedBy }`** so the gallery
   hides them. Aliased ids must keep working forever (existing shows referencing them
   resolve through the map).
5. **Retire + DELETE the legacy pattern path (locked decision 2):** map the 10 pattern
   effects (`flash/chase/sparkle/ripple/swirl/aurora/drift/radial/haze/strobe`) onto their
   generator equivalents via the alias map (D2 lists the targets), then **DELETE
   `voice/pattern-renderer.ts` + the `Pattern` plumbing** once nothing references it (grep
   to confirm zero references before deleting: the pattern render path in
   `compositor.ts:173-190`, `EffectThumb` pattern path, `fixtures`/`sim` pattern entries).
   Note from U1: these 10 currently still appear untagged in the gallery — retiring them
   removes that interim defect.

## Key anchors (verify by symbol — lines drift)
- D2 disposition table: the plan doc (retire→alias / merge / lift / keep rows).
- Emission contract: `packages/core/src/effects/emitter.ts` (Gen-3). Reference lift:
  `packages/core/src/effects/impl/chase-bands.ts`.
- Legacy pattern path: `packages/core/src/voice/pattern-renderer.ts:110-175` (10 patterns),
  consumed at `voice/compositor.ts:173-190`.
- Alias mechanism (U1): `packages/core/src/effects/aliases.ts` (+ `aliases.test.ts`), wired
  at `normalizeGraphs` + `buildShow` (`store.svelte.ts` / show-builder).
- Deprecated flag hides from gallery: already handled by U1's gallery filter logic.
- Drum-relative reach: `drum.radiusMm`; hoop ranges via `getHoopPixelRange`
  (`geometry/pixel-model.ts`).

## Non-negotiables
- **`packages/core` stays pure** — no Node/DOM/IO imports; all rehab/merge/alias logic +
  tests live in core.
- Effects are **pure functions of `RenderContext`** — no hidden global state; seeded
  determinism; no hot-path allocation (the Gen-3 bar).
- If you touch any **UI** code (unlikely — retirement flows through the alias/deprecated
  mechanism U1 built), apply the UI rules: design-system compose/extend + regenerate,
  `/make-interfaces-feel-better`, `pnpm ui-shot` on :4321/:5173.

## Acceptance (gates green — required before you report done)
- `pnpm typecheck` clean.
- `pnpm --filter '!@ledrums/desktop' -r test` green (desktop `shell-tokens.test.mjs` splash
  failure is pre-existing, NOT yours — excluded by that filter).
- **Hydrate-migration test:** an old show document referencing retired ids renders correctly
  via the alias map (add to `aliases.test.ts` or a migration test).
- **Registry test still green:** every non-deprecated effect has description + ≥1 tag +
  maps to one collection (U1's invariant — your retirements set `deprecated`, so they're
  exempt; your lifts/merges keep description+tag).
- `voice/pattern-renderer.ts` + `Pattern` plumbing **deleted**, with a grep proving zero
  remaining references (paste the grep result in your report).
- **ui-shot the gallery** to confirm the 10 legacy pattern effects no longer appear
  (against :4321/:5173) — even though you likely wrote no UI code, this proves the
  retirement is visible.
- **Update the plan doc's status tracker** (row `U3 rehab + retirement`) to `done` with the
  commit hash(es), IN THE SAME COMMIT(S). Keep `notes` current for multi-commit progress.

## Repo state to respect (do NOT touch)
- Untracked/unstaged NOT-YOURS files: `apps/desktop/src-tauri/permissions/`,
  `docs/plans/2026-07-05-app-fixes-plan.md`, unstaged
  `apps/web/src/lib/app/views/TriggerNode.svelte` — Trent's. Never commit or revert them.
- Do NOT implement `docs/plans/perf-sla-telemetry.md` — separate initiative.

## Report back
When U3 is verified (gates green + pattern path deleted + tracker updated + committed):
`twux send-message --session parent --status done --body "<commits + gate results + the
grep proving no pattern refs + any D2 detail adjustments you made + the final aliases.ts
map>"`. If blocked on something genuinely ambiguous (not a locked decision), report
`--status blocked` with the specific question.

# U1 — Effect metadata + gallery redesign (Effects Library v2)

You are the **implementer for Unit U1**. Model: Opus, effort: low.

**Single source of truth:** `docs/plans/2026-07-05-effects-library-v2.md` (passed to you as
extra reading — read it FULLY first, especially D1, D6, D2's KEEP set, and the "Current
state (verified anchors)" section). All 7 decisions in its Decisions table are **LOCKED** —
never re-ask. This brief is the U1 slice of that plan; the plan wins on any detail.

---

## Scope (plan §U1)

Deliver effect metadata + the gallery redesign:

1. **Metadata on the seam (D1, additive — the API shape does NOT change):** add
   `description?: string`, `tags?: readonly string[]`, `deprecated?: { replacedBy: string;
   note?: string }` to `EffectGenerator` (`packages/core/src/effects/types.ts:43-63`).
2. **Controlled tag vocabulary** — one source of truth in core (D1's list: Reactivity /
   Space / Look / Engine tags). Tags are DATA the gallery filters on; nothing else may
   branch on them.
3. **Collections = one taxonomy (`PlayType`)** — the gallery's user-facing collections
   (`Hits`, `Waves & Ripples`, `Particles & Air`, `Textures`, `Ambient & Base`,
   `Meters & Utility`, `Canvas`) derive from tags (first-tag-match, ordered) in ONE core
   vocabulary module. An effect belongs to exactly one collection. (This same module is
   what D3's typed play nodes will consume later — build it as the shared source now.)
4. **`aliases.ts`** (`packages/core/src/effects/aliases.ts`): `Record<oldId, newId>`
   consulted at show hydrate + `setShow` (sim + show-builder) so retired ids keep working
   forever; aliased ids never appear in the gallery. (U3 populates the map; U1 builds the
   mechanism + wires the consult points, empty/near-empty map is fine.)
5. **Flow metadata through:** core registry → `fixtures.ts` (`GENERATOR_EFFECTS`, param
   mapping ~:103-163) → `EffectDef` (`sim.ts`). Add description/tags/deprecated fields.
6. **Gallery cards (D6):** fake-drum thumbnail stays as-is for now (U2 replaces the
   painter); add the 1-line description (2-line clamp), tag pills (max 3 + overflow),
   param-count pill (`6 params`, hover → param names popover). Deprecated effects never
   listed.
7. **Filters (D6):** collection tabs as the primary rail; tag pills as toggleable filter
   chips (AND semantics); search over name+description+tags; a "has parameter" filter
   (dropdown of known param keys). Scope tabs (drum/kit) remain but demoted to a filter
   chip. Keep the portal/Dialog structure, staggered entry, selection ring, `pickEffect`
   flow.
8. **Author descriptions + tags for the whole KEEP set** (plan D2 "Keep" + "Gen-3 (done)"
   rows): `solid-base`, `whole-kit`, `strobe`, `synced-hoops`, `meter-eq`, `breathing-kit`,
   `hue-rotate-kit`, all 12 UV textures, `starfield`, `comet-trails`, `lightning`,
   `confetti-burst`, `helix`, `orbit-rings`, `gravity-wells`, `temp-sweep`, plus the 4 Gen-3
   (`chase-bands`, `ripple-3d`, `spark-arc`, `rain-3d` — extract their existing source
   docblocks into `description`). Descriptions read like the Gen-3 blurbs: what it does +
   why it's cool on THIS kit. (U3 handles the Retire/Merge/Lift rows — you are NOT retiring
   or merging effects; just describe+tag what's kept.)

## Key anchors (verify by symbol — lines drift)
- `EffectGenerator` seam: `packages/core/src/effects/types.ts:43-63`.
- Registry: `packages/core/src/effects/registry.ts` (45 generators).
- Gallery: `EffectGallery.svelte` (scope tabs, search, card grid `minmax(170px,1fr)`,
  `store.pickEffect`). Opened via `store.openGallery(node)` (`store.svelte.ts`).
- Metadata flow: `fixtures.ts` `GENERATOR_EFFECTS` (~:103-163) → `EffectDef` (`sim.ts`).
- `applyAuthored` unions built-ins on hydrate (`store.svelte.ts:1016-1018`) — retirement is
  a FLAG (`deprecated`), never a deletion (removed effects resurrect).

## Non-negotiables
- **`packages/core` stays pure** — no Node/DOM/IO imports; the vocabulary module + metadata
  live in core, unit-tested.
- **UI rules (mandatory, this unit touches the gallery UI):**
  - Use/extend the **design system** (`docs/design-system.html`) — compose from its
    primitives; anything new + reusable gets added to `apps/web/src/lib/styleguide/` and the
    file regenerated (`pnpm design-system`) IN THIS CHANGE.
  - Apply the **`/make-interfaces-feel-better`** skill (polish pass) alongside
    `PRODUCT.md`/`DESIGN.md` context.
  - Verify with **`pnpm ui-shot`** against the dev server already running on **:4321 /
    :5173** — screenshot the card grid + each filter state; the tool also surfaces console
    errors.

## Acceptance (gates green — required before you report done)
- `pnpm typecheck` clean.
- `pnpm --filter '!@ledrums/desktop' -r test` green (the desktop `shell-tokens.test.mjs`
  splash-SVG failure is pre-existing and NOT yours — excluded by that filter).
- **Registry test:** every non-deprecated effect has a `description` AND ≥1 `tag`
  (add/extend `registry.test.ts`).
- ui-shot captures of the redesigned gallery: card grid + each filter state.
- **Update the plan doc's status tracker** (row `U1 metadata + gallery`) to `done` with the
  commit hash(es), IN THE SAME COMMIT(S) as the work lands. For multi-commit work, keep the
  `notes` cell current so an interrupted unit is resumable.

## Repo state to respect (do NOT touch)
- Untracked/unstaged NOT-YOURS files: `apps/desktop/src-tauri/permissions/`,
  `docs/plans/2026-07-05-app-fixes-plan.md`, and the unstaged
  `apps/web/src/lib/app/views/TriggerNode.svelte` edit — Trent's. Never commit or revert
  them.
- Do NOT implement the perf-SLA telemetry plan (`docs/plans/perf-sla-telemetry.md`) — a
  separate initiative.

## Report back
When U1 is verified (gates green + tracker updated + committed), report to your parent
orchestrator: `twux send-message --session parent --status done --body "<summary + commit
hashes + gate results + any deviations from the D2 table you made>"`. If you hit a real
blocker, report `--status blocked` with the specific question — do not guess on locked
decisions (there are none to re-ask).

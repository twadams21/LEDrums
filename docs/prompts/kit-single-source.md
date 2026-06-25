# Single source of truth for the kit + referential integrity (#1 + #3)

Two coupled tasks that kill the kit-drift bug class structurally (a prior bug: web authored content
used drum id `tom` while the engine kit used `tom1`, so drum-scoped effects rendered nothing and a
wash misaligned). A test catches drift; these PREVENT it. Use **/codebase-design** to design the
single-source seam + the validation boundary before editing.

Branch: continue on **`feat/unified-shell`** (P1/P2 already live there, unmerged). Commit a milestone.
Do NOT push / no PR. Keep `pnpm typecheck` + `pnpm test` green.

**SCOPE FENCE (important — another agent owns #2 next):** edit only `packages/core/**` and
`apps/web/src/lib/trigger-lab/**` (the lab kit + show-builder) and their tests. **Do NOT touch
`apps/server/**` or `apps/server/projects/default.json`** — seeding the server default from core is a
separate follow-up (#2). Leave it alone so the work doesn't collide.

## Read first
- `packages/core/src/model/defaults.ts` (`defaultProject()` — the canonical in-code project + its
  `.kit`), `packages/core/src/geometry/kit-schema.ts` (`parseKit`, `KitConfig`, `DrumConfig`),
  `packages/core/src/model/` project schema, `packages/core/src/geometry/pixel-model.ts`.
- `apps/web/src/lib/trigger-lab/kit.ts` (`buildLabModel` — hand-defines its OWN drums; this is the
  duplicate that drifted), `apps/web/src/lib/trigger-lab/fixtures.ts`, `show-builder.ts`,
  `store.svelte.ts` (the `graphs` keyed by `"drumId:zone"`, the setlist slots from P2 in `lib/app/setlist.ts`).
- `docs/plans/2026-06-21-ui-redesign.md` for context.

## #1 — One kit definition (single source of truth)
Today the kit is defined in 3 places (core `defaultProject().kit`, server `default.json`, lab `kit.ts`).
Collapse the CODE copies to one:
- Expose a single **canonical kit** from `@ledrums/core` (e.g. export a `DEFAULT_KIT: KitConfig`
  constant that `defaultProject()` also uses — so there's one definition, not two). Design the exact
  shape with codebase-design (a constant vs a builder; what's importable).
- Make the lab's **offline** model build from that canonical kit: `buildLabModel` should consume the
  core `DEFAULT_KIT` (via `buildPixelModel`) instead of hand-defining drums. Remove the duplicated drum
  geometry in `kit.ts`. Result: the offline lab path and the engine derive from the SAME kit
  definition, so drum ids / geometry can't drift between them.
- Fixtures/graphs that key off drum ids must key off the canonical kit's drums (they already use
  `tom1` after the prior fix — keep them sourced from the canonical kit so a future rename can't desync).

## #3 — Referential integrity at the project/kit boundary
Make an inconsistent project fail loudly at load instead of silently misrendering — for default AND
user-authored projects:
- Add a validation in core (a `parseProject`, or a post-parse integrity check layered on the existing
  Zod schema) that asserts **every authored reference resolves to a drum in that project's kit**:
  show/graph `drumId`s (the `"drumId:zone"` pad keys), section bindings, and the P2 setlist slot graph
  refs (slots reference graphs; graphs reference drums). A dangling ref → a clear thrown error naming
  the offending ref, not a silent skip.
- Apply it at the boundaries: where the web builds the Show (`buildShow` / store) so a dangling ref
  surfaces immediately, and expose the check from core so the server load path (handled later in #2)
  can reuse the same function. Keep the function pure + in core.
- Prefer making dangling refs *unrepresentable* where cheap (e.g. editors only offer kit drums), but
  the load-time validation is the must-have.

## Tests (vitest)
- Core: a project/show with a graph (or slot) referencing a drum id NOT in the kit fails the integrity
  check with a clear error; a consistent one passes.
- Web: the offline `buildLabModel` uses the canonical kit (its drum ids === `DEFAULT_KIT` drum ids) —
  a guard that fails if the lab kit ever diverges again.
- Keep/О adapt the existing drift-guard test from the prior fix if it's now subsumed.

## Report back
When done (gates green) run exactly:
```
twux send-message --session parent \
  --slice-status "<short>" \
  --body "<the canonical-kit seam you designed, what #1 + #3 changed, the validation boundary, tests, and pasted typecheck/test results>"
```
Do not claim success unless `pnpm typecheck` + `pnpm test` are green — paste them.

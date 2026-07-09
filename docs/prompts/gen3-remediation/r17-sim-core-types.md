# R17 — Web sim imports core graph/action types; double-cast removed (GH #96)

Read first: `docs/prompts/gen3-remediation/CONVENTIONS.md`, then
`gh issue view 96 -R twadams21/LEDrums`, then the parent spec's Phase 4.2
(`docs/plans/2026-07-09-gen3-ux-remediation-spec.md`).

The web sim (`apps/web/src/lib/trigger-lab/sim.ts`) mirrors core's
graph/action types and bridges them with `as unknown as` casts. Delete the
mirrored declarations and use type-only imports from `@ledrums/core` so
type drift fails to compile. Behaviour-preserving; the runtime delegation
already exists (R16 routed sim eval through core, and later slices tagged
voices/snapshots — your baseline has R13/R14/P3-fix in it, so the core
types are current).

Watch-outs:
- `packages/core` purity is untouched — this changes web only; imports are
  `import type` so no runtime coupling is added.
- The sim's own preview-only fields (if any) stay local — extend core
  types via intersection/Pick in the sim rather than re-adding mirrors.
- Many web files import types FROM sim (`GraphNode`, `NodeKind`, ...) —
  keep sim re-exporting those names so the change stays contained (the
  shot seam, node-options, inspectors all import from
  `../trigger-lab/sim`).

Acceptance: mirrored declarations deleted, double-cast gone, typecheck +
full suite green (`pnpm gates`). No UI change → no ui-shot.

Sibling note: R27 (inspector components) and R10 (Add pane) are running —
you'll touch `sim.ts` and possibly type-import lines elsewhere; avoid
editing the inspector/AddPalette component bodies.

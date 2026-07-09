# R02 — System-action toasts for migrations and auto-wires (GH #81)

Read first: `docs/prompts/gen3-remediation/CONVENTIONS.md`, then
`gh issue view 81 -R twadams21/LEDrums`, then the parent spec's Phase 1.3
(`docs/plans/2026-07-09-gen3-ux-remediation-spec.md`).

Anything the app does on the user's behalf announces itself in one
plain-language toast. Reuse the existing toast primitive
(`apps/web/src/lib/ui/ToastHost` / `toast.svelte.ts`). Scope: Gen3 schema
migration on load, auto-wiring during hydrate/normalisation. Batch — one
toast per user-visible event, even when a hydrate normalises several graphs.

Sibling note: R01 (wire bug) is being fixed in parallel in the store
connect/projection path — keep your changes to the hydrate/migration seams
and the toast emission layer, so the merge stays clean. Design the emission
as a seam (pure "system actions performed" summary out of hydrate →
toast at the UI layer), not toast calls sprinkled inside store logic.

Acceptance criteria are on the issue, including a component-seam test
asserting toast emission on migration.

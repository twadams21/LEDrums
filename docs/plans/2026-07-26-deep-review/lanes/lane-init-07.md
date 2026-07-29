# Lane: INIT-07-patch-node-identity (light track)

Read `lanes/COMMON.md` first — it binds. Branch: `init/07-node-identity` off `review/impl`
(HEAD is now `9b79ebc` or later — INIT-10 merged; baseline still 3007 tests, re-measure).
Plan: `docs/plans/2026-07-26-deep-review/09-synthesis/INIT-07-patch-node-identity.json`
(steps in its `sequencing` order, one green commit each).

## Decision overrides (11-decisions.md — these beat the plan text)

- **Decision 4: `buildPatchTopology` is DELETED** (this was the plan's one blocking
  question — resolved: delete).
- **Decision 5: the zone Inspector arm is RETIRED** — `PatchZoneInspector` and the
  `zone` arm go; zone editing lives in DrumZonesList. A per-zone node returns with
  its caller if ever needed.

## Watch

- This initiative fixes a LIVE defect: every reconciled port titles as
  "Output output" in the Inspector. Your report must state where that fix landed
  and how you proved it (test or ui-shot evidence).
- UI-visible changes are UI-gated: design system + `/make-interfaces-feel-better`
  + ui-shot pinned to YOUR dev server (`UI_SHOT_BASE=http://localhost:$TWUX_DEV_PORT`).
- Sibling lanes are editing `packages/io`, `apps/server`, and `apps/web/src/lib/ws` —
  all OUT of your scope; if your plan seems to require them, stop and report blocked.
- `PatchClipboardToolbar.svelte` / `PatchDiffDialog.svelte` stay HELD — never delete.

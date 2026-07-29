# INIT-01 single-render-stack — chunked dispatch plan (/slicing-work shape)

One initiative, four sequential-with-one-parallel-pair chunk dispatches, each a
fresh agent + per-chunk review gate + orchestrator merge into `review/impl`.
Plan of record: `09-synthesis/INIT-01-single-render-stack.json`; `11-decisions.md`
overrides it (decisions 1–3). Baseline: re-measure at your chunk's starting HEAD.

**Superseded steps — do NOT execute as written:** S3, S6, S9, S10 (they build the
"sim as thin core delegate"; Decision 3 kills the sim directory outright instead).

## Chunk 01A — server spine (S1, S2, S5, S7)

- Steps as planned: engine-mode pure function; differential parity harness;
  voice transport/project-load authority; default flip (unset LEDRUMS_ENGINE →
  voice; legacy = explicit opt-out). Decision 1: nothing depends on legacy —
  the flip executes unconditionally.
- Fence: apps/server/src/** (per-step file lists), scripts/dev.mjs,
  apps/desktop/src-tauri/src/lib.rs. NOT main.ts beyond the steps' stated edits.
- BLOCKED until INIT-04 merges (same main.ts seam). Anchor check on dispatch:
  main.ts will have moved under INIT-04's extractions (ws-broadcast/ws-connection/
  stats-frame are separate modules now) — verify every plan line-anchor against
  the real file before editing; the extraction may relocate a step's target.
- Effort: opus high (post-reset fleet policy). Resting state: voice default,
  parity green, legacy opt-out alive.

## Chunk 01B — core noise dedup + sim retirement (S4 + Decision-3 replacement)

- S4 as planned (hash2/fade/valueNoise/fbm → packages/core/src/math.ts).
- Decision-3 replacement work: DELETE apps/web/src/lib/trigger-lab/sim* (the
  whole sim module family and its tests/fixtures); the visualiser and any
  offline preview path show an honest "disconnected" state when the WS link is
  down (UI-GATED: design system + /make-interfaces-feel-better + ui-shot on
  the lane's TWUX_DEV_PORT). Store keeps authoring features; only the local
  render/preview mirror dies. Escalate (don't guess) if a feature besides
  preview turns out to consume sim output.
- Fence: packages/core/src/math.ts + the two S4 consumer files;
  apps/web/src/lib/trigger-lab/** (deletions), the visualiser/store seams that
  referenced sim, and the disconnected-state UI surface. No server files.
- Can run in PARALLEL with 01A (disjoint files). Effort: opus high.

## Chunk 01C — authority + the deletions (S8, S11 + Decision-2, S12, S13)

- After 01A and 01B are BOTH merged. Serial, one agent.
- S8 reducer/store authority; S11 delete the 14 dead composition messages;
  Decision-2 added step lands here with S11: remove `composition` + `setlist`
  from the project schema, relocate composition.transport to its proper home,
  old files parse clean via zod strip (greenfield — no migration machinery);
  S12 delete legacy server runtime + retire parity harness into voice suite;
  S13 delete legacy core engine modules KEEPING transport.ts.
- Fence: per-step file lists + the project-schema files for Decision-2.
- Effort: opus high. Highest-risk chunk; every step its own commit + gates.

## Chunk 01D — tail (S14, S15)

- After 01C. Unresolved-id diagnostic (server-scoped VoiceDiagnostic), then
  engine/ → render/ rename with barrel updates.
- Effort: opus medium (mechanical + one small seam). 

## Every chunk

- Common rules: `lanes/COMMON.md` (gates lease, one green commit per step,
  report contract: commit body ≤30 lines is the report; completion message
  names the final sha + branch).
- Escalation triggers: any edit outside the fence; any legacy consumer
  discovered alive (contradicts Decision 1); any project-file field the zod
  strip would silently eat that looks show-critical; UI taste calls.
- Review gate per chunk before merge, reviewer model ≠ implementer model.

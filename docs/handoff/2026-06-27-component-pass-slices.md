# Component pass — slice tracker (Phase 2: /to-issues)

Unified plan = the component-pass PRD (`docs/plans/2026-06-27-componentisation-prd.md`) ×
the 23-PR overlay (`docs/plans/2026-06-27-pr-overlay-direction.md`). Branch
`feat/unified-shell` @ `349bcb4` (typecheck 0, 699 tests). Briefs live in `docs/prompts/comp-*.md`.

**Status: briefs written, awaiting Trent's review. Do NOT build yet.**

## Locked decisions (baked into briefs)
- **D1 — GO:** retire the `?proto=trigger` lab (S0.2 no longer gated). Resolves #17/#18.
- **D2 — core-canonical graph types (S4.4 / #22) — LOCKED (Trent):** web imports `GraphNode`/`GraphEdge`/
  `TriggerGraph`/`TriggerSource` **type-only** from `packages/core/voice/types.ts`; core stays pure. WS
  protocol (#4) stays a SEPARATE app-shared slice (S4.3), NOT in core.
- **D3 — fold patch-flow-controller (#10) into S2.3 — LOCKED (Trent);** extract a standalone controller
  **only if** the view doesn't shrink enough. No standalone S2.4.

## Already merged (do NOT re-slice)
`#1` voice-stats (`8b51688`) · `#2` atomic-file-writer (`b5f48f6`/`c3ff161`/`b7e4ca6`, lands part of S3.4) ·
`#3` TopBar dead prop (`a5329e0`/`3ae3562`, precursor to S2.1).
**Dropped:** `#6` (contradicts keeping store in `trigger-lab/`) · `#23` (spot-check checklists already exist).

## Slice → PR → deps map
| Slice | Brief | PR(s) | Deps | Effort | Worktree-parallel group |
|-------|-------|-------|------|--------|--------------------------|
| **S0.1** delete legacy app | `comp-S0.1-delete-legacy-app.md` | (PRD) | — | L | A (alone; deletes only) |
| **S0.2** retire lab | `comp-S0.2-retire-lab.md` | #17,#18 | — | M | A |
| **S0.3** micro dead-code | `comp-S0.3-micro-deadcode.md` | (PRD) | — | S | A |
| **S1.1** CommitInput/numeric | `comp-S1.1-commitinput-numeric.md` | #16 | — | M | B (foundation, additive) |
| **S1.2** EditableRow/ListItem | `comp-S1.2-editable-row.md` | #14 | — | M | B (prioritize) |
| **S1.3** form opts + formatters | `comp-S1.3-form-options-formatters.md` | #15 | S0.2 | S | B |
| **S1.4** StatusPill | `comp-S1.4-status-pill.md` | (PRD) | — | S | B |
| **S1.5** MasterDetail | `comp-S1.5-master-detail.md` | (PRD) | — | M | B |
| **S1.6** tokens + Styleguide | `comp-S1.6-tokens-styleguide.md` | (PRD) | — | M | B |
| **S2.1** chrome adoption | `comp-S2.1-chrome-adoption.md` | (S2 + #3 done) | S1.1–S1.4 | L | C-after-B |
| **S2.2** views adoption | `comp-S2.2-views-adoption.md` | (S2) | S1.2,S1.3,S1.5 | L | C-after-B |
| **S2.3** graph views | `comp-S2.3-graph-views.md` | #9,#10,#11,#17 | S0.2 | L | C-after-B |
| **S3.1** Inspector split | `comp-S3.1-inspector-split.md` | #8 | S1.1,S1.3 | L | D (own worktree, API-preserving) |
| **S3.2** store split | `comp-S3.2-store-split.md` | #7,#21,#12,#13 | — | L | D (own worktree) |
| **S3.3** sim split | `comp-S3.3-sim-split.md` | (PRD) | — | M–L | D (own worktree) |
| **S3.4** server/core splits | `comp-S3.4-server-core-splits.md` | #5 (#2 done) | — | M | D (own worktree) |
| **S4.1** token aliases + hardcodes | `comp-S4.1-token-aliases.md` | #19 | S0.1 | M | E (last; tree-wide sweep) |
| **S4.3** protocol SSOT | `comp-S4.3-protocol-ssot.md` | #4 | — | M | E (independent) |
| **S4.4** canonical graph types | `comp-S4.4-canonical-graph-types.md` | #22 | S3.3 | M | E (D2; independent) |
| **S4.5** comments + misc | `comp-S4.5-comments-misc.md` | #20 | — | S | E |

## Build order (when approved)
1. **Wave A (immediate, parallel):** S0.1, S0.2, S0.3 — deletions, plus S3.2/S3.3/S3.4/S4.3 can
   start concurrently (API-preserving / independent boundaries).
2. **Wave B:** S1.1–S1.6 foundation primitives (additive; land before adoption).
3. **Wave C:** S2.1 / S2.2 / S2.3 adoption — mutually parallel (disjoint dirs) after Wave B.
4. **Wave D:** S3.1 Inspector split (after S1.1/S1.3) — own worktree.
5. **Wave E:** S4.1 token sweep LAST (after deletions + adoptions so no doomed/rewritten file is
   migrated twice); S4.4 canonical types after S3.3.

Each brief notes its PR(s) so Trent can close Draft PRs as slices land. Orchestrator merges
worktree branches into `feat/unified-shell` + runs the full sweep per merge; ROUTER updated
after integration (not by slice agents).

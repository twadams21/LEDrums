# Direction overlay — the 23 PRs × the component-pass PRD (2026-06-27)

Grounds the 23 ChatGPT-authored proposal PRs (#1–#23) against the real codebase and overlays
them on the component-pass PRD (`docs/plans/2026-06-27-componentisation-prd.md`). Reviewed by
5 parallel grounding agents. **Headline: the two were authored independently yet describe
~85% the same plan** — that convergence is the strongest signal we have that the direction is
right. Branch `feat/unified-shell`, HEAD ~`2a21518`.

## The unified direction (what both say)
Reap the dead legacy app → extract a shared component/primitive language (rows, inputs, form
options, status pills, graph infra) → adopt it across every CRUD surface → split the
god-files (store · Inspector · sim · server main) behind their existing test seams → finish
with a consistency sweep (token aliases, hardcodes, protocol/type drift). The PRs are mostly
the **same slices as branch-sized targets**; they add a handful of refinements and one real
architectural thread the PRD under-played.

## PR → slice map + verdict
| PR | Title | Grounded verdict | Maps to | Action |
|----|-------|------------------|---------|--------|
| #1 | voice stats on WS callbacks | VALID real diff (protocol already has `voice?`) | S4.3 | **merge now** |
| #2 | shared atomic file writer | VALID real diff, applies clean (projects+show-library dup confirmed) | S3.4 | **merge now** |
| #3 | remove unused TopBar `shell` prop | VALID real diff (also flips section-count → `activeSong?.sections`) | S2.1 | **merge now** (precursor to #13) |
| #5 | split server `main.ts` (428) | VALID, exact match | **S3.4** | adopt as S3.4 |
| #6 | promote prod state out of `trigger-lab` | **CONFLICTS** — PRD S3.2 deliberately keeps store in `trigger-lab/store/` | — | **drop** (defer namespace to post-refactor) |
| #7 | split TriggerLab store (1888) | VALID, exact match | **S3.2** | adopt as S3.2 |
| #8 | split Inspector (1359) | VALID, exact match | **S3.1** | adopt as S3.1 |
| #9 | shared SvelteFlow workspace | VALID (canvas boilerplate dup'd Patch/Trigger) | S2.3 | fold into S2.3 |
| #10 | patch graph flow controller | VALID **adds scope** (view orchestration extraction) | new S2.4? | **needs design decision** |
| #11 | derive patch topology from project | **REAL BUG**: input hoop counts use `DEFAULT_KIT`, not `store.project.kit` (outputs already do) | S2.3 | **bug-fix, fold into S2.3** |
| #12 | centralize domain ID generation | VALID (`nid()` scattered across 8 domains) | — (P1 prep) | optional, ship w/ S3.2 |
| #13 | remove legacy sections state | **STALE/wrong** — `store.sections` is LIVE, not dead; U4 claim incomplete | S3.2 | **rescope, after #3** |
| #14 | editable row components | VALID, **highest-impact dup** (≥5 files) | **S1.2** | adopt + prioritize |
| #15 | view form options + formatters | VALID (`MODE_OPTS`/`SWITCH_OPTS`/`fmt` dup'd Inspector+NodeCanvas) | S3.1 prep / S2.2 | extract as P1 prep |
| #16 | numeric field helper | VALID (the two divergent `CommitInput`s) | **S1.1** | adopt as S1.1 |
| #17 | consolidate graph node metadata | VALID but lives in lab `NodeCanvas` | gated on S0.2 | hold; LayersDock `busIcon` fix now |
| #18 | prototype canvas boundary | decision-framing only | **S0.2 gate** | resolve with S0.2 |
| #19 | migrate token aliases | VALID, counts verified (≈PRD) | **S4.1** | adopt as S4.1 |
| #20 | refresh stale source comments | VALID (U4/S7/velocity refs linger) | S4.4 | fold into S4 |
| #21 | show library sync controller | VALID **adds** a clean extraction (reconcile/adopt/sync/saveStatus) | S3.2 sub-slice | fold into S3.2 |
| #22 | canonical voice graph types | VALID **architecturally significant** — web `sim.ts` re-defines core `GraphNode`/`GraphEdge`/`TriggerSource` byte-identically | NEW thread | **needs design decision** |
| #23 | live spot-check plan | **REDUNDANT** — two checklists already exist (`spot-check.md`, `-2.md`) | — | **drop**, reference existing |

## What the PRs ADD beyond the component pass
1. **A real bug (#11):** the Patch graph's *input* half still computes hoop counts from
   `DEFAULT_KIT` while the *output* half is already project-authoritative — so non-default kit
   geometry renders wrong upstream. Cheap fix; fold into S2.3.
2. **The web⇄core type-duplication thread (#22):** `apps/web/.../sim.ts` re-declares core's
   `GraphNode`/`GraphEdge`/`TriggerGraph`/`TriggerSource` byte-for-byte (kept in sync by
   structural typing). The PRD only flagged web⇄**server** protocol drift (S4.3); this is the
   web⇄**core** model boundary — bigger, and it intersects the still-pending `packages/core`
   model refactor. **Decision: where does the canonical graph type live** — `packages/core`
   (must stay pure — fine for types), a new shared `packages/types`, or stay duplicated until
   the core model refactor? 
3. **Two extraction sub-slices (#21 sync controller, #10 flow controller)** that make the
   store/view splits cleaner — #21 folds into S3.2; #10 is a genuine new scope call.
4. **Comment hygiene (#20)** — stale initiative names (U4/S7/velocity) in live source.

## What's stale / superseded (don't just merge)
- **#6** contradicts the PRD's deliberate "keep the store in `trigger-lab/`" decision — drop.
- **#13** is premised on `store.sections` being dead; it's **live** — must be rescoped
  (depends on #3 landing first) or it breaks the app.
- **#23** duplicates the two spot-check checklists that already exist.

## Quick wins available immediately
The 3 real diffs — **#1 (voice stats), #2 (atomic writer), #3 (TopBar prop)** — are correct,
low-risk, and mergeable now (independent of the big pass). #2 also lands part of S3.4 early.

## Decisions required (Trent)
- **D1 — S0.2:** retire the `?proto=trigger` lab (`NodeCanvas` + `TriggerLab.svelte`, ~1,667
  lines)? Gates #17/#18 and unblocks reaping. (Are the trigger-model branches settled?)
- **D2 — #22:** where should the canonical graph types live (core / shared package /
  duplicated-for-now)? Architectural; affects the eventual core model refactor.
- **D3 — #10:** is graph-view orchestration-controller extraction in scope for this pass
  (new S2.4), or deferred?
- **D4 — proceed:** approve the unified plan (component pass + these PR deltas) for the
  component-orch to `/to-issues` + build, staged or full?

## Unified phased plan (component pass + PR deltas)
- **P0 Reap:** S0.1 legacy app (28 files) · S0.3 micro-dead · **merge #1/#2/#3 now** · #13
  (rescoped) · S0.2 (D1-gated).
- **P1 Foundation:** S1.1 CommitInput (**#16**) · S1.2 EditableRow (**#14**, prioritize) ·
  form options/formatters (**#15**) · StatusPill/MasterDetail/Graph prims · domain-ids (#12).
- **P2 Adopt:** chrome/object-section/graph-view adoption · **#9** + **#11 bug** fold into
  S2.3 · #10 (D3-gated as S2.4).
- **P3 Splits (API-preserving):** store **#7** (+#21 sync sub-slice) · Inspector **#8** · sim ·
  server **#5**/**#2**.
- **P4 Consistency:** token aliases **#19** · hardcodes→tokens · protocol SSOT **#4** ·
  comments **#20** · canonical types **#22** (D2-gated).

# Mission — Componentisation pass (Phase 1: EXPLORATORY)

You are a fresh **`/twux orch` sub-orchestrator** launched by the meta-orchestrator
(`orch-b2dcef`, your `parent`) to run the **componentisation pass** for LEDrums. **Phase 1
is EXPLORATORY ONLY**: fan out a large fleet of read-only explore subagents to map the
**entire** frontend, then synthesize a PLAN. **Do NOT implement anything yet** — produce the
plan and report it to your parent for sign-off. Then wait.

First read `.mex/ROUTER.md` (full project state) and `AGENTS.md` (non-negotiables). Branch
`feat/unified-shell`, HEAD ~`4739254`, tree clean. The two prior initiatives (CRUD/Perform;
recall/objects/server-shows) just shipped — see ROUTER. Two PRDs in `docs/plans/2026-06-27-*`
show the house PRD shape; `docs/handoff/2026-06-27-orch-status*.md` show the worktree-agent
build pattern you'll use in Phase 2.

## Goal of the pass
Make the UI **as componentised as possible** so the look & feel is consistent and editable
in one place — leaning on **bits-ui** (the headless foundation) and the existing wrappers in
`apps/web/src/lib/ui/` (Select · Dialog · Tooltip · SegmentedControl · Field · IconButton ·
CommitInput · ContextMenu · SaveIndicator · Splitter · Eyebrow · …) on the oklch token system
(`apps/web/src/styles/tokens.css` + `app.css`). While exploring, also surface **large files
to split** and **dead code to remove**.

## Phase 1 — explore EVERY file (this is the whole job for now)
1. **Inventory** the frontend tree: every `.svelte` and relevant `.ts`/`.svelte.ts` under
   `apps/web/src/` (also scan `apps/server/src`, `packages/core`, `packages/io` for dead code
   + oversized files, but componentisation is web-focused). Get the full list + line counts
   (`git ls-files | grep`, `wc -l`).
2. **Partition into ~10–14 chunks** and launch **A LOT of explore subagents (10+, one per
   chunk)** via the harness **Agent tool** using **`haiku-4-5-medium`** (or `Explore`)
   subagent types — NOT twux launches (keep it fast + pane-free; twux is for the Phase-2
   implementers). **Every file must be covered by exactly one explorer.** Send them in
   parallel batches (respect the concurrency the harness allows).
3. **Each explorer returns, per file**, a structured report of:
   - **Componentisation** — repeated markup/logic to extract into a shared component;
     hand-rolled UI that should use an existing `lib/ui/` primitive or bits-ui; divergent
     patterns a component would unify. Name the proposed component + where it'd live.
   - **Large-file split** — files doing too much / over ~300–400 lines; how to split them by
     concern/seam (extract pure helpers, sub-components, stores).
   - **Dead code** — unused exports / components / branches / styles. **Verify with a
     reference grep before listing** (false positives are costly — say how you confirmed).
   - **Consistency** — token/style divergences that should converge.
4. **Synthesize** all findings into a **PRD** (`/codebase-design` framing — deep modules,
   seams; `/to-prd` shape) at `docs/plans/2026-06-27-componentisation-prd.md`: the component
   library to extract/adopt, the file-split list, the dead-code removal list — grouped into
   **independently-buildable slices with file boundaries** so Phase 2 can worktree-parallelize
   like the prior initiatives. Include a coverage table proving every file was explored.
5. **STOP and report to parent.** Do NOT slice (`/to-issues`) or build yet.

## Method notes
- Haiku explorers return conclusions, not file dumps — give each a precise file list + the
  exact report schema above.
- Be concrete: every finding names the file(s), the proposed component/seam, and a rough
  size (so slices can be scoped). Prioritise high-impact, low-risk wins.
- Read-only in Phase 1. The only writes are your planning docs under `docs/`.
- **Watch usage** (`twux usage`) — 10+ agents over the whole tree is real spend; haiku keeps
  it cheap, but gate if 7d climbs high and report partial coverage rather than stalling.

## Report-back (when the plan is ready)
`twux send-message --session parent --status "component-pass plan ready | N comp ops · M splits · K dead" --body "<every-file-covered confirmation + headline findings + path docs/plans/2026-06-27-componentisation-prd.md + proposed slice count>"`.
Then wait for sign-off before Phase 2 (`/to-issues` → worktree implementers).

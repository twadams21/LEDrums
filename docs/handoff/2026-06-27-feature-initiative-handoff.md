# Handoff — new feature initiative: Trigger graph + Effects

You are a fresh **`/twux orch`** launched to own a NEW feature initiative. The componentisation
pass is **COMPLETE** (see below). Three features + their scoping are below.

## ⛔ FIRST: PAUSE — do not build yet
Read this doc, `.mex/ROUTER.md`, and the pointers below. Then **tell Trent you're ready and WAIT
for his instructions** — he will set priority/order and the open design decisions. Do **NOT**
decompose, write briefs, launch agents, or edit code until Trent directs you.

**You work DIRECTLY with Trent in your own pane.** Do NOT `twux send-message` your twux parent
(the component-orch that launched you) — it has finished the componentisation pass and stepped
back. If you need a decision, ask Trent in-pane.

## Branch state (start point)
`feat/unified-shell` @ `6c41172` — typecheck 0, **791 tests** (core 201 · io 13 · protocol 1 ·
server 80 · web 496). The componentisation pass (P0 reap → P1 primitives → P2 adopt → P3 splits →
P4 consistency) is merged + reviewed Clean. Plus 3 live-spot-check fixes (TopBar width, Inspector
follows active focus, computer-keyboard plays the active section's graph list). The pass made the
code *more* amenable to this work: Inspector is split into per-kind editors under
`lib/app/docks/inspectors/`; graph types are core-canonical in `packages/core/voice/types.ts`;
the store is sliced; shared `lib/ui` primitives exist.

## The proven workflow (use it once Trent says go)
Same as the pass: `/codebase-design` → a right-sized PRD in `docs/plans/` → file-bounded slice
briefs in `docs/prompts/` → **twux worktree implementer agents** (`git worktree add … -b … ;
pnpm install --prefer-offline ; twux launch --role impl --doc … --read docs/prompts/_worktree-note.md`)
→ per-phase `/code-review` reviewer → orchestrator merges + full-sweep. Template artifacts:
`docs/plans/2026-06-27-componentisation-prd.md`, `docs/prompts/comp-*.md`,
`docs/handoff/2026-06-27-component-pass-slices.md`. **Gotchas learned:** twux `--prompt` sometimes
pastes-without-submitting — verify each launch started (`twux capture`) and submit a `" "` if a
`[Pasted text]` buffer is stuck; keep ≤3 agents wide unless Trent says otherwise; the
`block-no-verify` hook false-positives on the literal string "git commit" in a bash command.

## The three features (with scoping already done — don't re-investigate from scratch)

### #1 — Delay node (size: **L**, the architectural one)
A new trigger-graph node kind that **delays firing its children** by either absolute time (ms) or
a musical division (1/4, dotted 1/8, triplet, …). The engine HAS `beat`/`bpm`/`beatPhase`
(`apps/web/src/lib/trigger-lab/sim.ts` ~258–275, 640) but **no scheduling primitive** — a delay
needs a **deterministic pending-fire queue** drained in the engine `tick()` (must stay PURE +
deterministic in `packages/core`). Touches: core `voice/types.ts` (`NodeKind` += `delay` + fields
`delayMode 'time'|'beats'`, `ms`, `division`), core `voice/eval-graph.ts` (delay branch enqueues
children), core `voice/engine.ts` (queue + drain in tick), web `sim.graph-compilation.ts` +
`sim.ts` (mirror), a new `lib/app/docks/inspectors/DelayNodeInspector.svelte`, and the node
palette/meta (`lib/app/views/node-options.ts`, `trigger-node-meta.ts`, `GraphPalette`).
**Open Q for Trent:** division set (1/4·1/8·1/16, dotted, triplet?), and confirm the delay
schedules a real deferred re-fire (vs a visual offset).

### #2 — Computer-keyboard graph triggering — ✅ ALREADY FIXED (`785d003`)
Keys 1–9 → graphs 1–9, 0 → graph 10 in the ACTIVE section; extra keys no-op
(`store.fireSectionGraph` + `App.svelte`). Listed for completeness — no work needed.

### #3 — Per-effect scope **kit/drum/hoop** + target by ID (size: **M**)
`Scope` already exists as `'drum' | 'kit'` (`packages/core/src/voice/types.ts:18`,
`apps/web/src/lib/trigger-lab/sim.ts:64`). Add **`'hoop'`** + a **`targetId`** (a drum or hoop
**id** — names drift, so reference by id). `scope:'drum'` today = the firing drum; new explicit
`targetId` overrides it, and `'hoop'` scopes to one hoop. Touches: core types (`Scope` +
`targetId?`) + `voice/compositor.ts` / `pattern-renderer.ts` (mask output to the target's pixel
range — hoop ranges come from `geometry/pixel-model`), web sim mirror, and
`lib/app/docks/inspectors/PlayNodeInspector.svelte` (scope selector kit/drum/hoop + a target
dropdown sourced from the project's drums/hoops **by id** — the patch/`store.project.kit` is the
option source). **Open Q for Trent:** when scope is kit, target is ignored — confirm; and whether
a drum-scope effect with an explicit other-drum target should follow the hit or the target.

### #4 — Better generated effect thumbnails (size: **M**)
`apps/web/src/lib/trigger-lab/EffectThumb.svelte` renders a generic pattern sample today; make each
thumbnail render the **actual effect** on a representative pixel layout so the gallery preview
reads as what the effect does (`EffectGallery.svelte` is the consumer). **Open Q for Trent
(design fork):** a **looping live mini-render** of the real effect (most representative, heavier)
vs a **single characteristic still frame** (cheaper, static).

## When Trent gives the go
Confirm priority/order (suggested: #3 + #4 in parallel — independent — then #1 delay node on its
own given the engine work), bake his design answers in, then run the standard PRD → briefs →
worktree-agents → review loop. Keep `packages/core` pure + deterministic for #1/#3.

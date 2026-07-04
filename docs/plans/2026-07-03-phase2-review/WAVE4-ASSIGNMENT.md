# Wave 4 assignment — design audit / critique + polish

**Agent:** one **fable** session (own window, **low effort** — compensated by this spec + master review). **Worktree:** `../ledrums-wt/wt-3`. **Branch:** `wave-4/polish` (exists, off merged `rock-solid` — waves 1–3 are in). **Parent:** `twux send-message --session parent` (≤30 lines per message).

**Method (mandatory):** this is a DESIGN wave. Drive it with the **`/impeccable`** skill in audit/critique mode — headlessly: capture every view with `ui-shot`, critique against Impeccable + the product context (`PRODUCT.md`; north star: Linear-inspired, as dark as Resend), fix, re-shot. Apply **`/make-interfaces-feel-better`** on every change (its before/after tables go in your report). You never open a headed browser — `LEDRUMS_WEB_PORT=5178 LEDRUMS_WS_PORT=4326 pnpm ui-shot …` is your eyes (`--viewport 1280x800` AND `--viewport 1920x1080`; READ the PNGs, don't just generate them).

**Read first:** `docs/plans/2026-07-03-phase2-review/WAVE3-REPORT.md` (what just landed + follow-ups), `TRENT-DICTATION-2.md` (north star + rejected patterns), `AGENTS.md` (non-negotiables), `HANDOFF.md` cross-cutting #1 (the app-fatal self-referential `$effect` class — you are working in preview territory again).

## Trent's locked decisions (2026-07-04 — do not relitigate)

1. **Node previews: FULL coverage now.** Every remaining kind — modifier, switch, chance, toggle, delay, sequence, all, random — gets a preview: a static state face (e.g. chance %, delay time, toggle state, sequence step) plus a trigger-driven response where the node gates/routes a hit. The seam is ready: `store.selectedGraphFireAt` + pure `triggerClock` (`signal-preview.ts`). Never read+write the same $state in one `$effect`; null-guard rAF-sampled getters.
2. **LFO / CC previews stay continuous.** Do not gate them.
3. **Buses/Layers cards keep constant height.** Do not compact the empty state.
4. **Inspector input fields are THE density/design target** (Trent, verbatim: "it mainly is the input fields in the inspector pane that could have their sizes and design improved"). Audit every editor under `apps/web/src/lib/app/docks/inspectors/` + the `ui` field primitives they compose (`TextField`, `CommitInput`, `Select`, `Slider`, `SegmentedControl`, `Field`, `EasePicker`, `ColorSwatch`): sizing, alignment, label treatment, row rhythm, consistency. Make the Node Editor drawer's inspector feel Linear-quality. Improve the primitives (styleguide entries updated in the same change), not per-view one-offs.

## Scope

**A. Full design audit/critique (all views).** Shot every named surface at both viewports; write the critique down (it becomes the report's audit section); fix what you judge wrong — hierarchy, spacing rhythm, alignment, contrast, focus states, control consistency. Concrete fixes over grand redesigns; the approved shell layout itself is settled — polish it, don't re-lay-out.

**B. Inspector field redesign** (locked decision 4) — likely the biggest single item.

**C. Preview full coverage** (locked decision 1).

**D. Follow-ups from WAVE3-REPORT:** GraphsDock styleguide demo (a faithful store-free stub in `SectionComposites` or `SectionGraph`).

## Gate & report

- `pnpm design-system` regen (once, at the end; every touched primitive/composite demoed).
- Full sweep: `pnpm typecheck` + `pnpm test` green, 0 skips, all packages.
- `LEDRUMS_WEB_PORT=5178 LEDRUMS_WS_PORT=4326 pnpm ui-shot --all --strict` clean at BOTH viewports; before/after shots for every audit fix. (Gotcha from wave 3: don't let ui-shot reuse a stale server on :5173 — run your own dev server on the assigned ports.)
- Commit `docs/plans/2026-07-03-phase2-review/WAVE4-REPORT.md`: audit findings (kept + fixed), per-item changes/evidence/tests, the /make-interfaces-feel-better before/after tables, surprises. Slim final message to parent.

## Rules

- Locked graph prefs: NO node lift/click animations; INSTANT hover; drop-wire-anywhere → input. REJECTED: numbered modifier-order chips; drag-to-reorder modifier list.
- Core purity + determinism (AGENTS.md): previews are display-only — never engine state.
- One commit per coherent item; verify live per item, not just at the end.
- Budget: `twux usage`; above ~85% of the 5h window → finish current item, commit, report partial.

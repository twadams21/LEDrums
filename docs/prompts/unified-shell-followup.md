# Follow-up: fix a regression, then build Sections-as-graph-slots

Two tasks, in priority order. Stay on `feat/unified-shell`. Keep `pnpm typecheck` + `pnpm test`
green. Do NOT push or open a PR.

A clean stack is already running (started by the orchestrator): web on **:5173** (the unified shell at
`/`), voice server on **:4321** (`LEDRUMS_ENGINE=voice`). It hot-reloads as you edit (Vite HMR for web,
`tsx watch` for the server). Reproduce against it.

## PRIORITY 1 — diagnose + fix a regression (use /diagnose)

Now that the unified shell drives the **real server voice engine** (engine link live), the user reports
two regressions vs the old behaviour:
- **(a) Effects don't trigger as reliably as they used to** — some hits don't produce a voice / look.
- **(b) The 3D radial "wash" effect isn't behaving in 3D** — it no longer spreads across the kit in 3D
  the way it did.

**Known-good reference:** the OLD local sim — `apps/web/src/lib/trigger-lab/sim.ts` + `render.ts`. The
standalone lab at **`/?proto=trigger`** still runs it locally; compare it side-by-side against the
unified shell at **`/`** (which uses the server engine). That diff is your oracle.

**Suspect path (what changed):** the ported engine — `packages/core/src/voice/{engine.ts,
compositor.ts, prng.ts}`, `apps/server/src/voice-engine-host.ts`, and the shell's input/Show wiring
(`apps/web/src/lib/trigger-lab/show-builder.ts` + store WS send of `key`/`setShow`/`setTransport`).

**Hypotheses (reproduce + instrument; don't assume):**
- **Effect scope.** A "wash" is **kit-scoped** (whole kit). If scope is dropped anywhere
  (effect/preset → play node → Show via `buildShow` → ported eval → voice → compositor pixel range),
  a kit-scoped voice may render **drum-scoped** (one drum only) → "not in 3D". Trace scope end-to-end.
- **Compositor radial/world coords.** `compositor.ts` `radial` (and aurora/drift) read world `nx/ny/nz`
  from `buildPixelAttrs`. Verify those are the world-normalized coords (ported from `kit.ts`) and the
  centre/scale match `render.ts`. A wrong axis/centre flattens the wash.
- **Trigger reliability.** key → `voice-engine-host.applyInput` → engine **input queue drained at tick**
  → graph eval → `spawn`. Check: event `timeMs` stamping vs `engineTimeMs` (events stamped in the
  future never drain?), velocity, zone/padKey match (lab numeric `pad.zone` vs server `slotToZone`
  labels), the **256 voice cap + mono-bus stealing** (the original probe flagged: a one-shot on a mono
  look bus steals the loop), and PRNG/chance gating determinism.

Fix the **root cause** (not symptoms). Add a regression test where feasible (the core voice engine has
vitest; determinism/scope are testable). Verify gates. Then report (see below) before starting P2.

## PRIORITY 2 — next milestone: Sections-as-graph-slots

Per `docs/unified-ui-wireframe.html` + `docs/plans/2026-06-21-ui-redesign.md`. Replace the current
SectionsView ("looks + recall") with the real model:
- **Grid:** sections on X, drums on Y, with **2–3 graph slots per drum**.
- **Graphs, not clips:** a slot holds a reference to a trigger **graph**. The same graph can be reused
  across sections (same graph in Verse 1 & Verse 2 — not copied), and slots **layer** (stack a second
  graph in a slot to evolve a section: Verse 2 = Verse 1's graph PLUS more). Layer routing lives inside
  the graph (buses), so slots are graph layers, not a separate layer axis.
- **Song → sections hierarchy:** songs in the left rail, sections as the columns of the active song.
- Design the model extension with **/codebase-design** (how a section references graphs per
  `(drum, slot)`, reused-by-reference; where it lives relative to the existing `graphs` /`sections`
  on the store; how it flows through the Show to the engine). Polish with **/make-interfaces-feel-better**.
- Flag honestly anything needing a deeper model or persistence change rather than faking it.

## Report back
After **PRIORITY 1** (and again after PRIORITY 2), run exactly:

```
twux send-message --session parent \
  --slice-status "<short status>" \
  --body "<P1: root cause + the fix + regression test + gate results | then P2 when done>"
```

Do not claim success unless `pnpm typecheck` and `pnpm test` are actually green — paste the output.

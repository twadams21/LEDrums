# Fix + redesign: Trigger-graph node-add palette → top-bar buttons + modals (+ OSC modulation)

Standalone implementer task from the Rock Solid master orch — a **direct Trent request**, NOT a slice. Work on branch `fix/trigger-graph-node-palette` off `rock-solid` in your assigned worktree. Report to your parent (master) via `twux send-message --session parent --status ready`.

## The problem (Trent, hit it live)

The Trigger graph's top-left add-node area stacks **three** palettes — `TriggerGraphView.svelte`, in the `{#snippet palette()}` (~L356–359, `<div class="palette-stack">`):
1. `GraphPalette items={PALETTE_ITEMS}` — trigger/source/play kinds → **KEEP as-is**.
2. `ModifierPalette` (`ModifierPalette.svelte`, S32) — lists ALL ~18 modifiers grouped by category with a SegmentedControl filter → **oversized, blocks most of the canvas**.
3. `GraphPalette items={MODULATION_ITEMS}` — modulation sources (envelope/lfo/cc).

### Asks
1. **BUG — canvas click/drag blocked horizontally next to the palette (vertically below is fine).** Root cause: `GraphCanvas.svelte:119` renders the palette in xyflow `<Panel position="top-left">`; the panel/stack intercepts pointer events across the empty strip to the right of the visible controls. **Fix pointer-events so ONLY the actual buttons/controls capture events** — the empty canvas beside/around the palette must stay pannable, clickable, and wire-drag-connectable. (Likely: container `pointer-events: none` + interactive children `pointer-events: auto`, and/or size the panel to content. Verify against xyflow's Panel.)
2. **REDESIGN (modifier):** replace the big `ModifierPalette` with a **single "Add Modifier" button** in the top palette bar, styled to **match the existing `GraphPalette` buttons exactly**. Click → **modal** to pick the modifier type (registry-driven via `listModifiersByCategory()`; keep the category grouping/filter INSIDE the modal). On select: add the node at the visible canvas centre (as `addModifierNodeAt` does now) and close.
3. **REDESIGN (modulation):** same pattern — a **single "Add Modulation" button** → **modal** to pick the source type (envelope / lfo / cc; `MODULATION_ITEMS` / `voice.isModSourceKind`). On select: add via `addNodeAt`.
4. **FEATURE (OSC modulation):** the `cc` modulation source reads MIDI CC only today (`store.ccNodeLiveValue` → `voice.sampleCc(sim.ccTable, controller, channel)`). **Add OSC as a modulation input in addition to MIDI** — a modulation source drivable by an OSC address (0..1), analogous to MIDI CC. Model it on the existing OSC input path (`apps/web/src/lib/trigger-lab/sim.trigger-source.ts`, `store.trigger-source.ts`, and how OSC values arrive/are stored). Expose the OSC option in the CC/modulation node inspector (`ModifierNodeInspector.svelte` / the CC source inspector) and wire it through sim sampling so the node's signal preview + modulation output reflect live OSC.

## Scope / sequencing (graceful degradation)
Land in this order, committing after each so the urgent fix isn't hostage to the feature:
1. **Bug fix (pointer-events)** — smallest, highest urgency.
2. **Modifier + modulation → top-bar button + modal** (the redesign).
3. **OSC modulation support.** If OSC proves to span core/protocol/sim deeply and threatens the sitting, commit 1+2 first, then attempt OSC; if you can't land OSC cleanly this sitting, **flag it in your report** and I'll split it into a follow-up — do NOT ship a half-wired OSC path.

## Design system + polish (MANDATORY)
- The modal MUST use the existing dialog primitive `apps/web/src/lib/ui/Dialog.svelte` — do not hand-roll. Compose from the design system; anything new+reusable gets added to the styleguide entry (`apps/web/src/lib/styleguide/`) and `pnpm design-system` regenerated **in the same change** (AGENTS.md rule).
- Apply the `/make-interfaces-feel-better` pass. New top-bar buttons must match `GraphPalette`'s button look exactly.

## Non-negotiables (AGENTS.md)
- `packages/core` stays pure — no Node/DOM/IO. OSC *transport* stays behind io/sim; core only gets **pure** sample functions (mirror `sampleCc`).
- Deterministic render loop; effects are pure functions of state; **no self-referential `$effect`** (a P0 just shipped from `effect_update_depth_exceeded` — an effect that read+wrote the same `$state`). Null-guard anything the rAF preview ticker samples.

## Verify BEFORE reporting (CRITICAL)
- `pnpm typecheck` (0 errors) + `pnpm test` (no skips). Add tests at the seams: modal add flow still calls the store add; **OSC modulation sampling as a pure function** (like `sampleCc`); pointer-events fix if testable.
- **LIVE SMOKE-LOAD (mandatory — a P0 shipped this week from skipping it):** `pnpm dev`, load the app, open the Trigger graph. Confirm and REPORT: (a) NO console errors (esp. `effect_update_depth_exceeded` / uncaught rAF throws); (b) canvas click/drag works in the strip NEXT TO the palette (the bug); (c) Add Modifier / Add Modulation buttons open modals and add nodes; (d) an OSC-bound modulation source samples live.
- Regenerate `docs/design-system.html` if you touched the styleguide.

## Report (≤30 lines)
Commit a handoff at `docs/handoff/rock-solid/fix-trigger-graph-palette-report.md` (final commit), then `twux send-message --session parent --status ready`. Include: what now works (demoable first), the OSC design, files touched, acceptance evidence INCLUDING your live-smoke-load observations, gates, any deviations/scope cuts.

## Commits
Incremental, one intent each (e.g. `trigger-graph: pointer-events — palette stops blocking the canvas`, `trigger-graph: Add Modifier button + type-picker modal`). Push opportunistically.

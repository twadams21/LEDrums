# Build the LEDrums unified shell

You are a full Claude Code session implementing the **unified application shell** for LEDrums — the
one cohesive app that reconciles the original control app with the new trigger-lab UI. Build it on
the **trigger-lab design system**, port the rest of the UI onto that DS (or build from scratch where
cleaner), and make it the real app.

## First, use these skills (required)
1. Invoke **/codebase-design** and apply it to design the shell's module **seams** before writing UI:
   the shell store / view-router, the view modules, the dock modules, and how they depend on the
   existing trigger-lab store + engine link. Deep modules, small interfaces, testable.
2. Invoke **/make-interfaces-feel-better** and apply it throughout: motion (enter/exit, mode
   crossfade ~200ms), hover/active/focus states, optical alignment, tabular numerals on live
   readouts, border-driven focus, reduced-motion + WCAG AA. Craft is part of the spec.

## Read first (ground truth)
- **Target IA / wireframe:** `docs/unified-ui-wireframe.html` — open it; it is the authoritative
  layout + interaction model (mode switch, rails, docks, views, overlays). Mirror its structure.
- **Design log + locked decisions + current state:** `docs/plans/2026-06-21-ui-redesign.md`
  (read the whole file, especially "Locked decisions", "Core model port", and the status notes).
- **New UI to build on:** `apps/web/src/lib/trigger-lab/` (TriggerLab.svelte, NodeCanvas.svelte,
  StatusBar.svelte, EffectGallery/ClipSettings/EnvelopeEditor/EffectCreator, store.svelte.ts with the
  WS engine link) and the design system in `apps/web/src/lib/ui/` (IconButton, Select, Slider,
  SegmentedControl, Toggle, Dialog, Drawer, Card, Field, Tabs, Tooltip, etc.) + tokens in
  `apps/web/src/styles/tokens.css` (oklch graphite + phosphor-lime accent).
- **Old app to port FROM:** `apps/web/src/App.svelte`, `apps/web/src/lib/shell/` (PerformShell,
  AuthorShell, SettingsView, StatusCluster, LivePill), `apps/web/src/lib/views/` (RoutingView,
  ArrangeView, MapView), `apps/web/src/lib/panels/` (Transport, OutputConfig, InputMonitor,
  LayerStack, EffectParams, ClipGrid), `apps/web/src/lib/store/app-store.svelte.ts`,
  `apps/web/src/lib/ws/` (client.ts, protocol-types.ts), `apps/web/src/lib/visualizer/`
  (Scene, Pixels2D), `apps/web/src/lib/midi/webmidi.ts`.
- **Engine:** the server runs the new voice engine (`LEDRUMS_ENGINE=voice`); the trigger-lab store
  already connects over WS (`setShow` / `setTransport` / `key`, receives frames + stats). Reuse that.

## What to build (the shell)
Mirror the wireframe exactly in structure:
- **Mode-split shell** keyed off a shell store `mode` — **Perform** ⇄ **Author** with a ~200ms
  reduced-motion-aware crossfade.
- **Author shell:** top bar (Brand · Mode switch · Setlist/Project open·save·new · Transport
  play/stop/BPM/tap/clock · Status cluster · Output pill) · left rail (Songs list + Views nav) ·
  Workspace (swaps view) · bottom dock (**Layers / Buses, permanent**) · right dock (Visualizer
  pinned + tabbed **Inspector** ⇄ **Monitor/Log**). Overlays: Effect Gallery / Clip-Graph Settings /
  Envelope Editor / Effect Creator (drawers + modals on the existing Bits-UI Dialog/Drawer).
- **Views (workspace swaps):**
  - **Trigger Graph** — Play Surface (left; triggers stacked + nested by drum, scrolls) + NodeCanvas.
  - **Patch Graph** — the **input/device routing** graph (Controller/Sensory-Percussion · MIDI · OSC
    → Kit drums/zones → Output). This *replaces* the old Input Map table and the Settings page.
  - **Sections / Setlist** — grid of reusable, **layerable graphs** (NOT clips): sections on X,
    drums on Y, **2–3 graph slots per drum**; the same graph can appear in multiple sections, and a
    second graph can be stacked in a slot to evolve a section. Layer routing lives inside the graph.
  - **Kit** — kit geometry (3D transforms · hoops · spin).
- **Perform shell:** keep the **Songs rail on the left**, then a minimal live bar (transport · status
  · output), a **section-recall** strip, a big **3D | 2D visualizer split**, and **large trigger pads**.
- **Contextual settings:** selecting a node (effect/play node, Patch Controller/Output node, a bus)
  loads its settings into the **right-dock Inspector**. There is no separate Settings page.
  Switching views resets the Inspector.

## Constraints (non-negotiable)
- Svelte 5 runes. Reuse `lib/ui/` components + tokens — do NOT hand-roll bare controls or invent
  colours. The LED output is the only free-saturated colour; role colours carry the signal path.
- `packages/core` stays pure (no DOM/Node/IO). All IO behind `packages/io` / the WS link.
- No new dependencies beyond what's installed (bits-ui, threlte, @xyflow/svelte, @lucide/svelte).
- Reduced-motion alternative for every animation; AA contrast (there's `apps/web/scripts/contrast-check.mjs`).

## Approach
- Make the unified shell the **default app** (`App.svelte` / the main mount), reusing trigger-lab
  components + store. You may keep `/?proto=trigger` working during transition. Prefer evolving the
  trigger-lab pieces into shared shell modules over duplicating them.
- Decompose with codebase-design: a shell store (mode/view/selection/dock state), view components,
  dock components, the overlay layer. Keep each a deep module behind a small interface; unit-test the
  store logic.
- Wire the existing engine link (the store already does setShow/setTransport/key + frames/stats) so
  the shell drives the real server engine.

## Workflow
- Create a branch `feat/unified-shell` first (do NOT work on `main`). Commit in logical milestones on
  that branch so work is recoverable. **Do not push and do not open a PR** — leave that to the user.
- Build the shell IA + wire the existing components to a working end-to-end state FIRST, then port the
  remaining view internals. Keep `pnpm typecheck` and `pnpm test` green as you go.
- Verify: `pnpm typecheck`, `pnpm test`, and run `pnpm dev` (with `LEDRUMS_ENGINE=voice`) to sanity
  check the app actually renders + the mode/view switching + engine link work. If a headless browser
  is available, capture screenshots; otherwise describe what you verified.

## Report back
When the shell is functional end-to-end (typecheck + tests green, app runs) — or if you hit a real
blocker / design fork that needs the orchestrator — run exactly:

```
twux send-message --session parent \
  --slice-status "<short status, e.g. 'shell scaffold + Trigger/Patch/Sections/Kit views, gates green'>" \
  --body "<full report: branch, module structure you designed, what's built, what remains, any deviations from the wireframe/decisions, and the typecheck/test results>"
```

Do not claim success unless `pnpm typecheck` and `pnpm test` are actually green — paste the final output.

# S3 — Inspector as a window-right slideover above all chrome + Add-node on-canvas popover

**Effort: opus/high (novel shell seam) · branch `feat/inspector-slideover` off `main` · PR into
main.** Visual reference: `docs/proto/trigger-inspector-drawer.html` **option 1 (auto overlay)**
on `proto/trigger-reimagine` @ `e06b726` — but read the verdict deltas below; they override it.

## What Trent decided (verbatim quotes in the verdicts doc §2)

The trigger-view inspector moves out of the right grid column into a **slideover anchored to the
right edge of the WINDOW**, painting **above all app chrome** — deliberately overlapping the drum
preview / bus / layer docks. Node-select opens it; canvas click or Escape dismisses it; the graph
canvas geometry NEVER changes when it opens/closes (overlay, not push).

Implementation consequence (already scouted): it cannot live in `TriggerGraphView`'s grid — hoist
it to the shell layer where the other overlays live (see `Overlays.svelte` and how dialogs mount
above the docks). z-order: above docks and bars, below actual modal dialogs.

## The Add-node palette — decided by Trent 2026-08-17: on-canvas popover

Today `NodeEditor.svelte` is one panel with two tabs (Inspect / Add). The Add tab becomes an
**on-canvas popover**: a searchable node palette summoned at the cursor (canvas right-click
and/or a `+` affordance; keep the existing add-node keyboard path working — check the registry
shortcut gating that landed in #176). The node lands where the popover was invoked. The drawer
is then purely selection-keyed. Reuse the existing add-node taxonomy/search internals
(`add-node-taxonomy.ts`, the current Add tab's list) — this is a re-housing, not a rewrite.

## Interaction contract (apply /make-interfaces-feel-better)

- Open on node select (any node kind), stay open while selection changes (content swaps in
  place, no close/reopen flicker).
- Dismiss: Escape, canvas background click. Re-select reopens.
- Slide motion on the design system's motion tokens (--dur-*, --ease-control); reduced-motion
  keeps a fade.
- Drawer width: keep today's NodeEditor resizable range (280–460, default 320) unless the code
  says otherwise — verify, don't invent.
- While open, the covered docks are non-interactive under it (it's an overlay, not a ghost).

## Anchors to verify

- `apps/web/src/lib/app/docks/NodeEditor.svelte` — the current two-tab panel, its resize
  mechanics, and every parent that mounts it.
- `Overlays.svelte` (or the shell's overlay mount point) — how it layers over docks; z tokens
  (`--z-*` scale from S1.6).
- `TriggerGraphView` — what happens to the vacated grid column (it should collapse; the canvas
  gains the space permanently).
- Selection store: what drives "a node is selected" today and how canvas-click clears it.
- `add-node-taxonomy.ts` + the Add tab internals; the #176 registry shortcut gating.

## Scope fence

May touch: the shell overlay mount + one new slideover component, `NodeEditor.svelte` (split:
inspector content vs add palette), a new `AddNodePopover` component, `TriggerGraphView` grid,
selection/store wiring it needs, styleguide entry + `pnpm design-system` regen, ui-shot presets.
Non-goals: ANY inspector *content* changes (S4/S5 own those — the panes render as they are
today inside the new drawer), settings view, patch view, other views' right columns.

## Evidence

- Typecheck 0 + targeted vitest for the files you touched, committed HEAD pushed. **Do NOT run
  the full `pnpm test` sweep — orchestrator-only rule (parallel sweeps can crash this
  machine); the orchestrator sweeps at review.**
- ui-shot: drawer closed / open-over-docks / add-popover open — `--strict` (zero console
  errors). Existing NodeEditor presets updated rather than deleted.
- Styleguide: slideover + popover demoed; design-system.html regenerated in the same change.
- Report: commit body <30 lines; one-line completion message with sha + branch.

## Escalate if

- The overlay hoist requires moving per-view state into the shell in a way that leaks trigger
  concerns into other views' code paths.
- Escape-to-dismiss conflicts with an existing global Escape consumer (name it, propose an
  ordering, wait).
- You find a second mount of NodeEditor serving a non-trigger surface.

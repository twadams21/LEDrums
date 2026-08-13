# E1 — "Segments" effect: wedge the drum, colour the wedges, fire them creatively

**Source:** Trent, 2026-08-14 (this machine), verbatim intent: a new effect where a drum is
divided into "segments"/wedges, each wedge colourable — with pattern generators so 20
segments doesn't mean setting 20 colours — and firing behaviours from all-at-once to
sequential to every-second-segment. "Think creatively and add parameters that would allow a
lot of creative expression."

**Base:** branch `feat/segment-effect` off `origin/feat/tabbed-chrome` (the current preview
stack). PR targets `feat/tabbed-chrome`. Effort high — this is a novel effect with a state
question in it.

## Before designing: study the anatomy (anchors)

- How effects are defined/registered: `packages/core` effects registry, an existing
  multi-param effect (e.g. chase bands) end to end — param schema → UI (typed play-node
  params / effects gallery) → render function.
- The purity contract (AGENTS.md, constitutional): effects are pure functions of
  `RenderContext` — deterministic given (time, inputs, model), no hidden global state. For
  anything "advances per hit", study how PRNG/sequence state is handled (graph-key state
  prefixes, the sequence node) and use the same mechanism. If per-hit advancement can't be
  expressed within the existing state seams, ESCALATE with a proposal before building.
- How geometry reaches effects: pixels have XYZ + hoop structure; a "wedge" is an angular
  sector around the drum's axis — verify how existing radial/angular effects compute angle
  per pixel (startAngleDeg / localSpinDeg matter).

## The effect (required capabilities, design the rest)

1. **Segmentation:** N wedges (angular sectors) across the drum; sensible N range; rotation
   offset; optionally a gap/feather between wedges (hard vs soft edges).
2. **Colouring without 20 pickers:** manual per-segment colours must be POSSIBLE, but the
   default path is generators — e.g. alternating A/B(/C), gradient sweep around the drum,
   palette cycle, hue-step from a base colour, seeded random-but-stable. Trent named
   "alternating or similar"; give a small set that composes well rather than a mega-matrix.
3. **Firing behaviours** (Trent's list + your creativity): all segments per hit ·
   sequential — one segment advancing per hit · in-order chase across the effect's life
   within one hit · every-Nth-segment · consider ping-pong/random-order/width>1. Check what
   composes naturally with graph nodes first (a sequence node driving multiple instances?) —
   don't duplicate what routing already gives, and SAY in the report which behaviours you
   deliberately left to the graph.
4. **Expression parameters:** whatever earns its place — per-segment decay stagger,
   direction, intensity falloff across segments, life/envelope interplay. Every param must
   visibly do something; no speculative knobs.

## Fence + discipline

May mutate: `packages/core` (the new effect + registry + its unit tests — core stays pure,
no IO/DOM), the web-side param-exposure surface for the new effect (whatever the registry
pattern already requires — gallery/param components follow the existing typed pattern), a
styleguide/design-system regen only if you add a genuinely new param control, ui-shot
presets. Non-goals: engine/host/protocol changes, other effects, settings panes
(`settings/**` is another worker's active lane — hard fence), TriggerGraphsRail.

House rules bind: /efficient-svelte for any UI, deterministic core (unit tests must cover
determinism: same ctx → same frame; segment boundaries exact at pixel level), test names
describe behaviour. Kit pixel counts for realism: kick 196 / snare 108 / tom1 108 / tom2 136.

## Evidence + report

Unit tests incl. golden/structural frames for: wedge boundaries, each colour generator, each
firing behaviour (advance-per-hit determinism via the state seam). Verify LIVE in your
worktree dev server (free ports — 5373/4323/9102 are the orchestrator's preview, 4341/4342/
9110 and 4350/4351/9030 may be in use by siblings): author a graph with the effect on a drum,
fire it, ui-shot the gallery + params + a mid-fire frame. Gates green on committed HEAD,
twux push, PR → feat/tabbed-chrome. Report: params list with one-line rationale each, the
state-seam decision, what was left to graph routing, shots, sha, test delta.

## Escalation triggers

- Per-hit segment advancement cannot be done deterministically within existing state seams.
- The param surface needs a UI control type that doesn't exist (propose before building).
- Anything forcing changes outside the fence.

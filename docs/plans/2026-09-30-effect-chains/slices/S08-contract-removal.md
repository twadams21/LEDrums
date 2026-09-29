# S08 — Contract: delete the graph model, the graph editor and the legacy formats

Read first: `00-overview.md`, then the spec section "Removals", and "Domain language" in the spec.

Runs last, alone, after S01–S07 are merged into the stack.

## Build

Delete everything the Effect model replaced. The deletion is only complete when nothing imports
it and `pnpm dead-code:verify` (knip) is clean.

- **Web UI:**
  - the graph editor: `TriggerGraphView`, `TriggerGraphsRail`, `TriggerNode`, `GraphCanvas`,
    `AddNodePopover`, `AddGraphDialog`, `InspectorSlideover`, and the wire / lint / align /
    flow / drop helpers and their tests;
  - the node inspectors that have no Effect-card use;
  - the orphaned Patch-graph components and their now-unused helpers;
  - `GraphPickerDrawer` / `LinkPlacementDialog`;
  - the `node` selection kind and its users (`duplicateSelectedNode`, delete-key node removal,
    `inFlowCanvas`);
  - `@xyflow/svelte` (package.json and the lockfile via `pnpm install`).
- **Web store:**
  - the graph and node API;
  - graph persistence;
  - the v1 / v2 read paths, EXCEPT inside `legacy-import.ts`, which must keep importing v1 / v2;
  - the `graph` / `node` ClipDoc kinds;
  - graph fixtures and templates;
  - graph-only Sim code.
- **Core:**
  - graph eval, the render plan, graph integrity and lints, modifier-graph and modulation-graph
    resolution, the runtime slot grid;
  - the routing / mix node code;
  - graph types (`TriggerGraph` / `GraphNode` / `GraphEdge` / `SlotRefs`, the looks-based
    `Section`) and `Show.graphs` / `buses` / `effects` / `presets` / `sections` where no longer
    needed;
  - `fireGraph` (engine, protocol, server).

  **Keep** everything below `PlayAction`, and the splice / slice machinery that S03's generators
  use.
- **Merged-away generator implementations** (wave-collapse, follow-hoop, and the deprecated
  chase / burst / colour-melody, plus strobe / sidechain as generators). Remove them if no Style
  references them. Keep effect aliases only where an import path still needs them.
- **Server:** the v2 restore path (v2 blobs are only read by the web import; the server keeps
  archives, it doesn't run them).
- **Tooling:** remove the graph ops from `shot-seam.ts` and the dead `shots.json` presets, and
  repoint any preset that still makes sense. Styleguide: delete `SectionGraph` / `GraphDemoNode`
  and the NodeCard / lint demos no longer used. The orchestrator regenerates the design-system
  file.
- **Docs:**
  - `CONTEXT.md` glossary: add Effect, Generator, Style, Modifier, Control, Target, Cell, Stack,
    Master chain and MIDI-map mode; retire the graph terms.
  - Update `.mex/context/architecture.md`, and add or refresh `.mex/patterns` for "add a
    generator style" and "add a modifier".
  - Mark the old Gen3 graph PRD docs as superseded.
  - The orchestrator writes the ROUTER entry.

## Anchors to verify

The size map in the planning notes (web ~6.1k lines of editor source and tests, plus ~2.3k of
Patch-graph orphans, plus the core graph layer). Use knip, `rg` and typecheck to find true
dependants before deleting. Do not delete the legacy Composition engine (`engine/engine.ts` and
related); it is out of scope.

## Scope fence

Anything that is graph-only, per the above.

**Non-goals:**

- behaviour changes to the Effect path;
- the legacy Composition engine;
- kit, patch, outputs or input-map code.

## Acceptance

- Typecheck, dead-code and targeted vitest over every touched package pass. The orchestrator
  then runs the full `pnpm test`.
- No reference to `TriggerGraph` / `@xyflow` / `fireGraph` remains outside `legacy-import.ts` and
  historical docs.
- ui-shot `--all --strict` has no failing presets (the orchestrator runs it).
- The commit body lists deleted areas with line counts.

# S4a — Settings parity inventory + pane spec

**Parent plan:** `docs/plans/2026-08-13-tabbed-chrome-settings.md` (read fully — especially the
parity-contract table and the decided open questions). **This slice writes a spec document, not
app code.** Output: `docs/plans/2026-08-13-tabbed-chrome-slices/S4a-pane-spec-OUTPUT.md`,
committed to a branch off `origin/main` and pushed (branch `docs/s4a-pane-spec`, PR optional —
the orchestrator merges it with the wave).

## Goal

1. **Re-derive the parity inventory from code** — do not trust the plan's table; it is a
   hypothesis. Walk every mutator/affordance reachable from the Patch surface today and list it:
   - `apps/web/src/lib/app/views/PatchGraphView.svelte` and everything it mounts.
   - `apps/web/src/lib/app/docks/inspectors/Patch*.svelte` (Kit, Drum, Hoop, Output,
     Controller, Zone, Trigger inspectors), `DrumZonesList.svelte`, `RenameField.svelte` usage,
     `ControllerStatusPanel`, `OutputStatusPanel`, `UniverseRxTable`, `AdoptByIpRow`,
     `ReadRow`, scope/status helpers.
   - `apps/web/src/lib/app/shell-store.svelte.ts` + `docks/patch-inspector.ts` — the mutator
     surface (`setRouting`, `setHoopConfig`, `setDrumTransform`, `setKitGlobal`, `setOutput`,
     `setInputMap`, `identifyHoop`, `startMidiLearn`/`cancelMidiLearn`, controller ops:
     `discoverControllers`/`adoptController`/`identifyController`/`setControllerAuth`/
     `setControllerTestData`/`backToLive`/`requestNetworkAdapters`/`watchController`,
     `setPatchLabel`/renames, `setNodeLayout`).
   **Completion criterion (constitutional): every mutator the old surface can call is either
   assigned a shipped home in a pane or explicitly listed as dying.** Known dying:
   `setNodeLayout`/`kit.nodeLayout` (canvas layout dies with the canvas; schema field dropped,
   kit version bumped, migrator strips — greenfield posture, no migration machinery).
2. **Write the pane map** — five panes: **Input · Drums & Hoops · Outputs & Chains ·
   Controller · System**. For each pane: every control by name, the mutator it drives, the
   component it reuses (reuse the controller status/adopt/test panels wholesale — keep the
   watch-on-open/unwatch-on-close lifecycle), layout sketch (sections/rows), and validation
   source (Outputs & Chains rides the existing core routing-validation seam).
3. **Decided constraints to honour** (Trent, 2026-08-13): chain editing = per-output ordered
   list, drag-reorder + move-up/down, "add hoop" picker fed by an **unassigned-hoops pool**,
   remove returns to pool. Settings modal = sectioned modal with `?settings=<pane>` deep links
   (S2 builds the shell; your spec fills the five panes).
4. **Fence the S4b–e slices**: for each of S4b (Drums & Hoops), S4c (Outputs & Chains),
   S4d (Controller), S4e (Input + System), name the component files each will create so the
   four slices are provably file-disjoint (one import line each into the modal registry).

## Scope fence

May write: the OUTPUT spec doc only. No app code, no test changes. Read anything.

## Evidence + report

Effort: **high** (completeness judgment). Report = SendMessage to parent: one line with the
branch, commit sha, and the mutator count (inventoried / homed / dying). The orchestrator
sends the spec to Trent for morning review; S4b–e dispatch against it overnight, so
**ambiguities you leave become four agents' ambiguities — resolve or escalate them now.**

## Escalation triggers

- A mutator with no sensible pane home (would need a new pane or a redesign).
- Evidence the unassigned-pool model conflicts with current routing semantics.
- A patch-surface affordance that isn't a mutator but would still die homeless (e.g. a
  read-only status view with no pane slot).

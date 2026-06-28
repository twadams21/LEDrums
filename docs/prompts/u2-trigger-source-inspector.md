# U2 — Trigger-source Inspector editor + node sub-line

Slice T2 of `docs/prompts/trigger-node-source.md` (read it). Builds on **U1** (the trigger-source model, commits `5b0217b`/`f6f021e`): `TriggerSource` union + `store.setTriggerSource(graphKey, source)` + `store.triggerSource(...)` already exist. Branch `feat/unified-shell`. **No other agent is running on these files now**, but stay strictly in scope.

## Goal
The **trigger node** (root of every trigger graph) becomes editable in the Inspector: declare its **Trigger Source** (Drum / MIDI / OSC). The node card shows the resolved source as its sub-line. Nodes stay display-only; all editing is in the Inspector (the established xyflow-unification pattern).

## Scope (disjoint — yours)
- `apps/web/src/lib/app/docks/Inspector.svelte` — add the trigger-node `source` editor branch.
- `apps/web/src/lib/app/views/TriggerNode.svelte` — the node sub-line shows the resolved source.
- A small **pure** helper (e.g. `describeTriggerSource(source, drums)` → `{ label, sub }`) in a new `apps/web/src/lib/app/trigger-source-label.ts` + test, if it keeps the `.svelte` thin (recommended).
- Use the **Svelte MCP / `svelte:svelte-file-editor`** for `.svelte`; autofixer clean.
- **Do NOT** touch `sim.ts`, `store.svelte.ts` (U1's mutators already exist — just call them), `core/*`, `input-router.ts` (U3), `PatchGraphView`/patch-* (patch slices), `SectionsView`/`setlist` (U4/U5).

## Inspector editor (per the doc's spec table)
When the selected node is the trigger node (the graph root), show:
| Field | UI |
|---|---|
| **Trigger Source** | `SegmentedControl` Drum / MIDI / OSC (the `source.kind`) |
| (drum) **drum** | `Select` over kit drums (`store.drums`) |
| (drum) **zone** | `Select` over that drum's zones (`store.pads`/zone labels for the drum) |
| (midi) **note / CC** | a note↔CC toggle + a 0–127 number field (one or the other) |
| (osc) **address** | text field (`CommitInput`), e.g. `/kick` |
| **rename** | label override (reuse the existing patch-node rename pattern if one exists for graph nodes; else the graph's `graphNames`) |

- **Read-only hints** (display, NOT editable here — they live on the patch graph): for `midi`, show the **channel** comes from the patch device; for `osc`, the **namespace/host** comes from the patch device. A short muted hint line is enough.
- Writes go through `store.setTriggerSource(<current graph key>, source)` (the selected graph is `store.selectedPadKey`/`selectedGraph`). Optimistic + autosaved already (U1).
- Reuse `lib/ui/` primitives (`SegmentedControl`, `Select`, `TextField`/`CommitInput`, `Field`) + oklch/green tokens — no bare HTML controls.

## Node sub-line (`TriggerNode.svelte`)
The trigger node card's sub shows the resolved source: drum → `kick · center`; midi note → `MIDI note 38`; midi cc → `MIDI CC 74`; osc → `OSC /kick`. Use the pure `describeTriggerSource` helper. Back-compat: a node with no explicit source (authored graph) shows a sensible placeholder (e.g. `unbound`).

## Acceptance
- Selecting a trigger node shows the Drum/MIDI/OSC editor; switching mode + editing fields writes via `setTriggerSource`; the node sub-line reflects it live.
- `pnpm --filter @ledrums/web typecheck` + `test` green; autofixer clean; the pure helper unit-tested.

## Report back
Report to parent (`twux send-message --session parent`) with commit SHA, files, the helper API, gate output, deviations. **Commit before reporting.** Leave `.mex/ROUTER.md` to the orchestrator.

# Brief — unify Trigger & Patch graphs on @xyflow/svelte (shared node design + editable patch)

You are an **implementer agent** on LEDrums (branch `feat/unified-shell`). Trent (the human)
is driving the **orchestrator** in the parent pane; report back to it (see "Report back").

Read this whole brief before touching code. Read `.mex/ROUTER.md` and `CLAUDE.md` first for project
context and non-negotiables.

## The one-line goal

Both node graphs in the app currently run on **different engines**:
- **Patch Graph** (`apps/web/src/lib/app/views/PatchGraphView.svelte`) — already `@xyflow/svelte`,
  read-only, custom `PatchNode.svelte`.
- **Trigger Graph** (`apps/web/src/lib/app/views/TriggerGraphView.svelte` → hand-rolled
  `apps/web/src/lib/trigger-lab/NodeCanvas.svelte`, ~954 lines) — bespoke SVG/DOM editor.

**Unify both onto `@xyflow/svelte`** with one shared node visual design, move all per-node editing
into the right-dock **Inspector**, implement a precise hover/lift/wire interaction, and make the
**Patch graph editable** (wiring only). The Patch node design must NOT change — it is the source of
the shared look. Port that look to the Trigger graph.

This is a real refactor, not a restyle. Work in the phases below and **commit after each phase**.

## Hard constraints (from CLAUDE.md)

- All work is in `apps/web` — do NOT touch `packages/core` (stays pure) or `packages/io`.
- No new heavy deps. `@xyflow/svelte` is already a dependency (used by Patch). `@lucide/svelte` is
  already used for icons. Bits-UI wrappers live in `apps/web/src/lib/ui/`.
- This is a `.svelte`-heavy task: **use the Svelte MCP server tools** (`list-sections` /
  `get-documentation` / `svelte-autofixer`) and/or the `svelte:svelte-file-editor` subagent for every
  `.svelte` file you write or change. Autofix + re-validate until clean.
- Svelte 5 runes throughout (`$props`/`$state`/`$derived`/`$state.raw`). Match surrounding idioms.

## Gate discipline (IMPORTANT — shared working tree)

- During work, typecheck ONLY the web package: `pnpm --filter @ledrums/web typecheck`.
  (The cross-package `pnpm typecheck` goes red while any sibling has uncommitted WIP — ignore it
  mid-flight.)
- Tests: `pnpm --filter @ledrums/web test` for the web suite.
- Before you call a phase done: web typecheck 0 errors + web tests green, THEN commit that phase.
- Do not break the existing 99 web tests. Add tests for new pure logic (e.g. a graph↔xyflow converter).

## Current behavior to preserve (the Trigger editor does all of this today — keep it working)

- Left **Play Surface** rail (drum-grouped pads + Authored graphs + "New graph") — unchanged.
- Pick a pad/graph → edits its graph on the canvas. `{#key store.selectedPadKey}` rebuilds on switch.
- Drag node to move (writes through to `store.moveNode`), pan canvas, zoom.
- Drag output port → input node to wire (`store.connect`, which rejects dup/cycle/wrong-direction;
  play is a sink, trigger is a source). Click a wire → select → Delete/Backspace removes
  (`store.disconnect`). Add-node palette. The store is the source of truth and autosaves to
  localStorage, so every edit must still flow through the store mutators.

## Store / model API you will use (all already exist; from `trigger-lab/sim` + `store.svelte`)

- Graph: `store.selectedGraph` (`TriggerGraph { nodes: GraphNode[]; edges: GraphEdge[] }`),
  `store.selectedPadKey`, `store.selectedPad`, `store.authoredGraphs`, `store.createGraph()`.
- Graph ops: `store.addNode(kind, x, y)`, `store.moveNode(node, x, y)`, `store.removeNode(node)`,
  `store.connect(fromId, toId)`, `store.disconnect(edgeId)`, `store.changeKind(node, kind)`.
- Node geometry: `NODE_W`, `nodeHasInput(kind)`, `nodeHasOutput(kind)`, `NODE_KINDS`.
- Play-node ops: `store.effectOf(node)`, `store.liveParams(node)`, `store.busOf(node)`,
  `store.setBus(node, busId)`, `store.setMode(node, mode)`, `store.openSettings(node)`,
  `store.openGallery(node)`, `store.presetById(id)`, `store.presetsForEffect(id)`,
  `store.selectPreset(node, id)`, `store.toggleLink(node)`, `store.setParam(node, key, v)`,
  `store.isEnveloped(node, key)`, `store.openEnv(node, key)`, `store.envKind(node, key)`.
- Per-kind ops: `store.setNoRepeat(node, bool)` (random), `store.setSwitchOn(node, on)` (switch),
  `store.setChance(node, p)` (chance).
- Buses: `store.buses` (`[{ id, name }]`). Bus icons: `base→Disc3`, `trigger→Activity`,
  `effect→Wand2` (see `NodeCanvas.svelte` `busIcon`). Kind icons + kind tints: see `NodeCanvas.svelte`
  `kindIcon` and `tint`.
- Shell selection: `shell.select({ kind: 'node', nodeId })`, `shell.clearSelection()`,
  `shell.selection`. (Patch uses `{ kind: 'patch', nodeId }`.)

---

## Phase 1 — Shared `NodeCard` + xyflow node types

Goal: one presentational card used by both graphs, so the Patch look is literally the shared look.

1. Extract a `apps/web/src/lib/app/views/NodeCard.svelte` from the existing `PatchNode.svelte` markup:
   a **role/kind-tinted icon chip** (left), a **title** + mono **sub** line, an **optional thumbnail
   slot on the RIGHT** (default empty), and accepts a `selected`/`hovered`/`dropTarget` state +
   `tint`/`role` colour. Use a snippet/children for the right-side thumbnail so play nodes can pass an
   `EffectThumb`.
2. Refactor `PatchNode.svelte` to render via `NodeCard` — its appearance must be **pixel-identical** to
   today (icon chip + title + sub, no thumbnail). Verify visually unchanged.
3. Create `apps/web/src/lib/app/views/TriggerNode.svelte` — an xyflow custom node for the trigger graph
   that renders `NodeCard`:
   - icon chip = `kindIcon[node.kind]` tinted with `tint[node.kind]`.
   - **play** node: title = effect name, sub = preset name, **thumbnail on the right** =
     `EffectThumb` (`pattern`, `params=store.liveParams(node)`). No inline controls.
   - **trigger** root node: title = `drum · zone` (`store.selectedPad`), sub = "Trigger".
   - container/modifier nodes (all/random/sequence/switch/chance/toggle): title = kind label,
     sub = a short summary (e.g. chance → `45%`, switch → `on velocity`, random → `no-repeat`).
   - Left `Handle type="target"` if `nodeHasInput(kind)`, right `Handle type="source"` if
     `nodeHasOutput(kind)`. Trigger has output only; play has input only.
4. **Hover / lift / wire interaction** (this is a precise spec — get it exactly right, in `NodeCard`
   + the view CSS):
   - On node **hover**: the whole node lifts (a small upward nudge) AND its **ports lift with it** AND
     its **connected wires follow the lift**. In xyflow a pure CSS `transform` on the inner card leaves
     the handles + edges behind (that is the current Patch detach bug). Fix it the xyflow-native way:
     on hover, nudge the node's **actual position** up a couple px (e.g. `position.y -= 2`) so xyflow
     re-routes edges + moves handles as one unit; restore on leave. (Guard so it never fights an active
     drag/selection. Respect `prefers-reduced-motion` — no nudge.)
   - On node hover the node border highlights **`--accent`** (like a hovered wire does today).
   - On node hover, **every wire one level connected to that node** (in- and out-edges) highlights as
     if hovered (accent stroke).
   - On node **select** (clicked into Inspector): accent ring on the node, but **connected wires do
     NOT highlight** — selection ≠ wire highlight. Only hover highlights wires.
5. Wire highlighting: drive it from a `hoveredNodeId` state in the view; an edge is "connected" if its
   source or target equals `hoveredNodeId`. Apply an accent class to those xyflow edges (xyflow edges
   accept a `class`/`style` or you can toggle a `selected`/data attr + `:global` CSS under `.canvas`).

Commit: `feat(web): shared NodeCard + xyflow TriggerNode design + hover/lift/wire interaction`.

## Phase 2 — Port the Trigger Graph onto `SvelteFlow`

Rebuild `TriggerGraphView.svelte` (and retire the bespoke `NodeCanvas.svelte` once parity is reached —
keep the Play Surface rail markup) so the canvas is `@xyflow/svelte`, mirroring `PatchGraphView.svelte`
structure + the project-token `:global` styling block (copy the xyflow token theming from
PatchGraphView; share it if practical).

- **Converter (pure, unit-tested):** a `graph-to-flow.ts` module mapping `TriggerGraph` →
  `{ nodes, edges }` for xyflow (node id, `type: 'trigger'`, `position {x: node.x, y: node.y}`, `data`)
  and back. Rebuild the xyflow arrays when `store.selectedPadKey` changes.
- **Sync interactions through the store** (store stays source of truth + autosaves):
  - node drag → on drag stop, `store.moveNode(node, x, y)`.
  - `onconnect` → `store.connect(source, target)` then re-derive edges from `store.selectedGraph`
    (let the store's validation reject bad wires; don't let xyflow keep an invalid edge).
  - edge delete (Delete key / click-select) → `store.disconnect(edgeId)`.
  - edge **reconnect / rewire** (drag an edge end to a new node) → `store.disconnect(old)` +
    `store.connect(...)`. Enable `edgesReconnectable`.
  - node click → `shell.select({ kind: 'node', nodeId })`; pane click → `shell.clearSelection()`.
- **Add-node palette**: reuse the existing palette look from `NodeCanvas.svelte` (top-left toolbar,
  kind icons + tints). Click → `store.addNode(kind, x, y)` at the viewport centre in flow coords.
- Keep xyflow `Controls` + `MiniMap` + dotted `Background` like Patch.
- **No inline node controls** — the node is display-only; all editing is in the Inspector (Phase 3).

Commit: `feat(web): port Trigger Graph onto @xyflow/svelte (store-synced, Inspector-driven editing)`.

## Phase 3 — Inspector becomes the full node editor (all kinds)

Today `Inspector.svelte` only fully edits **play** nodes; other kinds show a one-line description, and
kind-change + remove lived in the node header. Move ALL of it into the Inspector node branch:

- **Header for every node**: title + kind, a **kind selector** (`store.changeKind`, except the trigger
  root which is read-only), and a **Remove** button (`store.removeNode`).
- **Play node**: keep the existing rich editor (effect swap, preset, instance/linked, params,
  envelopes) — already present.
- **Play-mode + Layer controls — use the ICONED button groups** (Trent's explicit request): replace
  the Inspector's current *text-only* `MODE_OPTS`/`LAYER_OPTS` SegmentedControls with the **iconed**
  variants from `NodeCanvas.svelte`: mode = One-shot/Loop/Hold with `Zap`/`Repeat`/`Hand`; layer =
  `store.buses` with `busIcon` (`Disc3`/`Activity`/`Wand2`). Same SegmentedControl component, just pass
  `icon` per option.
- **Per-kind controls** moved from the node: random → `no-repeat` checkbox (`store.setNoRepeat`);
  switch → `on` select velocity/section/beat (`store.setSwitchOn`); chance → `%` slider
  (`store.setChance`). all/sequence/toggle → label/summary (no extra controls today).
- **Trigger root node**: read-only summary (drum · zone), no remove/kind.

Commit: `feat(web): Inspector hosts full per-node editing for every node kind (iconed mode/layer)`.

## Phase 4 — Make the Patch Graph editable (wiring only)

Scope (confirmed): **wiring edits only**, ephemeral local graph state. Do NOT build a device-settings
model (zone OSC/MIDI bindings, 8 data lines / 4 outputs, controller IP / sACN-Art-Net) — that is a
separate later slice. Keep the data-line/output chunking note in `PatchGraphView` as-is.

- Enable editing on the existing `SvelteFlow`: `nodesConnectable={true}`, remove the
  `pointer-events:none` on handles, enable edge selection + Delete + `edgesReconnectable`.
- **Delete wires + rewire/reconnect** between stages, operating on the local `$state.raw` edges array
  (Patch has no store-backed graph — edits live in the view state, consistent with how the topology is
  built once at mount).
- **Add-node palette** matching the trigger one (top-left). For Patch, "add" creates a local device
  node (e.g. Data Line / Output) in view state only — clearly ephemeral (not persisted). Keep it
  minimal; the real device model is the future slice.
- Patch nodes keep the same hover/lift/wire interaction from Phase 1 (they share `NodeCard`).
- Selecting a patch node still loads it into the Inspector (`{ kind: 'patch', nodeId }`) — unchanged.

Commit: `feat(web): editable Patch Graph — wire delete/rewire + add palette (ephemeral, no model yet)`.

## Final sweep

- `pnpm --filter @ledrums/web typecheck` → 0 errors. `pnpm --filter @ledrums/web test` → green
  (existing 99 + any you added). Run a Svelte MCP autofix pass over every changed `.svelte` file.
- If `NodeCanvas.svelte` is fully retired, delete it and remove dead imports. If anything still
  references it (the lab `?proto=trigger`), say so in your report instead of breaking it.

## Report back (verbatim command)

When finished (or if you hit a blocking ambiguity), run:

```
twux send-message --session parent \
  --slice-status "<one-line status>" \
  --body "<commits per phase; gate results (web typecheck + web tests counts); what you ported vs deleted; any deviations from this brief and why; live spot-checks the orchestrator should do on :5173>"
```

Report HONESTLY: if a phase is partial, say which and why. Do not claim green gates you did not run.
Commit each phase as you go (do not leave the work uncommitted — the orchestrator verifies via git).

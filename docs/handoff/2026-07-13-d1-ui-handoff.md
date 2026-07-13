# D1 handoff + sub-slice assessment — Patch Graph v2 canvas (LDR-8)

**Author:** D1 implementer · **Date:** 2026-07-13 · **Branch:** `slice/d1-canvas-v2` (off `patch-graph-v2` @ `4890f0f`)
**Model layer committed:** `182ed74` (core only, 838 core tests green, core typecheck clean).
**Repo state:** RED on web/server — they still reference the removed `dataLines` shape. This doc is the map + the
green-checkpoint assessment for the remaining web+server+UI work. **No further build past 182ed74 until the scope call.**

---

## 0. What 182ed74 already did (the seams the UI consumes)
- `OutputConfig` dropped `dataLines[]`; an Output carries its hoop chain directly as range-compressed
  `segments: OutputSegment[]` (**Output = exactly one data run**). `DataLineConfig`/`dataLineSchema` removed from core.
- `migrateKit` v6→7 (`CURRENT_KIT_VERSION=7`) splits each pre-D1 output's data lines into one output per line,
  lifting per-line `startUniverse` → **byte-identical DMX** (golden test proves it, incl. rgbOrder carry).
- `buildDmxMap` / `checkRoutingIntegrity` walk `outputs→segments→hoops`. `hoop-fan-out` (hoop driven by >1 OUTPUT) =
  ERROR; `hoop-uncovered` = WARNING. `RoutingIssue.dataLineId` removed.
- **NEW `packages/core/src/model/chain-wiring.ts`** — the shared per-wire structural guard (use it in the client
  `onBeforeConnect`, don't re-implement): `classifyChainConnection(edges, candidate)` →
  `{ok:true} | {ok:false, code, message}`; codes `self | output-already-wired | hoop-has-upstream |
  source-has-downstream | cycle`. Exports `HoopRef` (1-based) for the web bridge to consolidate onto; `hoopKey`/`sourceKey`.
- `kit.nodeLayout?: Record<string,{x,y}>` optional/sparse — Trent's decision (A): patch-graph layout lives on the
  server Project / kit (one canonical arrangement, stable across shows, synced). Absent = valid; a node absent from the
  map gets a ONE-TIME deterministic seed, then frozen. No migrator transform needed.

---

## 1. UI-layer MAP — every web+server file referencing the old dataLine shape, and what it becomes

**Legend:** SRC = production code · TEST = test fixtures · direction of edges in the current graph is
`drum→hoop→dataline→output→controller` (data flowing TOWARD the controller).

| File | Kind | References | Becomes under the chain model |
|---|---|---|---|
| `apps/web/src/lib/app/patch-routing.ts` | SRC | `DataLineConfig` import; `PatchOutput.dataLines`; `DataLine` type; `patchToOutputs`/`outputsToPatch`/`pixelRanges.byDataLine` | Flatten `PatchRouting`: `PatchOutput = {id, startUniverse?, channelsPerPixel, rgbOrder?, hoops: HoopRef[]}` (drop `DataLine`). `patchToOutputs` = coalesce(hoops)→`segments` (1:1). `outputsToPatch` = expand `segments`→hoops (1:1). `pixelRanges` → `byOutput` only. Import core `HoopRef`. Keep `hasHoopFanOut`. **See §3 for the transitional alternative that keeps a green checkpoint.** |
| `apps/web/src/lib/app/patch-graph.ts` | SRC | `dataLineNodeId`, `buildOutputHalf` mints dataline nodes + `flowEdge(hoop→dataline)`; `routingFromGraph` orders by **byY** | Remove dataline node minting. **Ordering must FOLLOW THE WIRE CHAIN** (Output→Hoop→Hoop), not `byY` (the `yOf`/`byY` sort is the order source that MUST GO). **Edge direction FLIPS**: today hoop→output (toward controller); D1 = Output→Hoop→Hoop (output is the chain root/source — the real physical data path). This flip changes handle sides + guards. |
| `apps/web/src/lib/app/patch-topology.ts` | SRC | `PatchStage 'dataline'`, `dataLineId`, lane/stack AUTO-LAYOUT, `input`/`trigger`(input-half) stages | Drop `'dataline'` from `PatchStage`/`STAGE_ORDER`. **Remove auto-layout as the position source** (positions come from `kit.nodeLayout`, seeded once). Restructure to 3 zones + drum sub-zones (container nodes). Keep hoop/output/drum/trigger id grammar. |
| `apps/web/src/lib/app/views/PatchGraphView.svelte` | SRC | `.dataLines` (L337); guards `onBeforeConnect`/`wouldFanOut`/`dropConnect`/`onReconnect`; keeps input-half + drops topology output-half | Consume `classifyChainConnection` in `onBeforeConnect` (rich rejection feedback). Build 3 zone containers + nested drum sub-zones + hoop/output/trigger leaves. Direction-flip the wiring. Selection → zone/sub-zone/node inspectors. Persist drags → `kit.nodeLayout`. |
| `apps/web/src/lib/app/views/PatchNode.svelte` | SRC | `dataline` stage icon/handling | Drop `dataline` stage. Add zone/sub-zone node components (container look). Keep node-card look; handles flip source/target side for the new direction. |
| `apps/web/src/lib/app/docks/patch-inspector.ts` | SRC | `PatchEditor {kind:'dataline'}`, `orderedDataLines`, `parseHoopNodeId` etc. | Drop the `dataline` editor kind. Add Controller-zone + Kit-zone selection kinds. |
| `apps/web/src/lib/app/docks/Inspector.svelte` | SRC | dataline dispatch arm | Drop dataline arm; add controller-zone/kit-zone/drum-subzone arms (EMPTY inspector surfaces OK — C1–C6 fill content). |
| `apps/web/src/lib/app/docks/inspectors/PatchDataLineInspector.svelte` | SRC | whole component | **Delete** (or retire) — no dataline nodes in v2. |
| `apps/web/src/lib/app/shell-nav.ts` | SRC | `Selection` union (grep hit) | Add `{kind:'controller-zone'}` + `{kind:'kit-zone'}` (+ drum-subzone) to the `Selection` union. |
| `apps/web/src/lib/app/shell-store.svelte.ts` | SRC | patchRouting getter (grep hit) | Likely fine; `PatchRouting` type change flows through. Verify. |
| `apps/web/src/lib/app/patch-graph.test.ts` | TEST | `.dataLines` (L258,261,300,304,369) | Update to flat/segments shape. |
| `apps/web/src/lib/app/patch-routing.test.ts` | TEST | many `.dataLines` (round-trip asserts) | Update to flat model round-trip (hoops↔segments). |
| `apps/web/src/lib/app/patch-topology.test.ts` | TEST | `dataLineId`/`dataline` stage | Drop dataline assertions. |
| `apps/web/src/lib/app/docks/patch-inspector.test.ts` | TEST | dataline editor | Drop dataline-kind cases. |
| `apps/web/src/lib/trigger-lab/store.routing.test.ts` | TEST | `dataLines` fixtures (L56,143) | New shape. |
| `apps/web/src/lib/trigger-lab/store/project-resync.test.ts` | TEST | `dataLines` fixture (L24) | New shape. |
| `apps/server/src/handlers/client-message.ts` | SRC | grep hit (consumes `OutputConfig` abstractly — did NOT error) | Likely no change (uses `validateRouting`/`OutputConfig` opaquely). Verify. |
| `apps/server/src/handlers/client-message.test.ts` | TEST | `dataLines` fixtures (L549,577,586,626) | New shape (single line → segments; multi → split outputs, mirror the migrator). |
| `apps/server/src/output-manager.ts` / `.test.ts` | SRC/TEST | grep hit | SRC consumes `DmxMap` (unaffected); TEST fixtures may need the new shape. Verify. |
| `apps/server/src/voice-engine-host.test.ts` | TEST | `dataLines` fixtures (L203,234,254,288,292,293) | New shape. |
| `packages/protocol/src/schemas.test.ts` | TEST | `dataLines` literal (L34) | New `segments` shape (the `setKitOutputs` msg reuses core `outputSchema`, so SRC is automatic). |

---

## 2. xyflow nested-container research (CONFIRMED clean — no workaround)
`@xyflow/svelte@1.6.0` (types/math in peer `@xyflow/system@0.0.77`). **Nested parents (zone → sub-zone → leaf) work
cleanly — no depth limit.** Evidence: `adoptUserNodes`/`updateChildNode`/`calculateChildXYZ` resolve a child's absolute
position from its parent's already-computed `positionAbsolute` in a single array-order pass, so a node that is BOTH a
child and a parent resolves correctly; `extent:'parent'` clamps per-immediate-parent.
Canonical pattern:
1. **Emit `nodes` ancestors-first** (pre-order DFS) — a parent MUST precede its children or xyflow logs+skips
   positioning. Build the array from a tree flatten, not ad-hoc concat.
2. Child `position` is RELATIVE to its immediate parent; xyflow adds the parent origin.
3. **Containers need explicit `width`/`height`** (compute a bounding box) — leaves self-measure; containers don't auto-size
   (or use `expandParent`, which only grows on drag).
4. Custom node types for the 3 zones + drum sub-zones + leaves (not the bare built-in `group` type).
5. `parentId` + optional `extent:'parent'` on children. Dragging a parent moves its subtree automatically; z-banding is
   automatic (`ROOT_PARENT_Z_INCREMENT=10` per root parent). Deletion of a parent cascades to children.
Verdict: build REAL parent nodes for zones/sub-zones — a visual-only-background fallback is unnecessary and would forfeit
free drag-moves-children + z-banding.

---

## 3. CRITICAL ASSESSMENT — where is the first repo-green checkpoint?

**Finding that reframes the question:** the orchestrator's hypothesized checkpoint — *"server + web data-bridge + minimal
PatchGraphView with dataline nodes REMOVED, consuming segments"* — is **NOT a cheap intermediate.** Removing dataline
nodes and adopting `Output→Hoop→Hoop` requires **flipping the graph's edge direction** (today `hoop→dataline→output`,
data toward the controller; D1 = `output→hoop→hoop`, the real physical path). The flip rewrites handle sides,
`routingFromGraph`, `buildOutputHalf`, and all four guards — i.e. most of the graph-logic work. So "dataline nodes
removed" is coupled to the interaction rewrite; it is part of the big UI slice, not a small step before it.

**There IS a genuine first green checkpoint, but it KEEPS the current visual** (translate at the core boundary only):

### Checkpoint C1 — "data-bridge green" (repo-green + mergeable, current visual retained)
Change ONLY the two core-boundary functions in `patch-routing.ts` to translate the web's UNCHANGED `dataLine` graph
model to core's new `segments` shape, plus fix every test fixture. The graph keeps its current nodes/direction/guards.
- `patchToOutputs(webRouting) → OutputConfig[]`: split each web `DataLine` → one core Output (id = line id, cpp/rgbOrder
  from parent, `startUniverse` lifted per the migrator rule, `segments` = coalesce(line.hoops)).
- `outputsToPatch(OutputConfig[]) → webRouting`: each core Output → one web `PatchOutput` with a single `DataLine`
  (hoops = expand(segments)). Cold-load then shows N single-line outputs — valid, if not yet the D1 visual.
- Update all TEST fixtures (§1) + delete/keep `PatchDataLineInspector`.
- **Result: `pnpm typecheck && pnpm test && pnpm build` GREEN; mergeable into `patch-graph-v2`.** The core model + bridge
  land + merge, de-risked, with the dataline VISUAL still present (removed in C2).
- **Caveat:** ~20% of C1 is transitional scaffolding (the "keep dataline nodes" translation) that C2 deletes; ~80%
  (`patchToOutputs`/`outputsToPatch` to segments, all fixture updates) is permanent. Sizing: **M** (2 fns + ~10 test files).

### Checkpoint C2 — the actual D1 UI (the bulk; a coherent design effort)
Direction-flip + remove dataline/input-half nodes + 3 nested zones + drum sub-zones + wiring UX via
`classifyChainConnection` + greyed dotted trigger→drum wire + selection routing + EMPTY inspector surfaces +
`kit.nodeLayout` persistence (deterministic seed + drag write-back, server-synced) + ui-shot(4) + design-system + polish.
Sizing: **XL (multi-day).** This is where "dataline nodes removed" actually happens.

### Verdict
- **Two real repo-green checkpoints beyond the model commit: after C1 (bridge, current visual) and after C2 (UI).**
- The commonly-imagined "dataline nodes removed but old layout" middle state is a MIRAGE — it's inside C2 (needs the flip).
- **Recommendation:** land C1 as its own green merge (isolates + de-risks the model into the branch), then run C2 as a
  pure UI slice — ideally a FRESH context owns C2 (it's the bulk + one coherent design effort; this author has spent
  significant context on the model). If an intermediate merge with the old dataline visual is undesirable on the branch,
  fold C1 into C2 and accept one large slice with no green checkpoint until the whole UI lands.

---

## 4. Full remaining task list + rough sizing
| # | Task | Slice | Size |
|---|---|---|---|
| 1 | `patch-routing.ts` flat model / boundary translation to `segments` | C1 | S–M |
| 2 | Update all web+server+protocol TEST fixtures to new shape (§1) | C1 | M |
| 3 | Delete/retire `PatchDataLineInspector` + inspector dispatch arm | C1 | S |
| 4 | `patch-graph.ts`: follow-wire ordering (drop byY), remove dataline nodes, **flip edge direction** | C2 | L |
| 5 | `patch-topology.ts`: drop auto-layout as order/position source; 3-zone + sub-zone structure; id grammar | C2 | L |
| 6 | 3 holder zones + drum sub-zones as xyflow nested container nodes (ancestors-first, explicit sizing) | C2 | L |
| 7 | Node restructure: remove dataline/input-half; zone/sub-zone/hoop/output/trigger node components | C2 | M |
| 8 | Wiring UX: `onBeforeConnect` → `classifyChainConnection` rejection feedback; Output→Hoop / Hoop→Hoop only | C2 | M |
| 9 | Greyed dotted non-interactive Trigger→Drum reference wire | C2 | S |
| 10 | Selection routing: `shell-nav` `Selection` union (+controller-zone/kit-zone/drum-subzone); `patch-inspector`; EMPTY inspector surfaces | C2 | M |
| 11 | `kit.nodeLayout` persistence: deterministic one-time seed + drag write-back, server-synced (signature-guarded) | C2 | M |
| 12 | `pnpm ui-shot` (port 4300): 3-zone graph, drawn Output→Hoop→Hoop chain, rejected illegal wire, selected-node→inspector | C2 | S |
| 13 | design-system: any new reusable primitive added to styleguide + regenerated; `/make-interfaces-feel-better` polish | C2 | M |

**Escalation carry-overs:** node-layout home RESOLVED (server/kit, decision A — already `kit.nodeLayout`). Sketch-silent →
UI judgement; conflict with a documented spec decision → stop + ask. Trigger→drum non-interactivity + zone hit-areas → judgement.

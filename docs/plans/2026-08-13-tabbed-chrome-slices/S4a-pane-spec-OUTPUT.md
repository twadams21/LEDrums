# S4a — Settings parity inventory + pane spec (OUTPUT)

**Derived from code, 2026-08-13** (branch base `feat/tabbed-chrome`, ancestry incl. `10b1b46`).
Method: walked every mutator/affordance reachable from the live Patch surface — `AuthorShell`
view `patch` → `PatchGraphView.svelte` → `docks/Inspector.svelte` → the seven `Patch*` editors +
their shared components — and cross-checked each against the store's mutator bodies
(`trigger-lab/store.svelte.ts`). The plan's parity table was treated as a hypothesis; three of
its rows change here (see §1C and §5).

**Completion criterion (constitutional):** every mutator the old Patch surface can call is
either assigned a shipped home in a pane (§2) or explicitly listed as dying (§1B). Verified
below; counts in §6.

---

## 1. Inventory

The reachable Patch surface today:

- `views/PatchGraphView.svelte` (canvas: wiring, drag-layout, node select)
- `docks/Inspector.svelte` when `selection.kind === 'patch'`, dispatching to
  `docks/inspectors/PatchTriggerInspector | PatchDrumInspector | PatchHoopInspector |
  PatchKitInspector | PatchOutputInspector | PatchControllerInspector` (+ shared
  `DrumZonesList`, `RenameField`, `OutputStatusPanel` → `ControllerStatusPanel` →
  `AdoptByIpRow` / `UniverseRxTable`, `ReadRow`)

### 1A. Live mutators → homed

| # | Mutator (store) | Fields / gesture today | Call site | New home |
|---|---|---|---|---|
| 1 | `setRouting(outputs)` — chain rewire | drag-wire / reconnect / drop-on-node (`commitRouting` → `routingFromGraph` → `patchToOutputs`) | `PatchGraphView` | **Outputs & Chains** — per-output ordered hoop list (§2.3) |
| 2 | `setRouting(outputs)` — per-output transport scalars | `startUniverse` (blank = dense), `channelsPerPixel`, `rgbOrder` (blank = inherit) | `PatchOutputInspector.setOutputScalar` | **Outputs & Chains** — per-output card |
| 3 | `setHoopConfig(drumId, hoop, partial)` | `pixelCount`, `reverse` (1-based hoop index) | `PatchHoopInspector` | **Drums & Hoops** — per-hoop row |
| 4 | `identifyHoop(drumId, hoop)` | Identify flash button (drives hardware, editor-gated) | `PatchHoopInspector` | **Drums & Hoops** — per-hoop row flash button |
| 5 | `setDrumTransform(drumId, partial)` | `origin.{x,y,z}`, `rotation.{x,y,z}`, `color`, `startAngleDeg`, `localSpinDeg`, `hoopSpacingMm`, `diameterIn`, `flip` | `PatchDrumInspector` | **Drums & Hoops** — per-drum section |
| 6 | `setKitGlobal(partial)` — geometry defaults | `ledDensityPxPerM`, `hoopCount`, `defaultHoopSpacingMm` | `PatchKitInspector` | **Drums & Hoops** — Kit defaults section (placement note §5.1) |
| 7 | `setKitGlobal(partial)` — capacity/mode | `maxPixelsPerOutput` (`PatchKitInspector`), `expanded` (`PatchControllerInspector`) | as noted | **Controller** — kit-globals section |
| 8 | `setOutput(partial)` — controller transport | `protocol`, `host`, `port`, `iface` (NIC picker incl. manual-preserve), `fps`, `broadcast`, `priority` (sACN only) | `PatchControllerInspector` | **Controller** — transport form |
| 9 | `watchController(bool)` | watch-on-open / unwatch-on-close (`onMount` return) | `PatchControllerInspector` | **Controller** — pane mount lifecycle (§2.4) |
| 10 | `requestNetworkAdapters()` | on panel open (feeds iface picker + subnet recommendation) | `PatchControllerInspector` | **Controller** — pane mount |
| 11 | `discoverControllers()` | Discover button | `OutputStatusPanel` → `ControllerStatusPanel` | **Controller** — panel reused wholesale |
| 12 | `adoptController(host)` | candidate row / `AdoptByIpRow` | `ControllerStatusPanel` | **Controller** — panel reused wholesale |
| 13 | `setControllerAuth(password)` | admin-password input | `ControllerStatusPanel` | **Controller** — panel reused wholesale |
| 14 | `identifyController()` | Identify button | `ControllerStatusPanel` | **Controller** — panel reused wholesale |
| 15 | `setControllerTestData(pattern)` | test-pattern buttons | `ControllerStatusPanel` | **Controller** — panel reused wholesale |
| 16 | `backToLive()` | takeover-banner button | `ControllerStatusPanel` | **Controller** — panel reused wholesale |
| 17 | `setInputMap(map)` — zone wiring | add zone (`addDeclaredZone`), remove (`removeZone`), re-slot (`moveZoneSlot`), MIDI note (`setZoneMidiNote`), OSC address (`setZoneOscAddress`) — all pure helpers in `docks/patch-inspector.ts` | `PatchTriggerInspector` → `DrumZonesList` | **Input** — per-drum zone lists, `DrumZonesList` reused wholesale |
| 18 | `startMidiLearn({kind:'zone',…})` / `cancelMidiLearn()` | zone Learn button | `DrumZonesList` (and dead `PatchZoneInspector`) | **Input** — rides with `DrumZonesList` |
| 19 | `setPatchLabel(nodeId, label)` | rename field on every patch editor (`RenameField` → `forms.commitLabel`) | all seven editors | **split**: drum / hoop / output renames get pane homes (§2.2, §2.3); holder-node labels die (§1B, note §5.2) |

Read-only affordances with pane homes (escalation-trigger check — none left homeless):

| Read-out | Today | New home |
|---|---|---|
| Output/transport status, packets/s, last error | `OutputStatusPanel` | Controller pane (reused) |
| Adopted PixLite status, per-universe rx, health, candidates | `ControllerStatusPanel` + `UniverseRxTable` | Controller pane (reused) |
| Pixel Output Table (whole-kit uni/ch/px map) | `PatchOutputInspector` | Outputs & Chains (bottom of pane) |
| First/last global pixel span (per hoop, per output) | hoop + output inspectors (`hoopPixelSpan`, `pixelRanges`) | Drums & Hoops hoop rows; Outputs & Chains cards |
| Physical Port · Line (`physicalPortLine`, expanded-aware) | `PatchOutputInspector` | Outputs & Chains card header |
| Kit totals (drum count, total pixels) | `PatchKitInspector` | Drums & Hoops — Kit defaults section |
| Bound trigger graph per drum (`boundTriggerFor`) | `PatchDrumInspector` | Drums & Hoops — per-drum read-row |
| Zone last-heard activity badges (`inputBadge`), "also fires" cross-ref | `DrumZonesList` / zone editors | Input pane (rides with `DrumZonesList`) |
| MIDI-learn listening state | `DrumZonesList` | Input pane |

### 1B. Dying with the canvas (explicit)

| Mutator / affordance | Why it dies |
|---|---|
| `setNodeLayout(nodeLayout)` + `kit.nodeLayout` | Canvas drag layout. Schema field dropped outright — kit version bump, migrator strips the field (greenfield posture, no migration machinery). Pre-decided. |
| `shell.setPatchRouting()` / `shell.patchRouting` | Canvas→inspector live-routing plumbing. Panes read the authoritative `store.project.kit.outputs` directly (via `outputsToPatch`); no shell relay needed. S6 removes. |
| `shell.select({kind:'patch'})` / `patch` selection kind | Canvas node selection. Panes are self-contained; S6 removes the selection kind. |
| `store.reportError('patch-graph', …)` guard usage | xyflow callback-guard instrumentation (`flow-guard.ts`); `reportError` itself is global infrastructure and stays — only this call site dies. |
| `setPatchLabel` for `kit` / `controller` / `triggers` / `input` / `zone:*` ids | Display labels for canvas holder/ghost nodes that will no longer be rendered anywhere. Stored overrides for these keys become inert (harmless residue in `patchLabels`); no UI writes them post-S6. Note §5.2. |
| `?view=patch` | S2 maps it to opening the Settings modal. |

### 1C. Dead / orphaned code found during derivation (no parity obligation)

Discovered while re-deriving — these change the plan's table:

1. **`PatchZoneInspector.svelte` is unreachable.** The v2 zone graph (`patch-zones.buildZoneGraph`)
   mints no `zone:*` leaf nodes (only `buildPatchTopology` did, and it has no live caller), so a
   `zone` selection cannot occur. Its capabilities (zone MIDI note / OSC / learn) are a strict
   subset of `DrumZonesList`, which is homed (§1A #17–18). Dies in S6 as dead code.
2. **`PatchMirrorControl.svelte` is orphaned** (no importer) → `setKitMirror` / kit-global
   `mirror` is **not reachable from any mounted UI today**. The plan's table listed mirror as a
   live capability; it is not. Recommendation: home it anyway (one segmented control, trivial) —
   see §5.3 for placement.
3. **`PatchClipboardToolbar.svelte` is orphaned** (no importer) → `copyPatch()` /
   `setProjectPatch()` (patch copy/paste + `PatchDiffDialog`) are unreachable today. No parity
   obligation; recommend S6 deletes the toolbar + `PatchDiffDialog` with the rest. The store
   methods stay (used by tests; a future ticket may re-home patch copy/paste into Settings).

Undo note: every homed mutator already routes through `pushUndoSnapshot()` inside the store;
panes call the same mutators, so undo/redo behaviour carries over with zero pane work.

---

## 2. Pane map

Settings modal = S2's sectioned shell (left section list, content pane), deep-linked
`?settings=<pane>`. Pane keys: `input` · `drums` · `outputs` · `controller` · `system`.
The five pane component files (S2 stubs, one slice fills each):

```
apps/web/src/lib/app/settings/panes/InputPane.svelte          (S4e)
apps/web/src/lib/app/settings/panes/DrumsHoopsPane.svelte     (S4b)
apps/web/src/lib/app/settings/panes/OutputsChainsPane.svelte  (S4c)
apps/web/src/lib/app/settings/panes/ControllerPane.svelte     (S4d)
apps/web/src/lib/app/settings/panes/SystemPane.svelte         (S4e)
```

Shared conventions (all panes):

- Read the authoritative `store.project` (`kit`, `inputMap`, `output`); offline (`project ===
  null`) disables controls exactly as the inspectors do today (`disabled={!project}` +
  viewer-gating already inside every store mutator). Reuse the Inspector's read-only-viewer
  treatment: wrap pane content in `<fieldset disabled={!store.canEdit}>`.
- Compose from existing primitives: `Field`, `CommitInput` (+ `forms.onNum`), `Select`,
  `Toggle`, `ColorSwatch`, `ReadRow`, `Eyebrow`, `Separator`, `IconButton`, `StatusPill`.
- Node-id grammar + rename plumbing survive: `drum:<id>` (`patch-zones.drumZoneId`),
  `hoop:<drumId>:<n>` (`patch-graph.hoopNodeId`), `output:<id>` (`patch-graph.outputNodeId`),
  with `forms.patchLabel` / `forms.commitLabel` → `store.setPatchLabel`. S6 must relocate these
  tiny helpers (id minting + parse) into a small module (suggest
  `apps/web/src/lib/app/settings/patch-ids.ts`) when it deletes the canvas modules — until
  then panes import from `../patch-graph` / `../patch-zones`.
- `patch-routing.ts` (`outputsToPatch`, `patchToOutputs`, `pixelRanges`) and
  `docks/patch-inspector.ts` (pure read-out + input-map helpers) are NOT canvas modules and
  survive S6.

### 2.1 Input pane (S4e) — everything that fires the rig

Sections, top to bottom:

1. **MIDI input** — moved from `AppSettingsDialog`: MIDI channel `Select`
   (`store.setMidiChannel` → `setInputMap`), MIDI devices read-only list
   (`store.midiDevices`, `deviceListEmptyState`).
2. **OSC input** — `chrome/OscInputPanel.svelte` reused wholesale (listen status + fault
   callout + OSC learn affordances it already owns).
3. **Global controls** — `chrome/GlobalControlsPanel.svelte` reused wholesale
   (`setGlobalControlBinding`, `startMidiLearn`/`startOscLearn`/`cancelOscLearn`, badges).
4. **Drum zones** — one subsection per drum (`store.drums` order, drum label as header):
   `docks/inspectors/DrumZonesList.svelte` reused wholesale with `drumId` fixed. Covers add /
   remove / re-slot zone, MIDI note + Learn, OSC address, last-heard badges (§1A #17–18).
   `DrumZonesList` stays at its current path — `TriggerSourceInspector` (Trigger Graph drawer,
   out of scope) imports it too.

Layout sketch: single scrolling column; sections separated by `Separator` with `Eyebrow`
headers; drum-zone subsections as cards matching `DrumZonesList`'s existing `.zone` card idiom.

Validation: unchanged — `setInputMap` is the single gate (binding-claims refusal is total, §
store doc); panes need no extra rules.

### 2.2 Drums & Hoops pane (S4b) — kit geometry

Sections:

1. **Kit defaults** — `ledDensityPxPerM`, `hoopCount` (hoops/drum), `defaultHoopSpacingMm`
   (all `setKitGlobal`, §1A #6) + read-rows: drum count, total kit pixels
   (`totalKitPixelCount`). Same fields/hints as `PatchKitInspector` today.
2. **Per drum** — one collapsible section per drum, header = drum name with inline rename
   (`RenameField` idiom on id `drum:<id>`, fallback = derived label):
   - Geometry grid: Origin x/y/z (mm), Rotation x/y/z (deg) — the `PatchDrumInspector`
     3-axis `CommitInput` groups, via `setDrumTransform` partials.
   - Colour swatch (`ColorSwatch`, `hexToHsv`/`hsvToHex` round-trip), Starting angle, Spin,
     Hoop spacing (mm), Diameter (in), Flip toggle — all `setDrumTransform` (§1A #5).
   - Read-row: Bound trigger (`boundTriggerFor` + `store.graphLabel`).
   - **Hoop rows** — one row per hoop (1-based, count from `drum.hoops?.length ??
     drum.hoopCount ?? kit.global.hoopCount`): name (rename on `hoop:<drumId>:<n>`), pixel
     count (`setHoopConfig … pixelCount`), Reverse toggle (`setHoopConfig … reverse`),
     Identify flash button (`identifyHoop`, `canEdit`-gated), first/last-pixel `ReadRow`
     (`hoopPixelSpan` over `outputsToPatch(kit.outputs)`; "unrouted" hint when null).

Layout sketch: kit defaults as a plain field stack; drums as cards; hoop rows as a compact
grid (name · px · reverse · identify · span) inside each drum card.

Validation: numeric commits via `forms.onNum` (unchanged); store + server backstop as today.

### 2.3 Outputs & Chains pane (S4c) — routing without the canvas

Decided model (Trent, 2026-08-13): per-output ordered list, drag-reorder + move-up/down
buttons, "add hoop" picker fed by an **unassigned-hoops pool**, remove returns to pool.
Unwired hoops allowed (matches core: `hoop-uncovered` is `warning` severity — "indicators,
not restrictions").

Structure:

1. **Output cards, transmit order** — one card per `kit.outputs` entry (output count is fixed
   by expanded mode — 8 logical or 4 — same as the canvas; no add/remove-output affordance):
   - Header: output name (rename on `output:<id>`) · Physical `Port n · Line m` badge
     (`physicalPortLine(index, expanded)`).
   - Transport scalars (§1A #2): Start universe (`CommitInput`, blank = dense/auto →
     `startUniverse: undefined`), Channels/pixel (1–4), RGB order (`Select` with explicit
     "Inherit (controller)" sentinel → `rgbOrder: undefined`). Written as today: map over
     `kit.outputs`, patch the one output, `store.setRouting(outputs)`.
   - **Chain list**: ordered hoop rows (label = hoop display name + drum), drag handle +
     move-up/down `IconButton`s, remove (returns hoop to pool). "Add hoop" row opens a picker
     listing only pool hoops (so fan-out is impossible by construction — a hoop is in at most
     one chain, mirroring the canvas' `classifyChainConnection` single-upstream rule).
   - Read-rows: First/last pixel + pixels-on-this-run (`pixelRanges`).
2. **Unassigned pool** — chips of every kit hoop in no chain, with a subtle warning tone
   ("will stay dark"), matching the `hoop-uncovered` indicator language.
3. **Pixel output map** — the whole-kit table (`buildPixelOutputTable`: # · Uni · Ch · Px,
   device-facing 1-based), moved from `PatchOutputInspector` verbatim.

Mutation path: pane state is a `PatchRouting` derived from `outputsToPatch(kit.outputs)`;
every edit produces the next routing via pure reducers (new `chain-editor.ts`, §4), compiles
through `patchToOutputs`, is checked by **core's routing-validation seam** —
`checkRoutingIntegrity` / `blockingRoutingIssues` (`packages/core/src/model/routing-integrity.ts`)
— then committed via `store.setRouting`. Errors block the commit with the issue message
(toast, as the canvas does); warnings render as the pool indicators. Server backstop
(`setKitOutputs` gate) unchanged.

### 2.4 Controller pane (S4d) — the box and its transport

Sections:

1. **Status** — `OutputStatusPanel` (which composes `ControllerStatusPanel` →
   `AdoptByIpRow` + `UniverseRxTable`) reused **wholesale from their current paths**
   (`docks/inspectors/`), with the exact prop wiring `PatchControllerInspector` has today
   (all ops §1A #11–16). Files do not move (styleguide + `controller-monitor` reference them).
2. **Transport** — Protocol, Host/IP, Port, Interface (NIC options + "Default (auto)"
   sentinel + manual-preserve), FPS, Broadcast/Multicast toggle, sACN Priority (conditional)
   — the `PatchControllerInspector` form verbatim (§1A #8).
3. **Kit globals** — Expanded-output-mode toggle (`setKitGlobal {expanded}`), Max px/output
   (`setKitGlobal {maxPixelsPerOutput}`) (§1A #7). Mirror placement pending §5.3.

**Lifecycle (must-keep):** `watchController(true)` + `requestNetworkAdapters()` on pane
mount, `watchController(false)` on unmount — exactly today's `onMount`/cleanup pair. This
requires the S2 modal to render **only the active pane** (mount/unmount on section switch and
on modal close), so an open Controller pane is the only thing gating the server's poll loop.
If S2's shell keeps inactive panes mounted, this is a defect against this spec.

### 2.5 System pane (S4e) — the app itself

1. **Updates** — `chrome/UpdateControl.svelte` reused (moved from `AppSettingsDialog`).
2. **Backups** — an entry row/button opening the existing `chrome/BackupsDialog.svelte`
   (`refreshBackups` / `restoreBackup` stay on the dialog). The top-bar Backups affordance
   (plan, decided open question 2) is unaffected; this is the discoverable second door.

No new mutators; this pane is a re-homing of existing chrome content.

---

## 3. Chain-editing semantics — pool model vs current routing (evidence)

Checked against core (escalation trigger "pool model conflicts with routing semantics"):
**no conflict.**

- Single-upstream: `classifyChainConnection` (`packages/core/src/model/chain-wiring.ts`)
  rejects a hoop with two upstreams (`hoop-fan-out` is an `error` in `checkRoutingIntegrity`).
  The pool model makes this state unrepresentable — strictly safer than the canvas, which
  could only reject it at wire time.
- Unwired hoops: `hoop-uncovered` is `severity: 'warning'` — server accepts, editor
  indicates. The pool section IS that indicator.
- Ordering: `OutputConfig.segments` round-trips through `outputsToPatch`/`patchToOutputs`
  losslessly for list reorders (same functions the canvas commit path uses today).

---

## 4. S4b–e file fence (provably disjoint)

Each slice touches: its own pane file(s), its own new files, plus **one import line** in the
S2 modal registry. Nothing else overlaps. All new files live under
`apps/web/src/lib/app/settings/panes/`.

| Slice | Edits (pane stubs) | Creates (only this slice may create these) |
|---|---|---|
| **S4b** | `DrumsHoopsPane.svelte` | `DrumSection.svelte`, `HoopRow.svelte`, `drums-hoops.ts`, `drums-hoops.test.ts` |
| **S4c** | `OutputsChainsPane.svelte` | `OutputChainCard.svelte`, `AddHoopPicker.svelte`, `UnassignedPool.svelte`, `chain-editor.ts`, `chain-editor.test.ts` |
| **S4d** | `ControllerPane.svelte` | *(none — composes reused panels + inline form; the pane file suffices)* |
| **S4e** | `InputPane.svelte`, `SystemPane.svelte` | `DrumZonesSection.svelte` (per-drum wrapper; optional — may stay inline) |

Reuse-in-place (imported, never moved, by the slices noted): `DrumZonesList` (S4e),
`OutputStatusPanel`/`ControllerStatusPanel`/`AdoptByIpRow`/`UniverseRxTable` (S4d),
`ReadRow`/`RenameField`/`forms.ts`/`patch-inspector.ts` (S4b–e), `OscInputPanel`/
`GlobalControlsPanel`/`UpdateControl`/`BackupsDialog` (S4e), `patch-routing.ts` +
routing-integrity/chain-wiring from core (S4c).

Pure-logic test obligations (run in the sweep): `chain-editor.ts` reducers (move/add/remove/
reorder, pool derivation, validation gating) and `drums-hoops.ts` helpers get unit tests in
lockstep; `patch-inspector.ts` helpers are already covered.

Styleguide: the ordered-list chain editor (list + pool) is the one genuinely reusable new
composite — S4c adds its styleguide entry (`apps/web/src/lib/styleguide/`); the other panes
compose existing entries.

---

## 5. For Trent at the gate (sign-off items — recommendations, not guesses)

1. **Kit geometry defaults placement.** The plan's table only routed `expanded` /
   `maxPixelsPerOutput` / `mirror` (→ Controller). The code has three more kit globals
   (`ledDensityPxPerM`, `hoopCount`, `defaultHoopSpacingMm`, edited in `PatchKitInspector`).
   This spec puts those three in **Drums & Hoops → Kit defaults** (they're geometry, next to
   the per-drum geometry they default) and keeps capacity/mode (`expanded`,
   `maxPixelsPerOutput`) in **Controller** per the plan.
2. **Renames.** Kept where a name is still displayed: drums, hoops, outputs. Holder-node
   labels (`kit`, `controller`, `triggers`, `input`, `zone:*`) die with the canvas — nothing
   renders them post-S6. (Stored overrides remain inert in `patchLabels`; no cleanup
   machinery, greenfield posture.)
3. **Mirror.** `setKitMirror` is unreachable today (orphaned `PatchMirrorControl`, §1C.2).
   Recommendation: revive it as a three-way segmented control (none/x/y). Plan says Controller
   pane; geometry argues Drums & Hoops → Kit defaults. **Default if unflagged: Controller
   pane kit-globals section (follows the plan).** S4d implements wherever this lands.
4. **Patch copy/paste.** Orphaned (§1C.3) — proposed: no pane home, S6 deletes the toolbar +
   `PatchDiffDialog`; store methods retained for a future "export/import rig" ticket.

---

## 6. Counts (completion criterion)

- **Inventoried:** 19 mutator rows (§1A) + 6 dying entries (§1B) + 3 orphans (§1C).
- **Homed:** 18 store mutators — `setRouting` (wiring + scalars), `setHoopConfig`,
  `identifyHoop`, `setDrumTransform`, `setKitGlobal`, `setOutput`, `setInputMap`,
  `startMidiLearn`, `cancelMidiLearn`, `watchController`, `requestNetworkAdapters`,
  `discoverControllers`, `adoptController`, `setControllerAuth`, `identifyController`,
  `setControllerTestData`, `backToLive`, `setPatchLabel` (drum/hoop/output keys).
- **Dying (explicit):** `setNodeLayout` (+ `kit.nodeLayout` schema field), the canvas-only
  shell wiring (`setPatchRouting`, `patch` selection kind, flow-guard `reportError` call
  site), holder-key `setPatchLabel` writes, `?view=patch` (redirects to Settings).
- **Unreachable today (no obligation, dispositions in §5):** `setKitMirror`, `copyPatch`,
  `setProjectPatch`.
- **Read-only affordances:** all 9 have pane homes (§1A table 2) — no homeless status view.

Every mutator callable from the old Patch surface appears above exactly once. ∎

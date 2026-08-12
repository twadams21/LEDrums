# Tabbed chrome + settings-based patch — implementation plan

**Decision (Trent, 2026-08-13, via `?proto=chrome` prototype on branch `proto/chrome-tabbed-layout`):**
adopt **variant C** — tabbed chrome, Patch Graph removed, the whole patch expressed as Settings —
plus the **DM Sans** font switch. Approval is conditional on **settings parity**: everything
settable in the app today must remain settable. Trent's stated deltas from the prototype:

- The **Share button stays in the top nav bar** (not the bottom status cluster).
- The **Project menu returns** (ShowBrowser: new/open/save/save-as/rename/delete — the prototype dropped it).
- The **Kit preview (Visualizer)** and **Buses/Layers pane** need homes (absent in the prototype).

This is a plan, not a spec. Each slice gets its own brief at dispatch time (`/slicing-work`).

## Target layout

Rows: ① nav bar (brand · view tabs · show identity + project menu · Share · Settings gear) ·
② setlist songs bar · ③ sections bar · ④ full-width workspace · ⑤ bottom bar (Transport ·
status cluster). Views: Perform · Objects · Sections · Trigger Graph · Monitor — **no Patch tab**.
Trigger Graph hosts the Graphs list as a left pane (prototype's `ProtoGraphsRail`), Node Editor
drawer unchanged on the right.

## Open questions (Trent decides before the affected slice dispatches)

1. **Visualizer + Buses/Layers home.** Recommendation: a **collapsible right dock**
   (Visualizer pinned top, Buses/Layers below — today's `col2` made collapsible), expand state
   persisted per view in `paneSizes`. Collapsed = the full-width payoff; expanded = today's
   behaviour. Alternatives if the dock feels wrong: (b) Visualizer only in Perform + Buses as a
   Trigger-view drawer; (c) keep a permanent right column (loses the width win).
2. **Bottom-bar allocation.** Proposal: bottom = Transport · StatusBar · OutputPill ·
   presence/takeover; top-right = show name + SaveIndicator + project menu + **Share** + Backups +
   UpdateBadge + Settings gear. Confirm or re-deal.
3. **Chain-editing UX in Settings** (S4c): per-output ordered list with drag-reorder +
   move-up/down buttons, "add hoop" picker fed by an **unassigned-hoops pool**, remove returns to
   pool. Confirm the pool model (vs. move-only between outputs, no unassigned state — today's
   graph allows unwired hoops, so the pool matches current semantics).

## Parity contract (rewrite-parity: the old surface may not die until every row has a new home)

Inventory of every mutator/affordance reachable from the Patch surface today
(`PatchGraphView` + patch inspectors), with its destination:

| Capability (mutator) | Today | New home |
| --- | --- | --- |
| Rewire hoop chains (`setRouting`) | canvas drag-wiring | Settings → Outputs & Chains (S4c) |
| Output transport scalars: startUniverse, rgbOrder, channelsPerPixel (`setRouting` via `PatchOutputInspector`) | output inspector | Outputs & Chains, per-output row |
| Per-hoop pixelCount + reverse (`setHoopConfig`) | hoop inspector | Drums & Hoops (S4b) |
| Identify hoop on the rig (`identifyHoop`) | hoop inspector | Drums & Hoops, per-hoop flash button |
| Drum transform (`setDrumTransform`) | drum inspector | Drums & Hoops, per-drum section |
| Kit globals: expanded, maxPixelsPerOutput, mirror (`setKitGlobal`) | kit + controller inspectors | Controller pane (S4d) |
| Controller transport: protocol/host/port/fps/iface/broadcast/priority (`setOutput`) | controller inspector | Controller pane |
| Controller ops: discover/adopt/identify/auth/test-pattern/back-to-live, NIC enumeration, status watch (`discoverControllers`, `adoptController`, `identifyController`, `setControllerAuth`, `setControllerTestData`, `backToLive`, `requestNetworkAdapters`, `watchController`) | controller inspector panels (`ControllerStatusPanel`, `OutputStatusPanel`, `UniverseRxTable`, `AdoptByIpRow`) | Controller pane — **reuse these components wholesale**; keep the watch-on-open/unwatch-on-close lifecycle |
| Zone input mapping + MIDI learn (`setInputMap`, `startMidiLearn`, `cancelMidiLearn`, `inputBadge` via `DrumZonesList` / `PatchZoneInspector`) | zone/trigger inspectors | Input pane (S4e) — per-drum zone list with learn buttons |
| Node/label renames (`RenameField` on patch nodes) | inspectors | inventory task S4a confirms the mutator + places it (likely Drums & Hoops / Outputs rows) |
| Canvas node layout (`setNodeLayout`, `kit.nodeLayout`) | canvas drag | **dies with the canvas** — drop the schema field outright (greenfield posture, no migration machinery; bump kit version, migrator strips the field) |

S4a's completion criterion: **every mutator the old surface can call is either in this table with
a shipped home or explicitly listed as dying** — re-derived from the code at dispatch time, not
from this table.

## Slices

Sequenced for one PR each into `main`; ≤3 in flight (seam gate: S2 owns the shell files, S4x own
Settings files, so S3 ∥ S4b/c/d after their parents).

- **S1 — DM Sans (tiny, ships first).** Cherry-pick the branch's font commit: fontsource dep,
  `--font-sans`, drop the Geist fallback comment or keep Geist installed (decide in PR).
  `pnpm design-system` regenerate + DESIGN.md token update in the same change.
- **S2 — Tabbed shell.** Rebuild `AuthorShell` layout from the prototype's `ProtoShell` (rewrite
  properly — prototype code skipped tests): 3 header bars, bottom bar per open-question 2,
  ShowBrowser + Share + presence restored. `shell-nav`: drop `'patch'` from `View` (map
  `?view=patch` → open Settings), update `VIEWS`, shot-seam `view:` op, ui-shot presets, unit
  tests. Delete `LeftRail`; `SongRail` stays for Objects/library use or dies if unreferenced.
- **S3 — Trigger tab left rail.** `GraphsDock` cards → left pane (prototype `ProtoGraphsRail`
  rewritten, resizable via `Splitter` + `paneSizes`), bottom dock removed from `TriggerGraphView`.
  Hotkey badges + fire-flash kept (the flash was dropped in the prototype — restore it).
- **S4 — Settings parity (the initiative's spine; sub-slices, serial except where file-disjoint):**
  - **S4a — inventory + pane spec.** Re-derive the parity table from code; write the pane map
    (Input · Drums & Hoops · Outputs & Chains · Controller · System) with every control named.
    Gate: Trent signs the pane spec (product taste on chain-editing UX, open question 3).
  - **S4b — Drums & Hoops pane** (`setHoopConfig`, `identifyHoop`, `setDrumTransform`, renames).
  - **S4c — Outputs & Chains pane** (`setRouting` list editor + transport scalars). Validation
    rides the existing core routing-validation seam; server backstop unchanged.
  - **S4d — Controller pane** (transport, kit globals, status/adopt/test panels — component reuse).
  - **S4e — Input pane** (existing MIDI/OSC settings + zone mapping/MIDI-learn) + System pane
    (Updates, Backups entry).
  - Settings becomes a large sectioned modal (prototype's shell) with deep-links
    (`?settings=<pane>`) replacing `?view=patch`.
- **S5 — Visualizer + Buses/Layers home** per open question 1.
- **S6 — Patch Graph removal.** Only after S4b–e are merged and Trent has driven the rig through
  Settings once (wired-end-to-end check on real hardware). Delete `PatchGraphView`, patch
  topology/zones/flow modules, patch inspectors folded into panes, `kit.nodeLayout` schema drop,
  `patch` selection kind, dead tests. Update `.mex` context + AGENTS/product docs.
- **S7 — Prototype teardown.** Delete `apps/web/src/lib/app/proto-chrome/` + the `?proto=chrome`
  mount; fold the NOTES.md verdict into this plan's header; `tailscale serve` off.

Every slice: committed-HEAD green AND pushed, `pnpm ui-shot` captures of the touched surface,
design-system entry updated for any new reusable composite (tab bar, chip bar, settings shell).

## Out of scope

- Reworking Perform/Objects/Sections internals (they re-host unchanged).
- Trigger-graph editing model (Node Editor drawer unchanged).
- Any engine/protocol change — parity is a UI re-homing; `setRouting`/`setOutput` semantics are
  untouched.

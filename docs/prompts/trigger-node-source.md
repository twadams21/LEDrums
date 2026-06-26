# Mission — make the Trigger node the authoritative input binding (Trigger Source: Drum / MIDI / OSC)

Spec captured 2026-06-26 with Trent. Intended to be handed to the **Patch-graph-authoritative orch
agent** to decompose + drive — because it consumes that initiative's input/device model. This file is
the *mission*; the orch self-serves its operating manual from its `/twux orch` role doc.

## Goal

The **trigger node** (the root of every trigger graph) becomes an **editable node** whose Inspector
declares *what input fires this graph* — its **Trigger Source**. Today it is a passive read-only
`drum · zone` label, and graphs are bound to inputs only implicitly (keyed by padKey `drumId:zone`).
Make the binding **explicit and editable**, so:
- pad-bound graphs declare their **drum + zone** source (what they already are, made explicit), and
- **authored** graphs (`graph:<n>`, created via `createGraph`) can be fired **directly by raw MIDI or
  OSC** — e.g. an external keyboard / Ableton / sequencer — without a physical drum zone.

## ⚠️ Dependency — read the Patch-graph-authoritative mission first

`docs/prompts/patch-graph-authoritative.md` + memory `patch-graph-authoritative-intent`. That
initiative owns the **input/device model**; this one **consumes** it. Specifically:
- **Zones carry their hardware mapping** — the MIDI note / OSC address that fires them
  (`inputMap.midiNotes` / `oscMap`, keyed by `(drumId, slot)`), edited via the patch **Zone** inspector
  → `setInputMap`. (Per the patch mission's per-node Inspector spec.)
- **MIDI channel** and **OSC namespace/host** live at the **device/controller** level in the patch
  graph — **NOT per trigger node**.

So **do not build the device/channel/zone-mapping layer here** — it's the patch initiative's. The
trigger node *references* it. **Sequence this after** patch-authoritative lands its input model
(its S1 core seam + S4 zone/controller inspectors), or coordinate the shared seam explicitly.

## The Trigger Source model

The trigger node gains a tagged `source`:

- **`drum`** — `{ drumId, zone }`. Fires when that physical drum-zone triggers (Sensory Percussion).
  Inherits the zone's patch-defined hardware mapping (its MIDI note / OSC addr + channel). This is the
  **existing padKey binding made explicit** — for a pad-bound graph the source *is* the pad's drum+zone.
- **`midi`** — a MIDI **note** number OR a **CC** number (one or the other). The **channel comes from
  the patch device**, not here. For inputs not mapped to a drum zone (authored graphs).
- **`osc`** — `{ address }` (e.g. `/kick`). The OSC message that fires it; **host/namespace from the
  patch device**. Authored graphs.

**Value:** every source yields a normalized **0–1 value** — drum velocity / MIDI note-velocity or
CC÷127 / OSC arg — which is exactly what the switch **`value`** mode (gate/bands, already built)
routes on. Keep this normalization in one place so all three sources feed the switch identically.

## Reconcile with the patch input-map (important — keep ONE routing model)

There must be a single coherent resolution, not two competing ones:
- A physical hit arrives as MIDI/OSC. The **patch input-map** (zone → note/addr) resolves it to a
  `(drumId, zone)` → that fires the **pad-bound** graph (`drum` source). This is today's padKey routing,
  now backed by the patch's authoritative zone map.
- A **raw** MIDI note / OSC address that is **not** a zone mapping resolves directly to the **authored**
  graph whose trigger declares that `midi`/`osc` source.

So `drum` source ≈ "which pad/zone am I bound to" (existing); `midi`/`osc` source = the **new** direct
bindings. The router checks zone-maps first, then direct trigger-source bindings. The orch should pin
this precedence + the no-double-fire rule during planning.

## Per-node Inspector spec (Trigger node)

| Field | UI | Notes |
|---|---|---|
| **Trigger Source** | segmented: Drum / MIDI / OSC | mode selector |
| (drum) drum | Select — kit drums | |
| (drum) zone | Select — that drum's zones | zone's HW mapping is owned by the patch graph |
| (midi) note / CC | toggle note↔CC + number 0–127 | channel = patch device (show as read-only hint) |
| (osc) address | text field (`/kick`) | namespace/host = patch device (read-only hint) |
| **rename** | label override | (editable-node parity with the patch nodes) |

Nodes stay **display-only**; all editing is in the Inspector (the established pattern from the xyflow
unification). The node card shows the resolved source as its sub line (e.g. `kick · center`,
`MIDI note 38`, `OSC /kick`).

## Model / routing impact (where the work lands)

- **web** `apps/web/src/lib/trigger-lab/sim.ts` — trigger `source` on the trigger node + value
  normalization; back-compat default = `drum` derived from the graph's padKey. Store mutators +
  Inspector. (`store.svelte.ts`, `Inspector.svelte`, `TriggerNode.svelte` for the sub line.)
- **core** `packages/core/src/voice/{types.ts,engine.ts}` — mirror the trigger `source` (structurally
  identical to web), and resolve a graph by its trigger source.
- **server** `apps/server/src/input-router.ts` — resolve incoming drum / MIDI / OSC events → the
  matching graph(s): zone-map first (→ pad graph), then direct `midi`/`osc` trigger bindings.
- **back-compat**: every existing trigger node defaults to a `drum` source from its padKey; no authored
  graph has a MIDI/OSC binding until the user sets one.

## Locked decisions (from this thread)

- Channel / OSC namespace = **patch graph (device-level)**, never per trigger node.
- **Drum** mode inherits the zone's patch mapping; **MIDI/OSC** modes are for non-drum inputs.
- Trigger value **normalizes to 0–1** and feeds the switch `value` routing.
- Nodes display-only; editing in the Inspector.

## Suggested slices (orch to refine — `T1 → {T2 ∥ T3} → T4`)

- **T1 — model + back-compat.** Trigger `source` union on web sim `GraphNode` + core `voice` types
  (kept structurally identical); default `drum` from padKey; value normalization seam; store mutators;
  unit tests (web + core).
- **T2 — Inspector editor.** Trigger-node source UI (mode + per-mode fields), reading the patch
  zone/device data for the drum-zone lists + channel/namespace read-only hints. Node sub-line shows the
  source.
- **T3 — input routing.** web sim + core engine resolve a graph from its trigger source; server
  `input-router` resolves drum/MIDI/OSC events → matching graphs (zone-map precedence, no double-fire).
  Tests.
- **T4 — payoff.** Author a graph, bind it to a raw MIDI note / OSC address, fire it from an external
  source end-to-end through the engine.

## Constraints / discipline

- Branch **`feat/unified-shell`** (no merge to main without Trent). **`packages/core` stays pure.**
  One task = one agent, **disjoint files**. Svelte MCP / `svelte:svelte-file-editor` for `.svelte`.
  Gate the touched package during work; full `pnpm typecheck && pnpm test` only on a committed clean
  tree. Run **GROW** after (update `.mex/ROUTER.md`, bump `last_updated`).

## Related (NOT part of this mission)

- **Fold `velocity` into `value` on the switch node** (agreed) — `velocity` and `value` are
  near-duplicates; deprecate `velocity`, migrating existing `on:'velocity'` switches to `on:'value'`
  (gate/bands). This is a **switch-node** change (separate from the trigger node) and must run **after**
  the in-flight `value-core-eval` slice, since both touch `SwitchOn` / `sim.ts` / `engine.ts`. Tracked
  separately by the main orchestrator.

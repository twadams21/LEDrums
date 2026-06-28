# Mission — make the Patch Graph authoritative

Locked with Trent on 2026-06-26. The earlier file (`trigger-graph-authoritative.md`) was a **misnomer** — the goal is the **Patch graph**, not the trigger graph. See memory `patch-graph-authoritative-intent`.

## Goal
When you rewire the Patch graph (`input → trigger → zone → drum → hoop → dataline → output → controller`) it must **change real device behaviour**, and **every node becomes the editor of the real setting it represents**. The Patch graph becomes the authoritative editor of kit geometry + IO config. Today it is an ephemeral `$state.raw` surface (`PatchGraphView.svelte:16`) that never reaches the server and the active store discards the server `Project` entirely (`store.svelte.ts:427 onState: (_project, …)`).

## How routing actually works (Trent's model — confirmed against core)
- A controller (Advatek **PixLite**) receives Art-Net/sACN and has **4 outputs**. The controller owns universe/channel offsets, so **our app does not manage universes** — it authors **the order hoops enter the pixel stream**.
- Chain is **output → dataline → hoop**. Transmit order = first hoop on the first dataline on the first output → next hoop on that dataline → next dataline → next output. This maps 1:1 to core `OutputConfig.segments[]` (an *ordered run of hoop segments* per physical output, `kit-schema.ts`) → `buildDmxMap` → `UniversePatch.pixelIds` (transmit order). Rewiring = reordering `segments`.

## Per-node Inspector spec
| Node | Inspector | Backing |
|---|---|---|
| **Zone** (per drum·zone) | MIDI note / OSC address that fires it | `inputMap.midiNotes/oscMap` (drumId, slot) → `setInputMap` |
| **Drum** | position (`origin`), rotation, **starting angle** (`startAngleDeg`, all 4 hoops), spin (`localSpinDeg`), **literal pixel count per hoop** | `drumSchema` → `setKitTransform` |
| **Hoop** | pixel count; **first/last pixel** index (read-out) | geometry |
| **Data line** | universe + **first/last pixel** (read-out); order | derived from dmxMap |
| **Output** (×4) | `startUniverse`, `channelsPerPixel`; first/last pixel (read-out) | `OutputConfig` → `setKitOutputs` (new) |
| **Controller** | Art-Net/sACN: protocol · host/IP · broadcast/multicast · RGB order · fps (+ standard fields) | `project.output` → `setOutput` |
| **(editable nodes)** | rename | label-override |

## Locked decisions
- **Server `Project` is the source of truth** for routing/geometry/input/transport. The web adopts it from the `state` message (today discarded) and edits via WS.
- **Hoops take a literal pixel count** (`pixelsPerHoop`), NOT density-driven.
- **MIDI/OSC input lives on zone nodes** (core keys input by `(drumId, slot)`).
- **Universes are controller-handled**; the app authors pixel order. The only per-output universe knob is `startUniverse`.
- Controller node carries the standard Art-Net/sACN transport fields.

## Slices — `S1 ∥ S2 → S3 → S4`
- **S1** `docs/prompts/s1-patch-core-seam.md` — core schema (`pixelsPerHoop` literal) + make the **voice host** runtime-mutable (live kit reload, `setKitOutputs`, route mutations to the active host).
- **S2** `docs/prompts/s2-patch-routing-compiler.md` — pure compiler: `PatchRouting ⇄ OutputConfig[]` (order-preserving) + first/last-pixel derivation. Unit-tested.
- **S3** `docs/prompts/s3-patch-store-authoritative.md` — store adopts the `Project`; patch output-half derives from `kit.outputs`; rewire → recompile → send.
- **S4** `docs/prompts/s4-patch-inspector-settings.md` — the Inspector per-node editors (the centerpiece).

## Constraints / discipline
- Branch **`feat/unified-shell`** (no merge to main without Trent).
- **`packages/core` stays pure** (no Node/DOM/IO). One task = one agent, **disjoint files**.
- Gate the touched package during work (`pnpm --filter @ledrums/<pkg> typecheck`); full `pnpm typecheck && pnpm test` only on a committed clean tree. Use the **Svelte MCP / `svelte:svelte-file-editor`** for `.svelte` work.
- After meaningful work run **GROW** (update `.mex/ROUTER.md`, bump `last_updated`, `mex log` when rationale matters).

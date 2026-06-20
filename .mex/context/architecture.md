---
name: architecture
description: How the major pieces of this project connect and flow. Load when working on system design, integrations, or understanding how components interact.
triggers:
  - "architecture"
  - "system design"
  - "how does X connect to Y"
  - "integration"
  - "flow"
edges:
  - target: context/stack.md
    condition: when specific technology details are needed
  - target: context/decisions.md
    condition: when understanding why the architecture is structured this way
last_updated: 2026-06-20
---

# Architecture

## System Overview
Authored content + live input → render loop → pixels → wire & screen.

```
KitConfig + Composition (JSON projects)
        │  buildPixelModel()            ← packages/core/geometry
        ▼
   PixelModel (per-pixel local+world XYZ, hoop, angle, zone, DMX addr)
        │
Input (MIDI via browser WebMIDI → WS ; OSC via UDP) ─► InputRouter ─► Engine state
        │                                                        (triggers clips, sets control values)
        ▼
   RenderLoop @ ~60fps  ──►  Compositor: for each Layer → active Clip.effect.render()
        │                    blend bottom→top into Frame (Uint8 RGB[])
        ├──► OutputManager → ArtNet/sACN packets over dgram → PixLite controller
        └──► WebSocket frame stream → Threlte 3D visualizer (apps/web)
```

`packages/core` is pure and deterministic. `apps/server` owns the clock, IO wiring, and
persistence. `apps/web` is a thin client: it renders the live frame and edits the
Composition/Kit, sending mutations back over WS.

## Key Components
- **`@ledrums/core` / geometry** — `buildPixelModel(kit)` turns drum config (diameter, hoops, density, origin, rotation) into per-pixel local+world coordinates, hoop/angle/zone metadata, and DMX addressing. Pure.
- **`@ledrums/core` / model** — `Composition`, `Layer` (blend mode + opacity + clips), `Clip` (effect id + params + modulations). Plain serializable data.
- **`@ledrums/core` / effects** — `EffectRegistry` of `EffectGenerator`s, each a pure `render(ctx, framebuffer)`. Effects read resolved params + `RenderContext` (time, transport, pixel model, trigger state).
- **`@ledrums/core` / compositor** — blends layer framebuffers into the final `Frame`; resolves `Modulation` (control source → parameter) per frame.
- **`@ledrums/io`** — `ArtNetOutput`, `SacnOutput` (UDP pixel output), `OscInput`/`OscOutput`. All behind `PixelOutput` / `EventInput` interfaces. Pure JS, no native deps.
- **`@ledrums/server`** — `Engine` (render clock + state), `InputRouter`, `OutputManager`, WS protocol, project load/save, static hosting of the built web app.
- **`@ledrums/web`** — Svelte 5 + Threlte visualizer and authoring panels; owns WebMIDI capture and forwards MIDI to the server.

## External Dependencies
- **Art-Net / sACN (E1.31) pixel controller** — e.g. Advatek PixLite A4-S; receives DMX-over-UDP universes. Target IP/universe configured at runtime.
- **OSC source (Ableton Live / Max)** — sends parameter automation + clip triggers over UDP.
- **MIDI source (drum controller / SPD)** — captured in the browser via the WebMIDI API; the server itself does not open MIDI ports.

## What Does NOT Exist Here
- No native MIDI/serial node addons — MIDI is browser WebMIDI only (cross-platform, no node-gyp).
- No cloud/database backend — projects are local JSON files; the app runs entirely on the operator's machine/LAN.
- No SSR/Next — the web app is a static SPA served by the Node server; `core` has zero framework coupling.
- No physics-accurate light simulation — the visualizer is a faithful pixel preview, not a renderer of real-world light spill.

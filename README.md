# LEDrums — Content App

A real-time, cross-platform generative **lighting engine and content-authoring app for a 3D LED-pixel drum kit**. It turns a drum-kit config into a per-pixel 3D model, composites authored *layers* of *effects* at ~60 fps, modulates effect *parameters* from live drum hits (MIDI) and Ableton (OSC), renders a live 3D preview in the browser, and transmits pixels over **Art-Net / sACN** to a hardware pixel controller (e.g. Advatek PixLite).

> The domain maps onto Resolume concepts: **Composition → Layer → Clip → Effect**, with blend modes — but it is drum-kit-pixel-native, not 2D-media.

## Architecture at a glance

```
KitConfig + Composition (JSON projects)
      │  buildPixelModel()                      packages/core (pure, no IO)
      ▼
 PixelModel (per-pixel local+world XYZ, hoop, angle, zone, DMX addr)
      │
Input: MIDI (browser WebMIDI → WS) · OSC (UDP) ─► InputRouter ─► Engine
      │
 RenderLoop @60fps → Compositor (layers, blend modes) → Frame
      ├──► OutputManager → Art-Net / sACN over UDP → PixLite controller   packages/io
      └──► WebSocket frame stream → Threlte 3D visualizer                 apps/web
```

- **`packages/core`** — pure, dependency-light TypeScript: geometry, color/blend, the layer/clip/effect model, 11 effects, the render engine. No Node/DOM/IO. Fully unit-tested.
- **`packages/io`** — hand-rolled Art-Net, sACN (E1.31), and OSC over `node:dgram`. No native addons.
- **`apps/server`** — the render-loop host: WebSocket control + preview stream, OSC input, pixel output, project persistence, static hosting of the web app.
- **`apps/web`** — Svelte 5 + Vite + Threlte: the 3D visualizer and authoring panels. Captures MIDI via WebMIDI and forwards it to the server.

See `.mex/ROUTER.md` and `.mex/context/` for the durable architecture record, and `docs/plans/` for the implementation plan.

## Requirements

- **Node.js ≥ 20** and **pnpm** (`npm i -g pnpm`).
- A **Chromium browser** (Chrome/Edge) for live MIDI input — WebMIDI is Chromium-only. (OSC works without a browser.)
- Works identically on **macOS** and **Windows** — no native build steps.

## Quick start

```bash
pnpm install
pnpm dev          # runs the server + Vite dev server with HMR
```

Then open the Vite URL it prints (default `http://localhost:5173`). The dev server proxies the WebSocket to the engine on port `4321`.

For a production-style run (server builds nothing extra; it serves the built web app):

```bash
pnpm build        # builds the web app to apps/web/dist
pnpm start        # serves the app + runs the engine on http://localhost:4321
```

The server prints its LAN URLs so you can open the UI from another device on the same network.

## Connecting to your pixel controller

1. Open the app and switch to **Authoring** mode (top bar).
2. In the **Output** panel:
   - Set **Target IP** to your controller's address (e.g. `192.168.1.50`).
   - Choose **Protocol** — **Art-Net** (default, leanest/fastest, the documented PixLite path) or **sACN (E1.31)**.
   - Set **RGB order** to match your strips (default `RGB` for GS8208).
   - Click **Dry-run** to form packets without transmitting, or **Armed** to go live (the banner turns red **LIVE**).
3. Output defaults to **Disabled** on every load — nothing is transmitted until you arm it. On disarm/disconnect/error the rig is **blacked out** automatically.

The pixel → universe mapping comes from the kit's `outputs[]` topology (each physical output ≤ 304 px), so universes land on the physically-wired pixels. Edit the topology in `apps/server/projects/<name>.json`.

### Windows firewall note

On first run, **Windows Defender Firewall** will prompt to allow inbound UDP for the OSC listener — **allow it**, or OSC input is silently dropped. Outbound Art-Net/sACN is not prompted.

## Input mapping

- **MIDI** (default project): GM-ish drum notes → drums and trigger clips:
  - `36` Kick → Whole Drum · `38` Snare → Chase · `48` Tom 1 → Follow Hoop · `45` Tom 2.
  - Note velocity drives the `velocity` control (e.g. brightness). Edit in the project's `inputMap`.
- **OSC** (from Ableton/Max, default UDP `9000`, override with `OSC_PORT`):
  - `/ledrums/volume <float 0..1>` drives the master `volume` control (e.g. saturation/level).
  - Any `/address <float>` is stored and can be bound to a parameter via a `{ "type": "osc", "address": "…" }` modulation.

## Effects

Eleven effects across every design category, in an extensible registry (`packages/core/src/effects`):
`solid-base` (swirl), `chase`, `whole-drum`, `whole-kit`, `follow-hoop`, `radial-wash` (3D, in/out/bounce), `wipe-3d` (any axis), `meter-eq`, `pixel-accum`, `colour-melody`, `strobe`.

Each effect declares a `paramSpec`, so the UI renders its controls generically and any control source (velocity, volume, beat, LFO, OSC) can modulate any parameter.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Server + web dev server (HMR) |
| `pnpm build` | Build the web app to `apps/web/dist` |
| `pnpm start` | Run the server (serves the built app + engine) |
| `pnpm test` | Run all unit tests (Vitest) |
| `pnpm typecheck` | Typecheck every package |

### Environment variables

- `PORT` — server HTTP/WS port (default `4321`).
- `OSC_PORT` — OSC UDP listen port (default `9000`).

## Project files

Projects are portable JSON under `apps/server/projects/` (`kit` + `composition` + `inputMap` + `output`). `default.json` ships the real 4-drum kit (kick/snare/tom1/tom2) at 120 px/m with a valid output topology. Load/save from the **Project** bar in the UI.

## Source design

This app implements the design in `docs/design/content-design-source.md` (effects, controls, parameters, Resolume mapping) and `docs/design/hardware-source.md` (drum geometry, the kit config, Art-Net/PixLite wiring).

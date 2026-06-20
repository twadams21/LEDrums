---
name: decisions
description: Key architectural and technical decisions with reasoning. Load when making design choices or understanding why something is built a certain way.
triggers:
  - "why do we"
  - "why is it"
  - "decision"
  - "alternative"
  - "we chose"
edges:
  - target: context/architecture.md
    condition: when a decision relates to system structure
  - target: context/stack.md
    condition: when a decision relates to technology choice
last_updated: 2026-06-20
---

# Decisions

## Decision Log

### Setlist → Song → Section arrangement with per-section (drum, slot) trigger routing
**Date:** 2026-06-20
**Status:** Active
**Decision:** Above the composition sits `Setlist → Song → Section`. Input maps note/OSC → `(drumId, slot)` (8 slots/drum, Sensory-Percussion zones); the **active section's** `bindings` decide which clip a `(drum, slot)` hit fires, and its `layerClips` set the looks on entry.
**Reasoning:** The same physical hit must do different things per song-section; routing belongs to the section, not the input map. Slots model multi-zone drum triggers.
**Alternatives considered:** Hard-coding note→clip on the input map (rejected — not section-aware); a global scene list decoupled from songs (rejected — songs/sections match how a set is performed).
**Consequences:** Engine resolves bindings from the active section each hit; switching a section re-points every trigger. New WS messages: `setActiveSection`, `setBinding`/`removeBinding`, add/remove song/section, `setSectionLayerClip`, `setInputMap`.

### Density pinned to 120 px/m with explicit per-drum output topology
**Date:** 2026-06-20
**Status:** Active
**Decision:** Default density is 120 px/m (hardware strip pitch). The default kit wires **one physical output per drum (all 4 hoops)**; `maxPixelsPerOutput` = 2400 (4 strips × ~5 m × 120). `buildDmxMap` walks the output topology, not a flat sweep.
**Reasoning:** Density is a property of the real GS8208 strips, not a render knob; the PixLite binds physical outputs, so universes must follow the wiring. (Matches the operator's actual rig: 4 hoops/output.)
**Alternatives considered:** 60 px/m for render smoothness (rejected — geometrically wrong; instancing handles 2,300 px fine); flat 170-px/universe sweep (rejected — mis-patches the kit).
**Consequences:** Default kit ≈ 2,300 px, 15 universes; topology lives in `apps/server/projects/*.json` `outputs[]` and is schema-validated against the per-output cap.

### 2D effects via a UV-field sampler; 41-effect registry across 7 categories
**Date:** 2026-06-20
**Status:** Active
**Decision:** Pixels carry a `uv` (cylindrical) coordinate; 2D "texture" effects are pure `(u,v,t) → rgb` functions rendered through `renderUvField(ctx, fb, mode, sample)`. The registry now spans 41 effects across `base/trigger/wash/meter/utility/texture/particle`.
**Reasoning:** A UV sampler makes 2D/video-style looks (plasma, fire, tunnels, caustics…) trivial and parallelizable to author, without each effect re-deriving spatial mapping.
**Alternatives considered:** Only 3D-spatial effects (rejected — user wants 2D UV-sampled looks); a real video-texture decode pipeline (deferred — procedural fields cover the need with zero assets).
**Consequences:** New effects are mostly one pure function; `texture`/`particle` categories added to `EffectCategory`.

### Visualizer renders oriented tube segments, not point sprites
**Date:** 2026-06-20
**Status:** Active
**Decision:** Each pixel exposes world `tangent`, `normal`, and `segmentLengthMm`; the visualizer draws one non-overlapping box per LED (a segment of a square diffusion tube), sized to the arc length with a small gap.
**Reasoning:** Sphere/point sprites overlapped and read as blobs; tube segments match the real build (LED tape in square diffusion tube) and guarantee no overlap.
**Alternatives considered:** Smaller spheres (rejected — still overlap/ambiguous); deriving orientation from neighbor positions in the web (rejected — fragile; core has the exact local frame).
**Consequences:** `SerializedModel` carries `tangents/normals/segmentLengths`; `Pixels.svelte` builds per-instance matrices from the basis.

### Pure `core` / IO-at-the-edges layering
**Date:** 2026-06-20
**Status:** Active
**Decision:** Geometry, model, effects, and compositor live in `@ledrums/core` with zero Node/DOM/IO imports; all transport lives in `@ledrums/io` and `@ledrums/server`.
**Reasoning:** Effects and the render math are the heart of the product and must be unit-testable in isolation and reusable from any host (server now, Electron/Tauri/native later).
**Alternatives considered:** One server package mixing render + IO (rejected — untestable, couples the engine to UDP/clock); putting effects in the web app (rejected — engine must run headless without a browser).
**Consequences:** `core` ships as portable ESM; a clear `PixelOutput`/`EventInput` interface boundary is mandatory.

### MIDI via browser WebMIDI, not native node addons
**Date:** 2026-06-20
**Status:** Active
**Decision:** MIDI input is captured in the browser (WebMIDI API) and forwarded to the server over WebSocket; the server opens no MIDI ports.
**Reasoning:** Native MIDI npm packages require node-gyp builds that are fragile on Windows + Mac. WebMIDI is built into Chromium browsers on both OSes and needs no install.
**Alternatives considered:** `@julusian/midi` (rejected — native build); Electron with native MIDI (deferred — adds packaging weight for v1).
**Consequences:** A browser tab must be open to capture MIDI. OSC (Ableton) goes straight to the server, so MIDI-less headless operation is still possible.

### Hand-rolled Art-Net / sACN / OSC over `dgram`
**Date:** 2026-06-20
**Status:** Active
**Decision:** Encode/decode Art-Net (`ArtDmx`), sACN/E1.31, and OSC packets ourselves on top of `node:dgram`.
**Reasoning:** The wire formats are small and stable; hand-rolling removes all native/transitive deps and keeps the protocol auditable and testable byte-for-byte.
**Alternatives considered:** `dmxnet`/`e131`/`osc` npm packages (rejected — extra deps, some pull native code, harder to unit-test exact bytes).
**Consequences:** We own correctness; packet encoders are covered by byte-level unit tests.

### Web app is a static SPA (Svelte 5 + Vite), served by the Node server
**Date:** 2026-06-20
**Status:** Active
**Decision:** No SSR; `apps/web` builds to static assets that `apps/server` serves, alongside the WebSocket endpoint.
**Reasoning:** This is a single-operator realtime tool on a LAN; SSR adds nothing and complicates the realtime/WS story. One process, one port, identical on Win/Mac.
**Alternatives considered:** SvelteKit (rejected — SSR overhead, routing we don't need); Electron-first (deferred — SPA + server runs everywhere today, shell can wrap it later).
**Consequences:** Single `pnpm start` runs the whole app; deep-linking/routing is client-side only.

### Render loop targets fixed-timestep ~60fps, decoupled from output rate
**Date:** 2026-06-20
**Status:** Active
**Decision:** The engine renders on a fixed-timestep clock (default 60fps); output adapters throttle/transmit independently and frame transmission is fire-and-forget.
**Reasoning:** Determinism for testing and stable effect timing; the hardware (PixLite) can run faster (≈105fps) but we must never let UDP backpressure stall the render clock.
**Alternatives considered:** requestAnimationFrame-style variable timestep on the server (rejected — non-deterministic, no rAF in Node); coupling render to output ACKs (rejected — head-of-line blocking).
**Consequences:** Effects receive `dt` and absolute `timeMs`; transport (BPM/beat) is derived from the clock.

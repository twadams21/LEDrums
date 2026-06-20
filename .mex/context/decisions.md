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

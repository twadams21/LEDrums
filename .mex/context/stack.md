---
name: stack
description: Technology stack, library choices, and the reasoning behind them. Load when working with specific technologies or making decisions about libraries and tools.
triggers:
  - "library"
  - "package"
  - "dependency"
  - "which tool"
  - "technology"
edges:
  - target: context/decisions.md
    condition: when the reasoning behind a tech choice is needed
  - target: context/conventions.md
    condition: when understanding how to use a technology in this codebase
last_updated: 2026-06-20
---

# Stack

## Core Technologies
- **TypeScript 5.7 (ESM, strict)** — every package; `core` compiles to portable ESM with no runtime deps.
- **Node.js ≥ 20** — `apps/server` render host + UDP IO (`dgram`, `ws`).
- **pnpm workspaces** — monorepo: `packages/core`, `packages/io`, `apps/server`, `apps/web`.
- **Svelte 5 + Vite** — `apps/web` SPA (runes-based reactivity).
- **Threlte (Three.js for Svelte)** — 3D pixel visualizer.
- **Vitest** — unit tests across all packages.

## Key Libraries
- **`ws`** (server) — WebSocket transport for state + frame streaming (no Socket.IO; we want a tiny binary-friendly protocol).
- **`three` + `@threlte/core` + `@threlte/extras`** (web) — instanced-mesh pixel rendering and orbit controls.
- **Native `node:dgram`** (io) — Art-Net, sACN (E1.31), and OSC are encoded/decoded by hand; no third-party protocol libs, so there are no native builds.
- **WebMIDI API** (web, built-in) — drum/MIDI capture in the browser; events forwarded to the server.
- **`zod`** (core) — runtime validation of project/kit JSON at the IO boundary.

## What We Deliberately Do NOT Use
- No native MIDI libs (`midi`, `easymidi`, `@julusian/midi`) — they need node-gyp and break the cross-platform / no-build guarantee. WebMIDI instead.
- No DMX/Art-Net npm packages — hand-rolled encoders keep the dependency surface tiny and auditable.
- No SvelteKit/Next/SSR — this is a local realtime tool, a static SPA is simpler and faster.
- No global state managers — Svelte 5 runes + a single typed client store.

## Version Constraints
- Svelte 5 runes syntax (`$state`, `$derived`, `$props`) — not Svelte 4 stores-by-default.
- ESM-only across the repo (`"type": "module"`); no CommonJS `require`.

---
name: setup
description: Dev environment setup and commands. Load when setting up the project for the first time or when environment issues arise.
triggers:
  - "setup"
  - "install"
  - "environment"
  - "getting started"
  - "how do I run"
  - "local development"
edges:
  - target: context/stack.md
    condition: when specific technology versions or library details are needed
  - target: context/architecture.md
    condition: when understanding how components connect during setup
last_updated: 2026-06-20
---

# Setup

## Prerequisites
- Node.js 20+ (developed on 25.x).
- pnpm (`npm install -g pnpm`).
- A Chromium browser (Chrome/Edge) for live MIDI input (WebMIDI is Chromium-only). OSC works without one.

## First-time Setup
1. `pnpm install`
2. `pnpm dev` — runs the server (engine, port 4321) + Vite dev server (UI, port 5173, proxies `/ws`).
3. Open the Vite URL it prints. For a production-style run: `pnpm build` then `pnpm start`.

## Environment Variables
- `PORT` (optional) — server HTTP/WS port, default `4321`.
- `OSC_PORT` (optional) — OSC UDP listen port, default `9000`.
- No secrets; the app runs entirely on the operator's machine/LAN.

## Common Commands
- `pnpm dev` — server + web dev server with HMR.
- `pnpm build` — build the web app to `apps/web/dist`.
- `pnpm start` — run the server, serving the built app + engine.
- `pnpm test` — all Vitest suites (core 58, io 12, server 27, web 24).
- `pnpm typecheck` — typecheck every package (core/io/server via `tsc`, web via `svelte-check`).

## Common Issues
- **No MIDI input:** use Chrome/Edge (WebMIDI), and keep the control tab foregrounded — background tab throttling can drop hits. OSC is unaffected.
- **OSC not arriving on Windows:** allow the inbound-UDP firewall prompt on first run, or it is silently dropped.
- **Nothing on the hardware:** output defaults to **Disabled**. In the UI Output panel set the controller IP, choose Art-Net/sACN, and click **Armed**.
- **`tsx not found` when launching the server directly:** run via `pnpm --filter @ledrums/server start` (resolves the workspace bin), not `node` from the repo root.

---
name: agents
description: Always-loaded project anchor. Read this first. Contains project identity, non-negotiables, commands, and pointer to ROUTER.md for full context.
last_updated: 2026-07-02
---

# LEDrums

## What This Is
A real-time, cross-platform generative lighting engine and content-authoring app that drives a 3D LED-pixel drum kit - mapping live drum (MIDI) / Ableton (OSC) input and authored layers (base / trigger / automation / effect) onto the XYZ pixel coordinates of each drum's hoops, and outputting to Art-Net / sACN pixel controllers.

## Non-Negotiables
- `packages/core` stays pure: no Node/DOM/IO imports. Geometry, model, effects, compositor are platform-agnostic and unit-tested.
- All IO (UDP/Art-Net/sACN/OSC) lives behind interfaces in `packages/io`; `core` never imports it.
- Cross-platform: no native addons / node-gyp. UDP + OSC are pure JS over `dgram`; MIDI comes from the browser via WebMIDI and is forwarded over WebSocket.
- The render loop is deterministic given (time, inputs, model) - effects must be pure functions of `RenderContext`, no hidden global state.
- Never block the render loop with sync IO; output adapters must be fire-and-forget.
- Any change that touches UI must apply the `/make-interfaces-feel-better` skill (design-engineering polish pass), alongside the Impeccable design context (`PRODUCT.md` / `DESIGN.md`).
- UI work must **use or extend the design system** (`docs/design-system.html` — tokens, primitives, composites, interaction contracts; regenerate with `pnpm design-system`). Compose from its components; anything new and reusable gets added to the styleguide entry (`apps/web/src/lib/styleguide/` — see its README) and the file regenerated **in the same change**.
- UI changes must be verified with `pnpm ui-shot` captures (see `scripts/ui-shot/README.md`) — screenshot the affected surface(s) against the running app; the tool also surfaces console errors.

## Commands
- Install: `pnpm install`
- Dev (server + web): `pnpm dev`
- Test: `pnpm test`
- Typecheck: `pnpm typecheck`
- Build: `pnpm build`
- Design system (regenerate `docs/design-system.html`): `pnpm design-system`
- Start (prod, serves built web): `pnpm start`

## After Every Task
After meaningful work, run GROW:
- Ground: what changed in reality?
- Record: update `.mex/ROUTER.md` and relevant `.mex/context/` files
- Orient: create or update a `.mex/patterns/` runbook if this can recur
- Write: bump `last_updated` on changed scaffold files and run `mex log` when rationale matters

## Navigation
At the start of every session, read `.mex/ROUTER.md` before doing anything else.
For full project context, patterns, and task guidance - everything is there.

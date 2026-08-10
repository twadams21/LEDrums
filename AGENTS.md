---
name: agents
description: Always-loaded project anchor. Read this first. Contains project identity, non-negotiables, commands, and pointer to ROUTER.md for full context.
last_updated: 2026-08-10
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

## Desktop Releases (OTA)
The normal release route is a **GitHub Release**: land the version bump on `main`, then create a
release tagged `v<version>` — `.github/workflows/release-ota.yml` builds both macOS architectures,
signs, publishes to R2, and announces to Discord. The tag is the version; the live `latest.json`
(not git) remains the authority on what has shipped, and the workflow's gate refuses republish /
rollback / tag-vs-`tauri.conf.json` mismatch. `pnpm ota bump` is the local fallback for a CI
outage; `pnpm ota doctor` (read-only) reports what is live. Details:
`apps/desktop/README.md` → "Release flow".

## Ticket Tracking (Notion + GitHub)
Remediation/initiative tickets are tracked in two places with distinct roles:
- **GitHub issues** (`twadams21/LEDrums`) reflect **merge status only** — close an issue when its change is merged. Blocking edges live in the issue bodies.
- **The Notion DB is the authoritative truth on completion.** Current initiative: "Gen3 UX Remediation Tickets" under the LEDrums Notion page (<https://app.notion.com/p/0b24b7e353064ec0bd3d64c51bc12aee>, data source `collection://199954bb-9870-48eb-b3c6-c3c81a496d7a`). A ticket is done when its Notion row Status says Done — not merely when the GH issue is closed. Update Status (`Ready` / `Blocked` / `In progress` / `Done`) as work moves, and unblock downstream rows when their blockers complete.
- **Reports live on the Notion row.** Write implementation reports and review reports into the ticket's row page body (the row is a page).

## After Every Task
After meaningful work, run GROW:
- Ground: what changed in reality?
- Record: update `.mex/ROUTER.md` and relevant `.mex/context/` files
- Orient: create or update a `.mex/patterns/` runbook if this can recur
- Write: bump `last_updated` on changed scaffold files and run `mex log` when rationale matters

### Attribution and sourcing in ROUTER entries
`.mex/ROUTER.md` is read as ground truth by every session, and nothing in it is checkable
against the code. Two rules keep it honest:

- **Name the person, and get the name right.** Derive it from the machine, not from a guess:
  `scutil --get ComputerName` (macOS) — "Trent's MacBook Pro" → Trent, "Tim's ..." → Tim. Never
  write "locked with Trent" from a session running on Tim's machine. This has happened: PR #156's
  entries credited Tim's design decisions to Trent, and the wrong name was then treated downstream
  as settled approval.
- **Source the requirement, or mark it as an assumption.** Write where a stated need came from —
  a person, an issue, a doc. If it was inferred, say "assumed". Colour invented to make a feature
  sound concrete becomes load-bearing: #156's "footswitch" appears nowhere on `main` and in no
  product doc, yet it justified a separate-graph design that forced a cross-graph reference and a
  silent data defect. An unsourced requirement is a hypothesis; label it as one.

## Navigation
At the start of every session, read `.mex/ROUTER.md` before doing anything else.
For full project context, patterns, and task guidance - everything is there.

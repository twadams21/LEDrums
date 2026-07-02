# Rock Solid — context docs for the 2026-07-02 reliability + feature initiative

Goal: the app is cool but not trusted on a live show yet. This directory is the **context layer**
for a `/to-prd` pass covering Trent's 2026-07-02 batch of bugs + features. Each section doc is
self-contained: problem, verified current-state mechanism with file:line refs, proposed design in
`/codebase-design` vocabulary (modules/interfaces/seams), touch lists, tests, and the decisions
the PRD must make. Investigated via 10 parallel Haiku explore agents on 2026-07-02; the four most
load-bearing claims (echo re-fire, engine looks deferral, param-spec drop, pinned attack handle)
were re-verified against source by the orchestrator. **A future agent should not need to
re-discover anything here** — but line numbers drift; re-anchor by symbol name before editing.

## Sections

| Doc | Topic | Kind |
|---|---|---|
| [01](01-io-confidence-pixlite.md) | IO confidence (MIDI/OSC/Art-Net/sACN status UX) + PixLite Mk3 API integration | feature |
| [02](02-desktop-shell-updater.md) | Deprecate the desktop loading shell; unified update UX with real progress | fix + feature |
| [03](03-input-routing.md) | Input→graph firing: echo-loop bug, single-path resolution, keyboard intent msg | bug + design |
| [04](04-sections-base-effects.md) | Section base effects ("looks"): engine parity + authoring UI | bug + feature |
| [05](05-effects-color-params-envelopes.md) | Effect property overhaul (full color, enums) + per-segment envelope easings | feature |
| [06](06-effect-time-thumbnails-modifiers.md) | Restart-on-trigger timebase · broken thumbnails · effect modifiers (Grain/Bloom/Trail…) | bug + feature |
| [07](07-linked-presets-song-library.md) | Remove `linked` instances · canonical Song Library across shows | design + feature |
| [08](08-layout-splitter-kit-flips.md) | Right-dock resize rail · drum flip / kit mirror (+ `pixelsPerHoop` forwarding bug) | feature |
| [09](09-trigger-graph-blank-bug.md) | Trigger-graph blank-nodes incident: ranked hypotheses + instrument-first plan | bug |
| [10](10-modulation-system.md) | Modulation system: Envelope/LFO/CC nodes → per-param mappings on target nodes (+ node-face signal previews) | feature (supersedes 05's envelope placement; extends 06's wiring) |
| [11](11-clipboard-portability.md) | Clipboard copy/paste of graphs/sections/songs + the patch, across servers (offline authoring workflow) | feature (shares doc 07's closure machinery) |

## Cross-cutting findings (read before slicing the PRD)

1. **The sim/server duality is the root of three complaints.** The web-local sim and the core
   voice engine both resolve and fire (docs 03, 04): the sim implements section looks the engine
   defers (04), the client fires locally *and* re-fires on the server's input echo (03), and the
   visualiser (server frames) disagrees with LayersDock (local sim voices). Adopt one principle in
   the PRD: **when the engine link is open, the server is the only resolver/renderer; the sim is
   an offline-preview adapter behind the same resolution interface.** Several fixes fall out of
   this single decision.
2. **Confidence is a data problem already 80% solved server-side.** `OutputStatus`, the monitor
   bus, and per-input events already flow to clients; the UI just never surfaces them (01). The
   PixLite API closes the last gap (controller-side rx verification).
3. **Effects are wide-but-shallow work.** The engine (RGBA framebuffer, envelope sampler, voice
   birth times, scratch-buffer compositing) already supports full color, rich envelopes,
   restart-on-trigger, and modifiers. The changes are param contracts + per-effect passes +
   editor UI (05, 06), not architecture.
4. **Non-negotiables hold everywhere**: `packages/core` stays pure (PixLite client goes in
   `packages/io`; discovery service in `apps/server`); effects stay pure functions of
   `RenderContext`; output adapters stay fire-and-forget (controller verification is out-of-band
   via the management API); everything deterministic.
5. **Migrator pattern** for every model change (linked-removal, envelope curve→eases, section
   looks, song library): hydrate-time, defensive, idempotent — precedents `foldVelocitySwitch`,
   `migrateSongs` (`apps/web/src/lib/trigger-lab/persistence.ts`).

## Suggested slice ordering (dependencies)

```
03 input routing  ──►  04 section looks (needs "server-authoritative when connected")
05 params/color   ──►  06 modifiers (needs enum ParamValues; builds toPort wiring infra)
                          └──► 10 modulation (extends toPort with param:*; envelope shapes from 05)
06 timebase       ──►  06 thumbnails (inherit the fix)
07A remove linked ──►  07B song library ──► 11 clipboard portability (shares closure extraction)
01, 02, 08, 09    ──   independent; 09 is instrument-first and can land immediately
```
All of 05/06/10 ship in the **first wave**, in that dependency order (locked with Trent).

## Product decisions — LOCKED with Trent 2026-07-02 (details in each doc's Decisions section)

- 03: **both-fire kept** (pad path + direct binding); trigger nodes show a drum-link icon +
  tooltip when their source is also zone-mapped. Echo-loop and keyboard-impersonation fixes
  unchanged.
- 01: PixLite v1 = **read-only + identify + test patterns** (test-pattern takeover state must be
  loud in the UI); config-write deferred. Server polls `statisticRead` 1–2s while Monitor/Patch
  open.
- 02: **fully in-app** update UX — no native dialog, in-app badge, user-initiated install,
  progress everywhere.
- 05: colour = **picker + envable sliders** — canonical numeric H/S/B params (envelope-able),
  swatch is a write-through UI affordance.
- 06: **modifiers are graph nodes** wired to a distinct `mod` input handle on Play nodes (one
  modifier → many effects; mod→mod chaining; parallel order by y). **Build the full set** and
  extend — full creative expression.
- 07: canonical **Song Library** with refs from shows; deletion **blocked while in use**;
  naming = Song Library + Setlist.
- 08: kit-mirror control on the Patch view toolbar (orchestrator default; smallest surface).
- 10: **modulation system** — Envelope/LFO/CC as graph nodes; targets expose an initially-empty
  mappable-param list, each exposed param = its own node-face row + scoped input handle; mapping
  editing is **target-side only**; per-voice envelope semantics, continuous LFO/CC; inline
  `env: EnvMap` migrated to nodes and removed; LFO in the first cut; first wave. Source nodes
  show **signal previews on the node face** (envelope curve, LFO waveform + phase, CC live value).
- 11: clipboard portability — one versioned ClipDoc envelope for graph/section/song/patch;
  re-key-by-default paste with identical-content reuse; new `setProject` bulk message with a
  diff-confirm dialog for patch paste. (Two small open items in doc 11's Decisions.)

## Process note (Trent, 2026-07-02)

**Every UI-touching slice must apply the `/make-interfaces-feel-better` skill** in addition to
the Impeccable design context (`PRODUCT.md`/`DESIGN.md`) — now recorded as a non-negotiable in
`AGENTS.md`. PRD slice briefs for UI work should name it explicitly.

## Verification context

Gates: `pnpm typecheck` (0 across 5 pkgs) + `pnpm test` (863+ tests: core/io/protocol/server/web)
green at time of writing (branch `main`). Several prior initiatives still owe live `:5173`
spot-checks (see `.mex/ROUTER.md`); the PRD should budget a consolidated spot-check pass — the
routing/looks/retrigger fixes here change live behavior that only a browser+hardware session
proves.

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
last_updated: 2026-09-05
note: External Dependencies below (Art-Net/sACN controller, OSC source, MIDI source) are external runtime endpoints, not npm packages — `mex check` flags them as missing-from-manifest; that is expected.
---

# Architecture

## Current runtime correction (code-verified 2026-09-05)

The sections below were written for the original Composition engine and are **historical**, not
an accurate complete map of current `main`. Current authoring uses show-global trigger graphs,
setlist sections, voice buses and graph-based effects/modulation. `packages/core/src/voice/`
owns the voice engine/compositor; `apps/server/src/voice-engine-host.ts` hosts it, while the
legacy `EngineHost` still exists. The web's `trigger-lab` store/sim is production authoring and
offline playback code despite its historical directory name, not a disposable prototype.

Browser WebMIDI is not the only MIDI source: `apps/desktop/src-tauri` has a native MIDI bridge
feeding the trusted-host server HTTP input path. `workers/error-ingest` is a deployed-surface
Cloudflare Worker with D1/R2 interfaces for error reports and backups; the older “no cloud
backend” assertion below no longer applies. Effects are registry-driven, not fixed at 41.

Ownership audit: `docs/plans/2026-09-05-codebase-health-audit.md`. The follow-up implementation
is currently on `fix/health-integration` (not yet declared merged):
- Core compositor/pool/envelope/member policies now also drive the offline Sim; geometry changes
  use immutable model identity, and modifier definitions explicitly declare scope execution policy.
- The store owns document replacement and creates a fresh Sim; `document-history.ts` owns
  structurally shared, identity-guarded, byte-estimated checkpoints. Persistence materializes at
  debounce/explicit flush boundaries, not on each drag event.
- `udp-output.ts` owns adapter readiness and bounded local-send/drain callbacks. OutputManager
  retains transmitted coverage across maps; packet acceptance is not controller acknowledgement.
- Controller test state belongs to its destination, independently of HTTP client credentials.
  Only acknowledged return-to-live clears unresolved ownership; old clients are not retained in
  the recovery ledger.
- Worker admission/notification identity belongs to one D1 transactional ledger. Notifications
  are bounded `waitUntil` work, not an awaited part of error persistence. Existing installations
  must migrate/backfill with writers quiesced before deploying this code.
Project replacement/async backup ownership and review corrections remain in progress; see
`docs/plans/2026-09-05-health-implementation.md` and the scoped implementation reports.
Pure-core and IO-separation rules below remain mandatory. Do not delete an apparently duplicate
host/sim until its live responsibilities have been transferred and tested.

Local P02/P11 branch `fix/health-project-backups` (2026-09-05): server
`project-replacement.ts` owns full load/restore/bulk transitions across both hosts and libraries;
`project-storage.ts` writes one atomic `default.state.local.json` envelope. Once present, that
file—not a mix of the older three files—is the cold-start authority. The active OutputManager
survives runtime replacement. Snapshot gzip/fs are async behind FIFO queues, but JSON
materialization remains synchronous and queued captures have no byte budget. See
`docs/reports/2026-09-05-health-projects.md` for migration, shutdown, measurement and integration
limits; this local branch is not a statement that these changes have shipped.

## Historical System Overview
Authored content + live input → render loop → pixels → wire & screen.

```
KitConfig + Composition (JSON projects)
        │  buildPixelModel()            ← packages/core/geometry
        ▼
   PixelModel (per-pixel local+world XYZ, hoop, angle, zone, DMX addr)
        │
Input (MIDI via browser WebMIDI → WS ; OSC via UDP) ─► InputRouter ─► Engine state
        │                          note/osc → (drumId, slot); the ACTIVE SECTION's
        │                          bindings decide which clip that (drum,slot) fires
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
- **`@ledrums/core` / geometry** — `buildPixelModel(kit)` turns drum config into per-pixel local+world coordinates plus hoop/angle/zone, **uv (cylindrical), tangent + normal + segmentLength** (the latter three orient non-overlapping tube segments in the visualizer), and an output-topology DMX map. Pure.
- **`@ledrums/core` / model** — `Composition` → `Layer` → `Clip` (effect id + params + modulations); **`Setlist` → `Song` → `Section`** where a section carries `layerClips` (looks set on entry) + `bindings` ((drumId, slot 0-7) → clip); `inputMap` maps note/osc → (drumId, slot). Plain serializable data, zod-validated.
- **`@ledrums/core` / effects** — `EffectRegistry` of **41 `EffectGenerator`s across 7 categories** (base/trigger/wash/meter/utility/**texture**/**particle**). Each is a pure `render(ctx, params, fb, state)`. 2D effects are built on `renderUvField(ctx, fb, mode, (u,v,t)→rgb)` (cylindrical or planar UV); stateful effects use engine-owned, seeded state.
- **`@ledrums/core` / engine + compositor** — drains a tick-stamped input queue, routes triggers via the active section, resolves `Modulation` (control → parameter), renders each layer's active clip, and blends framebuffers into the final `Frame`.
- **`@ledrums/io`** — `ArtNetOutput`, `SacnOutput` (UDP pixel output), `OscInput`/`OscOutput`. All behind `PixelOutput` / `EventInput` interfaces. Pure JS, no native deps.
- **`@ledrums/server`** — `Engine` (render clock + state), `InputRouter`, `OutputManager`, WS protocol, project load/save, static hosting of the built web app.
- **`@ledrums/web`** — Svelte 5 + Threlte. The visualizer renders each LED as a distinct, non-overlapping **square diffusion-tube segment** (oriented via the per-pixel tangent/normal); authoring panels edit the project; owns WebMIDI capture and forwards MIDI to the server. (A control-first shell + setlist/section editor + node-routing view are specced in `docs/` / the vault for a follow-on build.)

## External Dependencies
- **Art-Net / sACN (E1.31) pixel controller** — e.g. Advatek PixLite A4-S; receives DMX-over-UDP universes. Target IP/universe configured at runtime.
- **OSC source (Ableton Live / Max)** — sends parameter automation + clip triggers over UDP.
- **MIDI source (drum controller / SPD)** — captured in the browser via the WebMIDI API; the server itself does not open MIDI ports.

## What Does NOT Exist Here
- No native MIDI/serial node addons — MIDI is browser WebMIDI only (cross-platform, no node-gyp).
- No cloud/database backend — projects are local JSON files; the app runs entirely on the operator's machine/LAN.
- No SSR/Next — the web app is a static SPA served by the Node server; `core` has zero framework coupling.
- No physics-accurate light simulation — the visualizer is a faithful pixel preview, not a renderer of real-world light spill.

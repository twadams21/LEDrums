# Phase 2 — Trigger Graph, Effects, Temporal & UI Review (Fable handoff)

**For a Fable agent.** This is a follow-up review+fix+polish initiative on top of "Rock Solid" (39/49 slices merged to `rock-solid`; feature groups A–K done; Lane 4 = C/D/L still on hold). Trent dictated these items on 2026-07-03; they are captured faithfully here. **Nothing below has been started.**

## How to use this doc

- Read alongside: `docs/plans/2026-07-02-rock-solid/ORCHESTRATION.md`, `.../slices/INDEX.md`, the per-group reports in `docs/handoff/rock-solid/group-*.md` + `S*.md`, and the master tracker `docs/handoff/2026-07-02-rock-solid-tracker.md`.
- Base all work on `rock-solid` (current app HEAD). The voice engine is the live app — run dev with `LEDRUMS_ENGINE=voice pnpm dev` from `../ledrums-wt/wt-master` (now the default in `scripts/dev.mjs`).
- **Verify against the LIVE app, not just tests.** A whole bug class this session (below) is invisible to vitest.

## ⚠️ Cross-cutting context the reviewer must know

1. **Self-referential `$effect` bug class — already bit TWICE, app-fatal.** A colour-token `$effect` that reads AND writes the same `$state` (`c = { x: read('--tok', c.x) }`) → `effect_update_depth_exceeded` → Svelte halts effect flush **app-wide** → every delegated `onclick` dies (CSS `:hover`, canvas drag, keyboard still work — a deceptive signature). Fixed in `NodeSignalPreview.svelte` (6d19f14) and `ParamRowTick.svelte` (6c4bc06); idiom swept, none remain today. **Recommended: extract the theme-token read into ONE shared helper so no component hand-rolls it again**, and grep for any *new* self-referential effects during the graph review. Also null-guard anything a rAF ticker samples via a reactive getter (nodes can be deleted a frame before the ticker fires — the second half of the P0).
2. **Determinism is a core non-negotiable** (AGENTS.md): render is a pure function of (time, inputs, model). Item B below is a direct violation and is the highest-signal correctness bug.
3. **TRUST MANDATE (Trent, explicit):** he is "finding it hard to trust" that what the slice plan claims is done is actually working + visible. **Deliverable: an honest reconciliation of the slice plan vs. the running app** — for every merged group, what actually works live, what's stubbed/hidden/unwired, and what's missing. This underpins item I and should color the whole review.

---

## Work items

Each: **Intent · What we know · Pointers · Acceptance.** Suggested priority in the header (P0 = app-breaking/trust, P1 = correctness, P2 = polish) — Trent/orchestrator may re-rank.

### A. Full Trigger Graph review — "there are a lot of bugs" · **P0**
- **Intent:** a thorough correctness pass over the entire Trigger graph editor; find + fix the many bugs.
- **What we know:** two app-fatal `$effect` loops already found (see cross-cutting #1). Expect more reactive-loop hazards, lifecycle races (rAF sampling deleted nodes), pointer-events/overlay issues (one just fixed — the palette Panel blocked the canvas), and add/remove/wire edge cases. The palette→top-bar+modal redesign + OSC just landed (75ea23f) — review it too.
- **Pointers:** `apps/web/src/lib/app/views/` — `TriggerGraphView`, `GraphCanvas`, `GraphAddMenu`, `GraphPalette`, `NodeCard`, `TriggerNode`, `NodeSignalPreview`, `ParamRowTick`; `apps/web/src/lib/trigger-lab/store.svelte.ts`, `SignalFace`, `signal-preview.ts`; inspectors under `apps/web/src/lib/app/docks/inspectors/`.
- **Acceptance:** a live smoke-load of the graph with a clean console across all interactions (add/delete/wire/unwire every node kind, modulation mapping, retrigger); no `effect_update_depth_exceeded`, no uncaught throws; every documented interaction works.

### B. Effects library review + reliability — non-deterministic render · **P0**
- **Intent:** review the effects library and fix reliability; **specifically: play nodes with the EXACT same settings can render DIFFERENTLY in the visualiser.** That is a determinism violation.
- **What we know:** suspects — per-voice hidden state, spawn/order dependence, unseeded/ambient RNG, time-source differences, or compositor accumulation. Core must stay pure (no hidden globals). Group F (#51, effect params/envelopes) + the 41-effect audit are the recent effects work.
- **Pointers:** `packages/core/src/voice/` — `compositor.ts`, `engine.ts`, effects registry, `modulation*.ts`; the visualiser render path in web.
- **Acceptance:** two play nodes with identical settings produce **pixel-identical** output given identical (time, input); a determinism test at the confirmed seam.

### C. Temporal scope of effects / modifiers / modulation — overlapping retriggers · **P1**
- **Intent:** on a received trigger, every effect/modifier/modulation begins at **t=0**. It must be **retriggerable**, and a retrigger must NOT cut off the running instance — **the original envelope keeps going to its natural end while the new instance starts at t=0, so they OVERLAP** (polyphonic voices; no hard cutoff on retrigger).
- **What we know:** relates to the voice engine spawn/release, the envelope core (S23/S24), and the timebase (group G, S25–S27). The "authority principle" (group E/S12) governs who fires. Confirm each effect's clock is per-voice-from-its-own-t=0, not a shared global phase.
- **Pointers:** `packages/core/src/voice/` engine/envelope/timebase; sim mirror in `apps/web/src/lib/trigger-lab/`.
- **Acceptance:** rapid retriggers spawn independent overlapping voices; each runs its full envelope from its own t=0; the earlier voice finishes on its own timeline uninterrupted.

### D. UI review — scaling, microcopy, design-language consistency, polish · **P2**
- **Intent:** clean up + add general polish; make the design language coherent.
- **What we know / specifics from Trent:**
  - **Scaling issues** in some surfaces (identify + fix responsive/zoom breakpoints).
  - **Microcopy leaks implementation/design decisions** — user-facing text that describes *how it's built* rather than *what the user does*. Audit all visible copy; strip implementation/design-rationale language.
  - **Disjointed interaction methods for the same component type** — e.g. in a play node's parameter list, the **"disconnect wire"** and **"invert"** controls are two *different kinds* of component. **Trent's standing preference: icons + tooltips ALWAYS, never text as the label.** Standardise controls of the same class to one pattern (icon + tooltip).
  - General polish: apply `/make-interfaces-feel-better` + the Impeccable design context; use/extend the design system (`docs/design-system.html`; regenerate with `pnpm design-system`).
- **Pointers:** design system + styleguide (`apps/web/src/lib/styleguide/`), `ModulationParamsSection.svelte`, param-row controls, the UI primitives (`apps/web/src/lib/ui/`).
- **Acceptance:** consistent control patterns (icon+tooltip) for same-class actions; no implementation-speak in the UI; scaling clean at target sizes.

### E. Play-node parameters INSIDE the card · **P2 (UX)**
- **Intent:** when a play node gains parameters, they render **inside the node card**, not as a **separate card bolted onto** the node.
- **Pointers:** `NodeCard.svelte`, `TriggerNode.svelte`, the play-node param rendering (`ParamRowTick`, `ModulationParamsSection` / param row layout).
- **Acceptance:** params are visually contained within the play node's card; no detached secondary card.

### F. Visual theme — darker surfaces, no module gaps · **P2**
- **Intent:** darker surface colours + background; the main "modules" (dock panels) sit **flush — no gap between them.**
- **Pointers:** design tokens (surface/background scales), the app-shell layout/grid (docks), `app.css`.
- **Acceptance:** darker theme applied via tokens (not one-offs); zero inter-module gutters in the shell.

### G. Every node gets a preview (TouchDesigner-style) · **P2**
- **Intent:** ALL nodes show a preview (animated or static) of what they do. Some **static until triggered, then show LIVE what they're doing** on trigger (like TouchDesigner node thumbnails).
- **What we know:** infrastructure exists — `NodeSignalPreview`, `SignalFace` (shared rAF ticker, viewport-gated, reduced-motion aware), `effect-thumb-ticker.ts`, effect thumbnails (group G/S27 thumbnail fidelity). Extend that pattern to every node kind. **Mind the `$effect` bug class when adding previews** (this is exactly where it bit twice).
- **Pointers:** `NodeSignalPreview`, `SignalFace`, `effect-thumb-ticker.ts`, `signal-preview.ts`, node face components.
- **Acceptance:** every node kind renders a preview; trigger-driven nodes go live-on-trigger; no reactive loops; performant (viewport-gated).

### H. Layers/Buses animation lag (perf regression) · **P1**
- **Intent:** the Layer/Buses dock animation is now **lagging** — restore smoothness.
- **What we know:** LayersDock was moved to server-truth voice stats (group E/S17). Suspects: over-frequent reactive re-render, unthrottled stat stream, per-frame allocations, or a non-gated animation. Profile before changing.
- **Pointers:** the Layers/Buses dock component, voice-stats streaming path (server → web), `store.svelte.ts` stat handling.
- **Acceptance:** smooth Layers/Buses animation under a realistic voice load; profiled improvement.

### I. Song Library — verify it's built AND surface it in the UI · **P1 (trust)**
- **Intent:** Trent can't find the song library in the UI and is unsure if it was built.
- **What we know (important):** **it WAS built + merged** — group J (issue #53, "Presets & Song Library"), slices **S39 (remove linked presets), S40 (library persistence + closure extraction), S41 (refs/resolve/detach/guards), S42 (Library UI + naming pass)** — all on `rock-solid`. Reports: `docs/handoff/rock-solid/group-J.md`, `S39–S42.md`. So the likely issue is **not-surfaced / not-wired into a discoverable UI entry point**, not "unbuilt."
- **Action:** find the library UI (`git grep -i "library\|song"` in web), confirm its entry point + that the full closure (persist → refs → resolve/detach → UI) works **end-to-end in the live app**; if it's implemented-but-hidden, surface it with a clear entry point; report honestly what's real vs missing.
- **Acceptance:** the song library is reachable + usable in the running app (save/name/load/reference a song), demoed live; the plan-vs-reality note (cross-cutting #3) explicitly covers it.

---

## Suggested sequencing (non-binding)

1. **P0 first:** A (trigger-graph stability) + B (render determinism) — these undermine trust in everything else.
2. **P1:** I (song-library surfacing + the plan-vs-reality reconciliation) → C (temporal/overlap correctness) → H (Layers/Buses perf).
3. **P2 polish, as a cohesive design pass:** D (consistency/microcopy/scaling) + E (params-in-card) + F (darker/flush theme) + G (node previews) — do these together so the design language lands coherently (one `pnpm design-system` regen, one Impeccable pass).

## Orchestration note

Can reuse the Rock Solid twux lane pattern (master → lane/impl agents) and its **LOCKED policies** (opus/medium default, never xhigh; own windows; integrate-before-handoff; **live-app smoke-load in every UI/effect review**; budget 70%; escalate to Trent only via AskUserQuestion). But this is a Fable-led review — shape as the orchestrator sees fit. Land on a branch off `rock-solid` (or off `main` after Rock Solid's final gate, if that happens first).

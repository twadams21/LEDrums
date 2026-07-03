# Phase 0 — Plan-vs-reality reconciliation (2026-07-03)

Code-level audit of everything Rock Solid claims to have shipped, against what is actually wired and reachable on `rock-solid`. Ran as 7 parallel read-only Explore agents (haiku). Companion to `HANDOFF.md` (items A–I) and `TRENT-DICTATION-2.md`.

**Scope caveat:** this is a *code* audit — existence, wiring, reachability, mechanism. Live-app behaviour (the vitest-blind bug class) still needs a dev-server smoke pass; items needing live confirmation are marked ⚠️LIVE.

---

## 1. Trust verdict

**Every merged group is real.** No vaporware found. All user-visible claims in groups A, B, E, F, G, H, I, J, K plus both side-tasks (palette redesign + OSC, shell-theme-rails) trace to wired, reachable code with no hidden flags, no orphaned components, and no stub TODOs in runtime paths.

The trust gap is explained by four *presentation* failures, not missing work:

1. **Song Library is buried** — built end-to-end but below the fold of the Objects view with no signposting (§4).
2. **Previews aren't trigger-driven** — the thumbnail infra loops a synthetic clock, so nothing *feels* alive/wired (§5).
3. **Graph interactions are rough** — nine confirmed UX defects make the editor feel untrustworthy even where the model underneath is sound (§7).
4. **The Share button self-hides** — it renders only when the server reports a tunnel; the button wasn't removed (§6).

### Group-by-group

| Group | Claim | Verdict |
|---|---|---|
| A — Graph editor hardening | flow-callback guards, projection cache, stale-node placeholders, reportError seam | **WIRED** — but Patch graph deliberately NOT hardened (documented deviation; relevant to Patch inspector complaints) |
| B — IO confidence | output pill truth table, output status panel, input activity badges, MIDI device list | **WIRED**, all reachable |
| E — Input routing / looks | authority principle (echo never fires sim), fireGraph intent, drum-link badges, section looks, LayersDock server stats | **WIRED** — but see LayersDock perf (§8) |
| F — Effect params/envelopes | ParamValue widening, mapParamSpec total, ColorSwatch, EasePicker, envelope core v2 + editor, 41/41 audit | **WIRED**, styleguide obligations met |
| G — Timebase & thumbnails | voice/absolute timebase flag, bridge clock swap, thumb renderer, 41-thumb audit | **WIRED** — residuals documented (stateful effects don't reset at loop seam) |
| H — Modifiers | 18 modifiers, chain runner, graph resolver, registry UI | **WIRED** (per-param env residual closed by I/S34) |
| I — Modulation | mapping model, envelope/LFO/CC+OSC sources, param edges, previews | **WIRED** end-to-end |
| J — Song Library | persistence, refs/resolve/detach/guards, Library UI | **WIRED but UNDISCOVERABLE** (§4) |
| K — Clipboard | ClipDoc, copy/paste songs/graphs/sections/patches, paste-destination dialog | **WIRED** (no Cmd+C/V shortcuts — documented non-scope) |
| Side: palette+OSC | pointer-events fix, top-bar add buttons + modals, OSC modulation | **WIRED** end-to-end, ModifierPalette fully retired |

---

## 2. Item B — determinism: RECLASSIFIED

**The core engine is clean.** Sweep found zero ambient randomness in `packages/core`: all randomness goes through the seeded Mulberry32 `Prng` (`prng.ts`, used by sparkle/grain/engine/eval-graph, with `deriveSeed()` per-trigger decorrelation); voice pool slots/ids/stealing are deterministic; compositor blending is commutative; hoop pixel ranges are pure geometry.

**The likely culprit is the web sim:** `apps/web/src/lib/trigger-lab/sim.ts` calls **`Math.random()` at lines 498, 501, 523, 624, 627, 644** — and its own header declares it "THROWAWAY SIMULATION … delete this whole directory". That throwaway layer is still what the visualiser renders from whenever the app isn't adopting server frames. So "identical settings render differently" and "same node on a different hoop looks different" are almost certainly the sim mirror, not the engine. ⚠️LIVE: confirm which path feeds the visualiser under `LEDRUMS_ENGINE=voice` when the link is open vs not.

**Consequence:** item B's fix converges with item C exactly as HANDOFF predicted — replace the sim's `Math.random()` with trigger-derived seeded PRNG (same recipe as core), or better, collapse the sim mirror onto the core engine so there is one render truth. The acceptance test ("two identical play nodes → pixel-identical") should sit at the compositor seam AND at the visualiser input.

## 3. Cross-cutting `$effect` class: CLEAN

No new self-referential `$effect`s anywhere in `apps/web`. Both fixed sites (`ParamRowTick.svelte:20-32`, `NodeSignalPreview.svelte:33-46`) carry explanatory comments and fallback-based reads. rAF tickers are properly guarded/cleaned. Remaining hygiene: the theme-token `getComputedStyle` read is hand-rolled in those 2 files — extract one shared helper so the idiom can't be re-invented wrong (HANDOFF cross-cutting #1 recommendation stands).

## 4. Item I — Song Library: BUILT, buried

Reachable at **left rail → Objects → Songs tab → scroll to "Song Library" section**. Full closure verified in code: export-to-library, import-as-reference, detach, guarded delete, rename; persists to localStorage + server (`setSongLibrary`) on debounced autosave. Clipboard (K) fully wired incl. paste-destination dialog.

**Reclassify item I from "verify built" → discoverability/IA:** give the library a visible entry point (and fold into the D chrome pass). Known intentional gaps: no keyboard copy/paste shortcuts, no file export adapter, structural ref edits require detach.

## 5. Item G — previews: nothing is trigger-driven (confirmed)

All previews share ONE wall-clock rAF ticker (`effect-thumb-ticker.ts`). Effect thumbs fake a hit by looping a synthetic 1600 ms age (`THUMB_LOOP_MS`, timebase-aware); envelope/LFO previews sweep the same loop; CC previews read live tables; **no preview has any connection to real voices or live triggers.** Stateful effects (confetti/pixel-accum/starfield…) don't reset state at the loop seam (documented S27 residual).

TouchDesigner parity needs a new seam: pipe the live trigger/voice event stream into preview context (the S17 VoiceStat pattern is the precedent), per-voice state reset at retrigger, and static-until-triggered behaviour per node kind. Infra to build on is good (shared ticker, viewport gating, reduced-motion).

## 6. Regressions: Share button, logo

- **Share button was NOT removed.** `ShareInfo.svelte` is rendered unconditionally in `TopBar.svelte:82` but self-hides unless `store.tunnel` has a url/pin (`ShareInfo.svelte:17-21`). So the *tunnel* is what disappeared — server-side `tunnel-manager.ts` spawns cloudflared; something in the current dev/voice-engine config isn't starting or reporting it. ⚠️LIVE: check server logs for cloudflared spawn under `pnpm dev`.
- **Logo:** there is no logo asset — the mark is a 20 px CSS `conic-gradient` square (`TopBar.svelte:109-121`) + "LEDrums" text. Web app has **no favicon at all**. Desktop has generic tauri icons. Clean slate for a proper mark (fits the Linear/Resend direction).

## 7. Trigger-graph UX defects — mechanism map

All nine reported behaviours located (agent hypotheses; ⚠️LIVE to confirm each):

| # | Symptom | Mechanism | Where |
|---|---|---|---|
| 1 | Wire curve shifts on release | drag-preview coords (xyflow-owned) vs store-synced committed coords disagree; path re-derives | `WireEdge.svelte:23-25`, `TriggerGraphView.svelte:271-274` |
| 2 | Duplicate wires | dedup exists in `canConnect` but is bypassable (port normalization / race) | `store/graph-wiring.ts:61-70` |
| 3 | Some wires unselectable | no explicit hit-area/pointer-events on edge paths; xyflow default thin-stroke hit test | `GraphCanvas.svelte:183-242` |
| 4 | Node XY unreliable | xyflow owns live position during drag; store write-back on dragstop can race rebuilds (`untrack` read mid-rebuild) | `TriggerGraphView.svelte:271-274`, `trigger-flow-projection.ts:41-68` |
| 5 | Nodes stack mid-screen on add | spawn point = viewport centre + fixed `cy - 40`; repeated adds → same coords. (DnD-to-add would eliminate; so would a spiral/offset probe) | `GraphPalette.svelte:42-48`, `store.svelte.ts:2449-2477` |
| 6 | Z-order churns with selection | xyflow default raise-selected; no explicit z policy | `GraphCanvas.svelte:179-190` |
| 7 | Modifier handle placement | hardcoded inline `top: 74%` / `50%` — no relationship to actual card layout | `TriggerNode.svelte:146-153` |
| 8 | Inspector doesn't follow selection | shell clears selection when node momentarily missing during graph switch/rebuild; Patch inspector shares mechanism + Patch graph is unhardened | `Inspector.svelte:47-50`, `AuthorShell.svelte:50-60` |
| 9 | Hover inconsistency | mixed CSS `:hover` (instant) vs JS `hovered` prop (event-delayed) per element class | `NodeCard.svelte:91-94`, `GraphCanvas.svelte:187-235`, `GraphPalette.svelte:113-115` |

**Delay-node corruption (add semi-replaced it):** strongest candidate is `changeKind`'s edge-stripping (`store.svelte.ts:2555-2580`) acting on a stale/wrong node ref via `selectedGraph` derivation (`:681`); a separate id-reservation bug affecting paste was already fixed (6f40bbf). Needs live repro to pin.

**Inspector height:** not a fixed-height bug — visualiser default 300 px (`--viz-h`) eats the dock; inspector gets the remainder (~200 px at 1080p). The new visualiser↔inspector splitter (Phase-2 item F) already helps; the full-height right-rail / slide-over question is a design decision (§10).

**Title styles:** the three offenders (`Kit preview`, `Views`, section titles) are all the SAME `Eyebrow` primitive (2xs mono uppercase faint); the preferred tabbed header is the `Tabs` component (larger, accent flash, 13 px icons). Unification = promote the Tabs treatment into a header primitive, retire Eyebrow-as-panel-title.

## 8. Item H — Layers/Buses lag: root cause hypothesis

Server broadcasts voice stats at **2 Hz** (`main.ts:550`, 500 ms interval); client adopts them raw (`store.svelte.ts:1354-1355`) with no interpolation; meter CSS transition is 60 ms (`LayersDock.svelte:134`). Pre-S17 the dock animated from the ~30 Hz local sim → the "lag" is most likely the **update-rate drop reading as jank**, not render cost. Secondary waste: new array refs per tick, per-bus `filter()` per render, per-voice style-string allocation (`LayersDock.svelte:26-36`). Fix direction: client-side interpolation/smoothing between server stats (keep server truth, restore perceptual smoothness). ⚠️LIVE: profile to confirm before changing.

## 9. Node semantics — plain-language explainer (Trent asked)

**Modifier chaining** is a sequential pixel pipeline: each modifier transforms the framebuffer produced by the one before it, upstream-first, then the result blends into the composite (`modifier-graph.ts:73-91`, `chain.ts:34-58`, `compositor.ts:189-206`). When several modifiers feed the same input in parallel, order is decided by **visual y-position, top→bottom** (`modifier-graph.ts:84`) — an invisible rule: dragging a node vertically silently changes the render. Cycles are prevented at wire time. Each voice gets isolated `modState[]` (per-voice accumulators).

**Modulation:** one wire = one mapping (`param:<key>` edge, settings live ON the edge: amount/invert/range, range baked from the param spec at wire time). Multiple mappings on one param **sum** base-relative then clamp once: `final = clamp(base + Σ amount×(target−base))`. So amount 0.5 = "halfway from base toward target", not "half of target" — correct, non-obvious, worth an inspector hint.

**Time sources:** envelopes are **already trigger-started** — phase 0→1 over each voice's own life, restarting per hit (`compositor.ts:43-50,70`). LFOs are free-running on the global clock (deliberate phase-continuity). CC/OSC are live table reads.

**Trigger-into-envelope (Trent's ask): does not exist.** No trigger input on modulation nodes; envelope phase is hardcoded from voice spawn; no delay/offset mechanism. This is a new feature at the same per-voice timing seam as item C (retrigger overlap) — design and build them together.

## 10. Re-ranked plan

**Wave 1 — foundations (before any more UI churn):**
1. **Screenshot CLI** (new, Trent-directed): reusable headless Playwright wrapper — `ui-shot <route> [--select <selector>] [--out dir]` — so every subsequent UI task self-verifies cheaply. Pre-req for waves 2–3.
2. **Live smoke pass** of every ⚠️LIVE above (one dev-server session): visualiser render source, Share/tunnel server logs, LayersDock profile, delay-corruption repro attempt, the 9 UX bugs.

**Wave 2 — correctness (P0/P1):**
3. **B+C combined:** ONE RENDER TRUTH (Trent-confirmed direction) — collapse the throwaway web sim onto the core engine; determinism test at compositor + visualiser seams; retrigger-overlap verification; per-trigger seeding for random effects (confetti). ~~Trigger-started envelopes~~ — DROPPED for now (Trent, 2026-07-03).
4. **A:** fix the 9 mapped UX defects + delay-corruption root-cause + extract the theme-token helper + extend flow-guard hardening to the Patch graph.
5. **H:** stats interpolation (after profile confirms).
6. **Share/tunnel:** restore tunnel startup/reporting.

**Wave 3 — cohesive design pass (P2, one coherent drop):**
7. **D/E/F(iterate)/G + I-surfacing + logo:** header-primitive unification (Tabs treatment), icon+tooltip standardisation, params-inside-card, add-flow redesign (DnD-to-add vs modal — decision below), inspector rail/drawer rethink (covers both graphs), library entry point, node previews live-on-trigger, favicon+logo. Linear/Resend north star; one design-system regen; every change screenshot-verified via the new CLI.

**Decisions — RESOLVED 2026-07-03 (see TRENT-DICTATION-2.md for detail):**
- **Add flow + Inspector:** superseded by the APPROVED app-shell re-layout (`~/TWA/ledrums-prototypes/relayout-shell.html`) — Node Editor side drawer (Add/Inspector tabs), full-height Kit+Buses/Layers right column, bottom Graphs dock with section tabs + 1–9 hotkey graph cards. This is the wave-3 target shell.
- **Modifier order UI:** both proposed options REJECTED; problem parked — revisit within the new shell (candidate: read-only chain order display in the drawer inspector).
- **Trigger-started envelopes:** DROPPED as a feature for now; out of item C's scope.

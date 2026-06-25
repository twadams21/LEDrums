# Orchestrator handoff — you are now the LEDrums orchestrator

The previous orchestrator (the main session) is signing off. **You (`unified-shell-a69e0f`) are now
the orchestrator.** From here, **Trent drives you directly in this pane** — do NOT
`twux send-message --session parent` anymore (there is no parent to report to). Surface status in your
own session.

## Your immediate task: #2 — seed the server default from the canonical kit

There are ~15 min to the 22:30 usage reset (account 5h ~89%). **Begin now**; if you hit the rate limit
mid-edit, **commit WIP on `feat/unified-shell`** and stop — it resumes after 22:30.

#1/#3 just landed (commit `62908ca`) and gave you the tools:
- `@ledrums/core` now exports **`DEFAULT_KIT: KitConfig`** (the one canonical in-code kit) and
  **`assertProjectIntegrity(project)`** + `assertShowIntegrity(...)` (pure referential-integrity guards).
- Scope for #2: **`apps/server/**` + `apps/server/projects/default.json`** (you may import from core).
  - Seed `default.json`'s kit from `DEFAULT_KIT` (don't hand-maintain a divergent copy) — or better,
    have the server **seed its default project from `defaultProject()`** when no saved project exists,
    so the checked-in `default.json` stops being a hand-edited source of drift. Design the cleanest
    option with **/codebase-design** (seed-from-core vs generated-artifact).
  - Call **`assertProjectIntegrity()` on the server load path** so a dangling-ref project fails loudly
    at load (reuses #3's guard verbatim).
- Keep `pnpm typecheck` + `pnpm test` green. Commit a milestone on `feat/unified-shell`. No push/PR.
- VERIFY the combined #1/#3 + #2 result yourself (run the gates) — the previous orchestrator delegated
  final verification of #1/#3 to you (kit-source reported green: core 139 / server 34 / web 58,
  typecheck 0 errors — confirm it).

## State of the world (branch `feat/unified-shell`, NOT pushed, NOT merged)
Commits (newest first): `62908ca` #1/#3 kit single-source + integrity · `e55ecc9` docs · `a7efdbd` P2
sections-as-graph-slots · `8978938` P1 kit-alignment fix · `9719261` unified shell · (+ mex/docs).

Done:
- **Unified shell** (`apps/web/src/lib/app/`): mode-split Perform/Author, views (Trigger Graph / Patch
  Graph / Sections / Kit), docks (Visualizer + Inspector/Monitor tabs, permanent Layers/Buses bottom),
  pure `shell-nav` reducer. Default app at `/`; old lab still at `/?proto=trigger`.
- **Voice engine in core** (`packages/core/src/voice/`): `RenderEngine` outer seam + `Compositor`
  inner seam, voice pool, seeded PRNG, 120fps. Server `VoiceEngineHost` (`LEDRUMS_ENGINE=voice`, :4321).
  Web store opens the WS link (`setShow`/`setTransport`/`key`, `serverModel`/`previewFrame`).
- **P1**: web↔server kit drift fixed (the `tom`/`tom1` bug). **P2**: sections-as-graph-slots model
  (`lib/app/setlist.ts`) + UI (reusable, layerable graphs in slots). **#1/#3**: canonical kit + integrity.

Roadmap (your backlog, roughly prioritized — confirm with Trent):
1. **#2** (now).
2. **Section-aware engine playback** — the big documented gap: the engine fires `graphs[padKey]` flat;
   make a hit fire the active section's slotted/layered graphs + section morph. A core change
   (`packages/core/src/voice/` eval + the Show/section model). Highest value — makes the arrangement *do* something.
3. **Freeform Patch canvas** + real device settings in the Inspector (today a fixed signal-flow, selectable).
4. **Kit geometry editor** (today a live 3D preview). **Setlist** add/remove songs + **persistence** (server save — no seam yet).
5. **OutputConfig/LivePill** — real Art-Net arm/dry-run/off (today link-derived). **MIDI/OSC zone**
   convention (numeric `pad.zone` vs `SLOT_LABELS`) for real hardware input.
6. **Merge `feat/unified-shell` → main** (when Trent says) + prune now-unused legacy `lib/shell` +
   `lib/views` + `lib/store`. Defer SQLite until a library/scale/querying driver appears.

## Orchestration mechanics (you have `twux`)
- Other agents: **`kit-source-455b19`** (#1/#3, parked, done) and yourself. Park finished split-pane
  agents (`twux park`), keep them alive for audit; never close panes.
- Launch implementer agents with a plan preload (`--bash "cat docs/prompts/X.md"`) + a spelled-out
  report-back; for sub-agents you launch, THEY report to you (`--session parent` = you now).
- **Shared working tree**: all twux agents edit the same checkout — sequence overlapping work or
  partition by disjoint files, or you'll get collisions/broken intermediate gates.
- **Usage gating**: `twux usage` before launching; don't launch >~90% — background
  `twux wake --at <reset_iso> "..."` and resume after. Currently ~89%, resets 22:30.
- **Always trust-but-verify**: re-run `pnpm typecheck` + `pnpm test` yourself after each milestone;
  read the committed diff. Branch hygiene: `feat/unified-shell`, commit milestones, no push/PR/merge
  without Trent's go-ahead.
- **Dev stack is running** (web :5173, voice server :4321, started via a background `pnpm dev`
  `LEDRUMS_ENGINE=voice`). Leave it; it hot-reloads as you edit. Tailscale serve exposes
  `…tail568a80.ts.net:5173` (allowedHosts already set).

## Reference docs
`docs/plans/2026-06-21-ui-redesign.md` (design log + locked decisions + status), `docs/unified-ui-wireframe.html`
(target IA, interactive), `docs/prompts/*.md` (prior agent briefs), plus the vault note
`~/TWA/LEDrums - Unified UI Wireframe.md`. GROW after meaningful work (update the plan + `.mex/`).

Take it from here — kick off #2, then check in with Trent on the roadmap. 🫡
